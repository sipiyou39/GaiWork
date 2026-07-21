import type {
  MainWindowPresentationMode,
  MainWindowPresentationSnapshot,
} from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface MainWindowPresentationContextValue {
  readonly mode: MainWindowPresentationMode;
  readonly isTransitioning: boolean;
  readonly requestWorkspace: () => Promise<void>;
  readonly requestConversationFocus: () => Promise<void>;
  readonly runInWorkspace: <T>(action: () => T | Promise<T>) => Promise<T>;
}

const DEFAULT_PRESENTATION: MainWindowPresentationSnapshot = {
  mode: "workspace",
  transitionId: 0,
};

const MainWindowPresentationContext = createContext<MainWindowPresentationContextValue | null>(
  null,
);

function initialPresentation(): MainWindowPresentationSnapshot {
  try {
    return window.desktopBridge?.mainWindow?.getPresentation() ?? DEFAULT_PRESENTATION;
  } catch {
    return DEFAULT_PRESENTATION;
  }
}

export function MainWindowPresentationProvider({ children }: { children: ReactNode }) {
  const [presentation, setPresentation] = useState(initialPresentation);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  useEffect(() => {
    const bridge = window.desktopBridge?.mainWindow;
    if (!bridge) return;
    const unsubscribe = bridge.onPresentationChange((snapshot) => {
      setPresentation((current) =>
        snapshot.transitionId < current.transitionId ? current : snapshot,
      );
    });
    const current = bridge.getPresentation();
    setPresentation((previous) =>
      current.transitionId < previous.transitionId ? previous : current,
    );
    return unsubscribe;
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.mainWindowPresentation = presentation.mode;
    void window.desktopBridge?.mainWindow
      ?.acknowledgePresentation(presentation)
      .catch(() => undefined);
    return () => {
      delete document.documentElement.dataset.mainWindowPresentation;
    };
  }, [presentation]);

  const requestPresentation = useCallback(async (mode: MainWindowPresentationMode) => {
    const bridge = window.desktopBridge?.mainWindow;
    if (!bridge) {
      setPresentation((current) => ({
        mode,
        transitionId: current.transitionId + 1,
      }));
      return;
    }
    if (presentationRef.current.mode === mode) return;
    setIsTransitioning(true);
    try {
      const snapshot = await bridge.requestPresentation(mode);
      setPresentation((current) =>
        snapshot.transitionId < current.transitionId ? current : snapshot,
      );
    } finally {
      setIsTransitioning(false);
    }
  }, []);

  const requestWorkspace = useCallback(
    () => requestPresentation("workspace"),
    [requestPresentation],
  );
  const requestConversationFocus = useCallback(
    () => requestPresentation("conversation-focus"),
    [requestPresentation],
  );
  const runInWorkspace = useCallback(
    async <T,>(action: () => T | Promise<T>): Promise<T> => {
      if (presentationRef.current.mode !== "workspace") {
        await requestPresentation("workspace");
      }
      return await action();
    },
    [requestPresentation],
  );

  const value = useMemo<MainWindowPresentationContextValue>(
    () => ({
      mode: presentation.mode,
      isTransitioning,
      requestWorkspace,
      requestConversationFocus,
      runInWorkspace,
    }),
    [
      isTransitioning,
      presentation.mode,
      requestConversationFocus,
      requestWorkspace,
      runInWorkspace,
    ],
  );

  return (
    <MainWindowPresentationContext.Provider value={value}>
      {children}
    </MainWindowPresentationContext.Provider>
  );
}

export function useMainWindowPresentation(): MainWindowPresentationContextValue {
  const context = useContext(MainWindowPresentationContext);
  if (!context) {
    return {
      mode: "workspace",
      isTransitioning: false,
      requestWorkspace: async () => undefined,
      requestConversationFocus: async () => undefined,
      runInWorkspace: async <T,>(action: () => T | Promise<T>) => await action(),
    };
  }
  return context;
}
