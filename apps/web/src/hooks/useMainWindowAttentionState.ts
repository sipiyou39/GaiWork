import type { MainWindowAttentionState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

export function isMainWindowAttentive(state: MainWindowAttentionState): boolean {
  return state.visible && state.focused && !state.minimized;
}

function browserAttentionState(): MainWindowAttentionState {
  return {
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    minimized: false,
  };
}

export function useMainWindowAttentionState(): MainWindowAttentionState {
  const [state, setState] = useState<MainWindowAttentionState>(() => {
    const getNativeState = window.desktopBridge?.getMainWindowAttentionState;
    return typeof getNativeState === "function" ? getNativeState() : browserAttentionState();
  });

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (
      typeof bridge?.getMainWindowAttentionState === "function" &&
      typeof bridge.onMainWindowAttentionStateChange === "function"
    ) {
      const unsubscribe = bridge.onMainWindowAttentionStateChange(setState);
      setState(bridge.getMainWindowAttentionState());
      return unsubscribe;
    }

    const update = () => setState(browserAttentionState());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return state;
}
