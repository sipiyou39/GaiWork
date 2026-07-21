import { useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { isElectron } from "../env";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { CompanionPickerProvider } from "./companions/CompanionPicker";
import { CompanionDesktopSync } from "./companions/CompanionDesktopSync";
import { useAcknowledgeCompanionCompletion } from "./companions/useAcknowledgeCompanionCompletion";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useUiStateStore } from "../uiStateStore";
import {
  MainWindowPresentationProvider,
  useMainWindowPresentation,
} from "./MainWindowPresentation";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
const MACOS_TRAFFIC_LIGHTS_LEFT_INSET = "90px";
const CompanionPortalHost = lazy(async () => {
  const module = await import("./companions/CompanionPortalHost");
  return { default: module.CompanionPortalHost };
});

export function shouldNavigateToCompanionThread(
  current: ScopedThreadRef | null,
  target: ScopedThreadRef,
): boolean {
  return current === null || scopedThreadKey(current) !== scopedThreadKey(target);
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { open, toggleSidebar } = useSidebar();
  const { mode, requestWorkspace } = useMainWindowPresentation();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      if (mode === "conversation-focus") {
        void requestWorkspace().then(() => {
          if (!open) toggleSidebar();
        });
        return;
      }
      toggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, mode, open, requestWorkspace, toggleSidebar]);

  if (mode === "conversation-focus") return null;

  return (
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger className="pointer-events-auto" aria-label="Toggle main sidebar" />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function AppSidebarLayoutContent({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const acknowledgeCompanionCompletion = useAcknowledgeCompanionCompletion();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { mode } = useMainWindowPresentation();
  const isConversationFocus = isElectron && mode === "conversation-focus";
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const macosWindowControlsStyle =
    isMacosDesktop && !isWindowFullscreen
      ? ({ "--workspace-controls-left": MACOS_TRAFFIC_LIGHTS_LEFT_INSET } as CSSProperties)
      : undefined;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  useEffect(() => {
    const onNavigateThread = window.desktopBridge?.companions?.onNavigateThread;
    if (typeof onNavigateThread !== "function") return;
    return onNavigateThread(({ threadRef }) => {
      // Clicking a desktop companion is an explicit acknowledgement, including
      // when its conversation is already the active route.
      acknowledgeCompanionCompletion(threadRef);
      markThreadVisited(scopedThreadKey(threadRef), new Date().toISOString());
      const currentParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentThreadRef = resolveThreadRouteRef(currentParams);
      if (!shouldNavigateToCompanionThread(currentThreadRef, threadRef)) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    });
  }, [acknowledgeCompanionCompletion, markThreadVisited, navigate, router]);

  useEffect(() => {
    const onAcknowledgeThread = window.desktopBridge?.companions?.onAcknowledgeThread;
    if (typeof onAcknowledgeThread !== "function") return;
    return onAcknowledgeThread((threadRef) => {
      acknowledgeCompanionCompletion(threadRef);
    });
  }, [acknowledgeCompanionCompletion]);

  return (
    <CompanionPickerProvider>
      <CompanionDesktopSync />
      {isElectron ? (
        <Suspense fallback={null}>
          <CompanionPortalHost />
        </Suspense>
      ) : null}
      <SidebarProvider className="h-dvh! min-h-0!" defaultOpen style={macosWindowControlsStyle}>
        <Sidebar
          side="left"
          collapsible="offcanvas"
          presentationHidden={isConversationFocus}
          className="border-r border-border bg-card text-foreground"
          resizable={{
            minWidth: THREAD_SIDEBAR_MIN_WIDTH,
            shouldAcceptWidth: ({ nextWidth, wrapper }) =>
              wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
        >
          <ThreadSidebar />
          <SidebarRail />
        </Sidebar>
        {children}
        <SidebarControl />
      </SidebarProvider>
    </CompanionPickerProvider>
  );
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  return (
    <MainWindowPresentationProvider>
      <AppSidebarLayoutContent>{children}</AppSidebarLayoutContent>
    </MainWindowPresentationProvider>
  );
}
