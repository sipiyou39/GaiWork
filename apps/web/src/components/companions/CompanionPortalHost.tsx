import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  DesktopCompanionPortalLayout,
  DesktopCompanionPortalRequest,
} from "@t3tools/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { useDesktopCompanionComposerStore } from "~/desktopCompanionComposerStore";
import { cn } from "~/lib/utils";
import ChatView from "../ChatView";
import { ComposerSurfaceEnvironmentProvider } from "../chat/ComposerSurfaceEnvironment";

const PORTAL_ROOT_ID = "companion-portal-root";
const COMPOSER_WIDTH = 768;
const COMPOSER_MAX_HEIGHT = 620;
const SCREEN_MARGIN = 12;
const MORPH_DURATION_MS = 260;
const PORTAL_OPEN_TIMEOUT_MS = 5_000;
const INTERACTIVE_SELECTOR = [
  '[data-companion-portal-interactive="true"]',
  '[data-slot$="-positioner"]',
  '[data-slot$="-popup"]',
  '[data-slot="dialog-backdrop"]',
  '[data-slot="dialog-viewport"]',
].join(",");
const FLOATING_LAYER_SELECTOR = [
  '[data-slot$="-positioner"]',
  '[data-slot$="-popup"]',
  '[data-slot="dialog-backdrop"]',
  '[data-slot="dialog-viewport"]',
].join(",");

type PortalPhase = "opening" | "open" | "closing";

interface PortalSession {
  readonly request: DesktopCompanionPortalRequest;
  readonly childWindow: Window & typeof globalThis;
  readonly root: HTMLElement;
  readonly layout: DesktopCompanionPortalLayout;
  readonly phase: PortalPhase;
}

function copyDocumentAppearance(target: Document): void {
  target.documentElement.className = document.documentElement.className;
  target.documentElement.lang = document.documentElement.lang || "en";
  target.documentElement.dataset.companionPortal = "true";
  target.documentElement.style.colorScheme = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

async function waitForPortalRoot(childWindow: Window & typeof globalThis): Promise<HTMLElement> {
  const startedAt = performance.now();
  while (!childWindow.closed && performance.now() - startedAt < PORTAL_OPEN_TIMEOUT_MS) {
    try {
      const root = childWindow.document.getElementById(PORTAL_ROOT_ID);
      if (root instanceof childWindow.HTMLElement) return root;
    } catch {
      // The initial about:blank document can briefly be replaced while Electron
      // commits the authorized local URL. Same-origin access resumes immediately.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
  throw new Error("The companion composer window did not become ready in time.");
}

function closeChildWindow(childWindow: Window & typeof globalThis): void {
  if (!childWindow.closed) childWindow.close();
}

function prefersReducedMotion(targetWindow: Pick<Window, "matchMedia">): boolean {
  try {
    return targetWindow.matchMedia("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}

function DesktopCompanionComposerCard({
  session,
  onPhaseChange,
  onRequestClose,
}: {
  readonly session: PortalSession;
  readonly onPhaseChange: (phase: PortalPhase) => void;
  readonly onRequestClose: () => void;
}) {
  const bridge = window.desktopBridge?.companions;
  const articleRef = useRef<HTMLElement | null>(null);
  const previousLayoutRef = useRef<DesktopCompanionPortalLayout | null>(null);
  const lastMetricsRef = useRef<{ width: number; height: number } | null>(null);
  const readyTokenRef = useRef<string | null>(null);
  const [metricsReadyToken, setMetricsReadyToken] = useState<string | null>(null);
  const childWindow = session.childWindow;
  const targetWidth = Math.max(
    220,
    Math.min(COMPOSER_WIDTH, session.layout.workAreaWidth - SCREEN_MARGIN * 2),
  );
  const maxHeight = Math.max(
    136,
    Math.min(COMPOSER_MAX_HEIGHT, session.layout.workAreaHeight - 24),
  );

  useLayoutEffect(() => {
    const article = articleRef.current;
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = session.layout;
    if (!article || !previous || session.phase !== "open") return;
    if (prefersReducedMotion(childWindow)) return;
    const deltaX = previous.cardX - session.layout.cardX;
    const deltaY = previous.cardY - session.layout.cardY;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    article.getAnimations().forEach((animation) => {
      if (animation.id === "companion-placement-flip") animation.cancel();
    });
    const animation = article.animate(
      [
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    animation.id = "companion-placement-flip";
  }, [childWindow, session.layout, session.phase]);

  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article || !bridge) return;
    let disposed = false;
    let reportFrame: number | null = null;
    const report = () => {
      reportFrame = null;
      const metrics = {
        // offsetWidth/offsetHeight deliberately ignore the opening transform.
        // The main process needs the final composer geometry before revealing it.
        width: Math.max(220, Math.min(1_200, Math.round(article.offsetWidth))),
        height: Math.max(1, Math.min(1_000, Math.round(article.offsetHeight))),
      };
      if (
        lastMetricsRef.current?.width === metrics.width &&
        lastMetricsRef.current.height === metrics.height
      ) {
        return;
      }
      lastMetricsRef.current = metrics;
      void bridge
        .reportCardMetrics({ token: session.request.token, ...metrics })
        .then(() => {
          if (!disposed) setMetricsReadyToken(session.request.token);
        })
        .catch(() => {
          if (!disposed) onRequestClose();
        });
    };
    const observer =
      typeof childWindow.ResizeObserver === "function"
        ? new childWindow.ResizeObserver(() => {
            if (reportFrame !== null) return;
            reportFrame = childWindow.requestAnimationFrame(report);
          })
        : null;
    observer?.observe(article);
    report();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (reportFrame !== null) childWindow.cancelAnimationFrame(reportFrame);
    };
  }, [bridge, childWindow, onRequestClose, session.request.token]);

  useEffect(() => {
    if (!bridge || readyTokenRef.current === session.request.token) return;
    if (metricsReadyToken !== session.request.token) return;
    let cancelled = false;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    const reportReady = () => {
      if (cancelled || firstFrame !== null) return;
      // A hidden BrowserWindow does not reliably produce animation frames,
      // even with background throttling disabled. Use the visible opener's
      // clock until the main process reveals the fully populated child.
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          void bridge
            .portalReady({ token: session.request.token })
            .then(() => {
              readyTokenRef.current = session.request.token;
              if (!cancelled) onPhaseChange("open");
            })
            .catch(() => {
              if (!cancelled) onRequestClose();
            });
        });
      });
    };
    const onLoad = () => reportReady();
    if (childWindow.document.readyState === "complete") {
      reportReady();
    } else {
      childWindow.addEventListener("load", onLoad, { once: true });
    }
    return () => {
      cancelled = true;
      childWindow.removeEventListener("load", onLoad);
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [
    bridge,
    childWindow,
    metricsReadyToken,
    onPhaseChange,
    onRequestClose,
    session.request.token,
  ]);

  useEffect(() => {
    if (session.phase !== "open") return;
    const frame = childWindow.requestAnimationFrame(() => {
      const editor = session.root.querySelector<HTMLElement>('[data-testid="composer-editor"]');
      editor?.focus({ preventScroll: true });
    });
    return () => childWindow.cancelAnimationFrame(frame);
  }, [childWindow, session.phase, session.root]);

  const style = {
    "--companion-card-left": `${session.layout.cardX}px`,
    "--companion-card-top": `${session.layout.cardY}px`,
    "--companion-card-width": `${targetWidth}px`,
    "--companion-card-max-height": `${maxHeight}px`,
    "--companion-card-morph-duration": `${MORPH_DURATION_MS}ms`,
    "--companion-card-morph-x": `${session.layout.compactCardX - session.layout.cardX}px`,
    "--companion-card-morph-y": `${session.layout.compactCardY - session.layout.cardY}px`,
    "--companion-card-morph-scale-x": `${session.layout.compactCardWidth / Math.max(1, session.layout.cardWidth)}`,
    "--companion-card-morph-scale-y": `${session.layout.compactCardHeight / Math.max(1, session.layout.cardHeight)}`,
  } as CSSProperties;

  return (
    <article
      ref={articleRef}
      className={cn("desktop-companion-portal-card", `is-${session.phase}`)}
      data-companion-portal-interactive="true"
      data-placement={session.layout.placement}
      style={style}
    >
      <div className="desktop-companion-portal-content">
        <ChatView
          environmentId={session.request.threadRef.environmentId}
          threadId={session.request.threadRef.threadId}
          routeKind="server"
          renderMode="desktop-composer"
          reserveTitleBarControlInset={false}
          onDesktopComposerSubmitSuccess={onRequestClose}
        />
      </div>
    </article>
  );
}

export function CompanionPortalHost() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const sessionRef = useRef<PortalSession | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const claim = useDesktopCompanionComposerStore((state) => state.claim);
  const release = useDesktopCompanionComposerStore((state) => state.release);

  const replaceSession = useCallback((next: PortalSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const finishClose = useCallback(
    (token: string, notifyMain = true, closeWindow = true) => {
      const current = sessionRef.current;
      if (!current || current.request.token !== token) return;
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      replaceSession(null);
      release(token);
      if (notifyMain) {
        void window.desktopBridge?.companions?.closeComposer({ token }).catch(() => undefined);
      }
      if (closeWindow) closeChildWindow(current.childWindow);
    },
    [release, replaceSession],
  );

  const requestClose = useCallback(
    (token?: string) => {
      const current = sessionRef.current;
      if (!current || (token && current.request.token !== token)) return;
      if (current.phase === "closing") return;
      const closing = { ...current, phase: "closing" as const };
      replaceSession(closing);
      void window.desktopBridge?.companions
        ?.portalClosing({ token: current.request.token })
        .catch(() => undefined);
      const reducedMotion = prefersReducedMotion(current.childWindow);
      closeTimerRef.current = window.setTimeout(
        () => finishClose(current.request.token),
        reducedMotion ? 0 : MORPH_DURATION_MS,
      );
    },
    [finishClose, replaceSession],
  );

  const updatePhase = useCallback(
    (phase: PortalPhase) => {
      const current = sessionRef.current;
      if (!current || current.phase === phase) return;
      replaceSession({ ...current, phase });
    },
    [replaceSession],
  );

  const requestActiveClose = useCallback(() => {
    const current = sessionRef.current;
    if (current) requestClose(current.request.token);
  }, [requestClose]);

  useEffect(() => {
    const bridge = window.desktopBridge?.companions;
    if (!bridge?.onOpenComposer) return;

    const openPortal = async (request: DesktopCompanionPortalRequest) => {
      const previous = sessionRef.current;
      if (previous) finishClose(previous.request.token);
      const childWindow = window.open(request.url, request.frameName, "popup") as
        | (Window & typeof globalThis)
        | null;
      if (!childWindow) {
        void bridge.closeComposer({ token: request.token });
        return;
      }
      try {
        const root = await waitForPortalRoot(childWindow);
        if (childWindow.closed) throw new Error("The companion composer window closed early.");
        copyDocumentAppearance(childWindow.document);
        const next: PortalSession = {
          request,
          childWindow,
          root,
          layout: request.layout,
          phase: "opening",
        };
        replaceSession(next);
        claim({
          token: request.token,
          threadKey: scopedThreadKey(request.threadRef),
          reclaim: () => requestClose(request.token),
        });
      } catch {
        closeChildWindow(childWindow);
        void bridge.closeComposer({ token: request.token });
      }
    };

    return bridge.onOpenComposer((request) => void openPortal(request));
  }, [claim, finishClose, replaceSession, requestClose]);

  useEffect(() => {
    const bridge = window.desktopBridge?.companions;
    if (!bridge) return;
    const unsubscribeLayout = bridge.onPortalLayout((layout) => {
      const current = sessionRef.current;
      if (
        !current ||
        current.request.token !== layout.token ||
        layout.revision <= current.layout.revision
      ) {
        return;
      }
      replaceSession({ ...current, layout });
    });
    const unsubscribeClose = bridge.onCloseComposer(({ token }) => requestClose(token));
    return () => {
      unsubscribeLayout();
      unsubscribeClose();
    };
  }, [replaceSession, requestClose]);

  useEffect(() => {
    if (!session) return;
    const { childWindow, request } = session;
    const targetDocument = childWindow.document;
    copyDocumentAppearance(targetDocument);
    const appearanceObserver = new MutationObserver(() => copyDocumentAppearance(targetDocument));
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "lang"],
    });

    let interactive = false;
    let pointerFrame: number | null = null;
    const updateInteractive = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      void window.desktopBridge?.companions?.setPortalInteractive({
        token: request.token,
        interactive: next,
      });
    };
    const onPointerMove = (event: MouseEvent) => {
      if (pointerFrame !== null) return;
      pointerFrame = childWindow.requestAnimationFrame(() => {
        pointerFrame = null;
        const target = targetDocument.elementFromPoint(event.clientX, event.clientY);
        const floatingLayerOpen = targetDocument.querySelector(FLOATING_LAYER_SELECTOR) !== null;
        updateInteractive(floatingLayerOpen || Boolean(target?.closest(INTERACTIVE_SELECTOR)));
      });
    };
    const onPointerLeave = () => updateInteractive(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      requestClose(request.token);
    };
    const onBeforeUnload = () => finishClose(request.token, true, false);
    childWindow.addEventListener("mousemove", onPointerMove, true);
    childWindow.addEventListener("mouseleave", onPointerLeave, true);
    childWindow.addEventListener("keydown", onKeyDown);
    childWindow.addEventListener("beforeunload", onBeforeUnload, { once: true });
    return () => {
      appearanceObserver.disconnect();
      childWindow.removeEventListener("mousemove", onPointerMove, true);
      childWindow.removeEventListener("mouseleave", onPointerLeave, true);
      childWindow.removeEventListener("keydown", onKeyDown);
      childWindow.removeEventListener("beforeunload", onBeforeUnload);
      if (pointerFrame !== null) childWindow.cancelAnimationFrame(pointerFrame);
      if (!childWindow.closed) {
        void window.desktopBridge?.companions?.setPortalInteractive({
          token: request.token,
          interactive: false,
        });
      }
    };
  }, [finishClose, requestClose, session?.childWindow, session?.request]);

  useEffect(() => {
    return () => {
      const current = sessionRef.current;
      if (current) finishClose(current.request.token);
    };
  }, [finishClose]);

  if (!session) return null;
  return createPortal(
    <ComposerSurfaceEnvironmentProvider
      value={{
        window: session.childWindow,
        document: session.childWindow.document,
        portalContainer: session.root,
      }}
    >
      <DesktopCompanionComposerCard
        session={session}
        onPhaseChange={updatePhase}
        onRequestClose={requestActiveClose}
      />
    </ComposerSurfaceEnvironmentProvider>,
    session.root,
  );
}
