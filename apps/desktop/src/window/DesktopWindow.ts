import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";
import type {
  MainWindowPresentationAcknowledgement,
  MainWindowPresentationMode,
  MainWindowPresentationSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  COMPANION_NAVIGATE_THREAD_CHANNEL,
  MAIN_WINDOW_PRESENTATION_CHANNEL,
  MENU_ACTION_CHANNEL,
  WINDOW_FULLSCREEN_STATE_CHANNEL,
} from "../ipc/channels.ts";
import * as PreviewManager from "../preview/Manager.ts";
import {
  attachDesktopCompanionPortalWindow,
  authorizeDesktopCompanionPortalWindow,
} from "../companions/DesktopCompanionPortalRegistry.ts";
import * as DesktopWindowPresentationStore from "./DesktopWindowPresentationStore.ts";

const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";
const WORKSPACE_MIN_WIDTH = 840;
const WORKSPACE_MIN_HEIGHT = 620;
const PRESENTATION_ACK_TIMEOUT = "350 millis";
const COMPACT_GEOMETRY_SAVE_DELAY_MS = 120;
const DEVELOPMENT_LOAD_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;
const DEVELOPMENT_RETRYABLE_LOAD_ERROR_CODES = new Set([
  -2, // ERR_FAILED
  -7, // ERR_TIMED_OUT
  -9, // ERR_UNEXPECTED (custom protocol handler rejected)
  -102, // ERR_CONNECTION_REFUSED
  -105, // ERR_NAME_NOT_RESOLVED
  -106, // ERR_INTERNET_DISCONNECTED
  -118, // ERR_CONNECTION_TIMED_OUT
]);

type WindowTitleBarOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

type DesktopWindowRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopAssets.DesktopAssets
  | ElectronMenu.ElectronMenu
  | ElectronShell.ElectronShell
  | ElectronTheme.ElectronTheme
  | ElectronWindow.ElectronWindow
  | DesktopWindowPresentationStore.DesktopWindowPresentationStore
  | PreviewManager.PreviewManager;

export interface CompanionWindowAnchor {
  readonly bounds: Electron.Rectangle;
}

export type DesktopWindowError =
  | ElectronWindow.ElectronWindowCreateError
  | PreviewManager.PreviewManagerError;

export class DesktopWindow extends Context.Service<
  DesktopWindow,
  {
    readonly createMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly ensureMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly revealOrCreateMain: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly activate: Effect.Effect<void, DesktopWindowError>;
    readonly createMainIfBackendReady: Effect.Effect<void, DesktopWindowError>;
    // Show a lightweight "Connecting to WSL" splash window immediately (wsl-only
    // mode), before the WSL backend that serves the renderer is ready. It is
    // dismissed automatically once the real main window reveals.
    readonly showConnectingSplash: Effect.Effect<void>;
    // Marks the primary backend as ready so `createMainIfBackendReady` and the
    // macOS "activate without windows" path may open the real main window. The
    // renderer now always loads the local client URL (getDesktopUrl) and connects
    // to the backend through the connection layer, so the reported httpBaseUrl is
    // no longer used to point the window at the backend — it is kept only for the
    // readiness log and to preserve the callback contract the backend pool drives.
    readonly handleBackendReady: (httpBaseUrl: URL) => Effect.Effect<void, DesktopWindowError>;
    // Called when the backend transitions back to "not ready" (clean stop,
    // restart, crash). Clears the latch that lets `activate` auto-create a
    // window so a "macOS dock click" while the backend is down doesn't
    // produce a stranded window pointing at nothing.
    readonly handleBackendNotReady: Effect.Effect<void>;
    readonly dispatchMenuAction: (action: string) => Effect.Effect<void, DesktopWindowError>;
    readonly navigateToThread: (
      threadRef: ScopedThreadRef,
    ) => Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly openCompanionConversation: (
      threadRef: ScopedThreadRef,
      anchor: CompanionWindowAnchor,
    ) => Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly showWorkspace: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly showConversationFocus: Effect.Effect<Electron.BrowserWindow, DesktopWindowError>;
    readonly getPresentation: Effect.Effect<MainWindowPresentationSnapshot>;
    readonly requestPresentation: (
      mode: MainWindowPresentationMode,
      senderWebContentsId: number,
    ) => Effect.Effect<MainWindowPresentationSnapshot, DesktopWindowError>;
    readonly acknowledgePresentation: (
      input: MainWindowPresentationAcknowledgement,
      senderWebContentsId: number,
    ) => Effect.Effect<void>;
    readonly syncAppearance: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopWindow") {}

const { logInfo: logWindowInfo, logWarning: logWindowWarning } =
  makeComponentLogger("desktop-window");

function getIconOption(
  iconPaths: DesktopAssets.DesktopIconPaths,
  platform: NodeJS.Platform,
): { icon: string } | Record<string, never> {
  if (platform === "darwin") return {}; // macOS uses .icns from app bundle
  const ext = platform === "win32" ? "ico" : "png";
  return Option.match(iconPaths[ext], {
    onNone: () => ({}),
    onSome: (icon) => ({ icon }),
  });
}

function getInitialWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
}

// A self-contained "Connecting to WSL" splash, shown immediately in wsl-only
// mode while the WSL backend (which serves the renderer) cold-boots. Inlined as
// a data URL so it needs no bundled asset and no backend — pure CSS, no JS.
function buildConnectingSplashDataUrl(shouldUseDarkColors: boolean): string {
  const background = getInitialWindowBackgroundColor(shouldUseDarkColors);
  const label = shouldUseDarkColors ? "#9ca3af" : "#6b7280";
  const accent = shouldUseDarkColors ? "#f8fafc" : "#1f2937";
  const track = shouldUseDarkColors ? "rgba(248,250,252,0.18)" : "rgba(31,41,55,0.18)";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%}body{background:${background};color:${label};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;-webkit-user-select:none;user-select:none;-webkit-app-region:drag}.spinner{width:26px;height:26px;border:3px solid ${track};border-top-color:${accent};border-radius:50%;animation:spin .8s linear infinite}.label{font-size:13px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spinner"></div><div class="label">Connecting to WSL…</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function isSameOriginRendererNavigation(input: {
  readonly applicationUrl: string;
  readonly navigationUrl: string;
}): boolean {
  try {
    return new URL(input.applicationUrl).origin === new URL(input.navigationUrl).origin;
  } catch {
    return false;
  }
}

export function isRetryableDevelopmentRendererLoadFailure(input: {
  readonly applicationUrl: string;
  readonly errorCode: number;
  readonly isMainFrame: boolean;
  readonly validatedUrl: string;
}): boolean {
  return (
    input.isMainFrame &&
    DEVELOPMENT_RETRYABLE_LOAD_ERROR_CODES.has(input.errorCode) &&
    isSameOriginRendererNavigation({
      applicationUrl: input.applicationUrl,
      navigationUrl: input.validatedUrl,
    })
  );
}

function getWindowTitleBarOptions(
  shouldUseDarkColors: boolean,
  platform: NodeJS.Platform,
): WindowTitleBarOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: shouldUseDarkColors ? TITLEBAR_DARK_SYMBOL_COLOR : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function syncWindowAppearance(
  window: Electron.BrowserWindow,
  shouldUseDarkColors: boolean,
  platform: NodeJS.Platform,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (window.isDestroyed()) {
      return;
    }

    window.setBackgroundColor(getInitialWindowBackgroundColor(shouldUseDarkColors));
    const { titleBarOverlay } = getWindowTitleBarOptions(shouldUseDarkColors, platform);
    if (typeof titleBarOverlay === "object") {
      window.setTitleBarOverlay(titleBarOverlay);
    }
  });
}

type RevealSubscription = (listener: () => void) => void;

function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const presentationStore = yield* DesktopWindowPresentationStore.DesktopWindowPresentationStore;
  const previewManager = yield* PreviewManager.PreviewManager;
  // Window-side latch for the primary backend's readiness. Set by
  // handleBackendReady (driven by the pool's onReady callback), cleared
  // by handleBackendNotReady (driven by onShutdown). Only consumed by
  // createMainIfBackendReady, which gates the post-readiness window
  // open in development and the macOS "activate without windows" path.
  const backendReadyRef = yield* Ref.make(false);
  // The transient "Connecting to WSL" splash window, tracked separately so it
  // is never mistaken for the real main window.
  const splashWindowRef = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
  const pendingNavigationRef = yield* Ref.make<Option.Option<ScopedThreadRef>>(Option.none());
  const deferAutomaticRevealRef = yield* Ref.make(false);
  const presentationRef = yield* Ref.make<MainWindowPresentationSnapshot>({
    mode: "workspace",
    transitionId: 0,
  });
  const lastAcknowledgedPresentationRef = yield* Ref.make(-1);
  const context = yield* Effect.context<DesktopWindowRuntimeServices>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const navigationLoadListeners = new WeakSet<Electron.WebContents>();
  const pendingPresentationAcknowledgements = new Map<
    number,
    {
      readonly mode: MainWindowPresentationMode;
      readonly deferred: Deferred.Deferred<void>;
    }
  >();

  const flushPendingNavigation = (window: Electron.BrowserWindow) =>
    Ref.getAndSet(pendingNavigationRef, Option.none()).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (threadRef) =>
            Effect.sync(() => {
              if (!window.isDestroyed()) {
                window.webContents.send(COMPANION_NAVIGATE_THREAD_CHANNEL, {
                  threadRef,
                  presentation: "conversation-focus",
                });
              }
            }),
        }),
      ),
    );

  const dismissConnectingSplash = Effect.gen(function* () {
    const splash = yield* Ref.getAndSet(splashWindowRef, Option.none());
    if (Option.isSome(splash) && !splash.value.isDestroyed()) {
      splash.value.close();
    }
  });

  // currentMainOrFirst / focusedMainOrFirst fall back to "any first window",
  // which during WSL-only boot is the connecting splash. The splash is never
  // registered via setMain, so it must be treated as "no real main window" --
  // otherwise ensureMain/activate/dispatchMenuAction latch onto it and never
  // open (or retry) the real main. That is the failure the pool's swallowed
  // post-readiness window-open error would otherwise strand the user in:
  // splash up, backend ready, no main, and activation only re-reveals splash.
  const withoutSplash = (window: Option.Option<Electron.BrowserWindow>) =>
    Ref.get(splashWindowRef).pipe(
      Effect.map((splash) =>
        Option.isSome(splash) && Option.isSome(window) && window.value === splash.value
          ? Option.none<Electron.BrowserWindow>()
          : window,
      ),
    );

  const currentMainWindow = electronWindow.currentMainOrFirst.pipe(Effect.flatMap(withoutSplash));
  const focusedMainWindow = electronWindow.focusedMainOrFirst.pipe(Effect.flatMap(withoutSplash));

  const isCurrentMainSender = (senderWebContentsId: number) =>
    currentMainWindow.pipe(
      Effect.map(
        (window) =>
          Option.isSome(window) &&
          !window.value.isDestroyed() &&
          window.value.webContents.id === senderWebContentsId,
      ),
    );

  const displayById = (displayId: string): Electron.Display | null =>
    Electron.screen.getAllDisplays().find((display) => String(display.id) === displayId) ?? null;

  const displayForAnchor = (anchor: CompanionWindowAnchor | null): Electron.Display => {
    if (anchor) {
      return Electron.screen.getDisplayMatching(anchor.bounds);
    }
    return Electron.screen.getPrimaryDisplay();
  };

  const resolveCompactBounds = Effect.fn("desktop.window.resolveCompactBounds")(function* (
    anchor: CompanionWindowAnchor | null,
  ) {
    const stored = yield* presentationStore.getCompactPosition;
    if (stored !== null) {
      const storedDisplay = displayById(stored.displayId);
      if (storedDisplay) {
        return {
          bounds: DesktopWindowPresentationStore.compactWindowBoundsFromPosition({
            position: stored,
            workArea: storedDisplay.workArea,
          }),
          display: storedDisplay,
        } as const;
      }
    }

    const display = displayForAnchor(anchor);
    const companionBounds =
      anchor?.bounds ??
      ({
        x: display.workArea.x,
        y: display.workArea.y,
        width: 1,
        height: 1,
      } satisfies Electron.Rectangle);
    return {
      bounds: DesktopWindowPresentationStore.defaultCompactWindowBounds({
        workArea: display.workArea,
        companionBounds,
      }),
      display,
    } as const;
  });

  const persistCompactBounds = Effect.fn("desktop.window.persistCompactBounds")(function* (
    window: Electron.BrowserWindow,
  ) {
    const presentation = yield* Ref.get(presentationRef);
    if (presentation.mode !== "conversation-focus" || window.isDestroyed()) return;
    const currentBounds = window.getBounds();
    const display = Electron.screen.getDisplayMatching(currentBounds);
    const width = DesktopWindowPresentationStore.constrainCompactWindowWidth(
      currentBounds.width,
      display.workArea.width,
    );
    const maximumX = display.workArea.x + display.workArea.width - width;
    const bounds = {
      x: Math.round(Math.max(display.workArea.x, Math.min(currentBounds.x, maximumX))),
      y: display.workArea.y,
      width,
      height: display.workArea.height,
    } satisfies Electron.Rectangle;
    window.setMinimumSize(
      Math.min(DesktopWindowPresentationStore.COMPACT_WINDOW_MIN_WIDTH, display.workArea.width),
      display.workArea.height,
    );
    window.setMaximumSize(
      Math.min(DesktopWindowPresentationStore.COMPACT_WINDOW_MAX_WIDTH, display.workArea.width),
      display.workArea.height,
    );
    if (
      currentBounds.x !== bounds.x ||
      currentBounds.y !== bounds.y ||
      currentBounds.width !== bounds.width ||
      currentBounds.height !== bounds.height
    ) {
      window.setBounds(bounds, false);
    }
    yield* presentationStore.setCompactPosition(
      DesktopWindowPresentationStore.compactWindowPositionFromBounds({
        displayId: String(display.id),
        bounds,
        workArea: display.workArea,
      }),
    );
  });

  const sendPresentationAndAwait = Effect.fn("desktop.window.sendPresentationAndAwait")(function* (
    window: Electron.BrowserWindow,
    snapshot: MainWindowPresentationSnapshot,
  ) {
    if (window.isDestroyed() || window.webContents.isLoadingMainFrame()) return;
    if ((yield* Ref.get(lastAcknowledgedPresentationRef)) >= snapshot.transitionId) return;

    let pending = pendingPresentationAcknowledgements.get(snapshot.transitionId);
    if (!pending) {
      pending = {
        mode: snapshot.mode,
        deferred: yield* Deferred.make<void>(),
      };
      pendingPresentationAcknowledgements.set(snapshot.transitionId, pending);
      window.webContents.send(MAIN_WINDOW_PRESENTATION_CHANNEL, snapshot);
    }
    yield* Deferred.await(pending.deferred).pipe(
      Effect.timeoutOrElse({
        duration: PRESENTATION_ACK_TIMEOUT,
        orElse: () => Effect.void,
      }),
    );
    if (pendingPresentationAcknowledgements.get(snapshot.transitionId) === pending) {
      pendingPresentationAcknowledgements.delete(snapshot.transitionId);
    }
  });

  const publishCurrentPresentation = Effect.fn("desktop.window.publishCurrentPresentation")(
    function* (window: Electron.BrowserWindow) {
      const snapshot = yield* Ref.get(presentationRef);
      yield* sendPresentationAndAwait(window, snapshot);
    },
  );

  const transitionPresentation = Effect.fn("desktop.window.transitionPresentation")(function* (
    window: Electron.BrowserWindow,
    mode: MainWindowPresentationMode,
    anchor: CompanionWindowAnchor | null,
  ) {
    const current = yield* Ref.get(presentationRef);
    const modeChanged = current.mode !== mode;
    const snapshot: MainWindowPresentationSnapshot = !modeChanged
      ? current
      : {
          mode,
          transitionId: current.transitionId + 1,
        };
    if (snapshot !== current) {
      yield* Ref.set(presentationRef, snapshot);
    }

    const wasVisible = window.isVisible();
    if (mode === "conversation-focus") {
      const compact = yield* resolveCompactBounds(anchor);
      if (window.isFullScreen()) window.setFullScreen(false);
      if (window.isMaximized()) window.unmaximize();
      window.setMinimumSize(
        Math.min(
          DesktopWindowPresentationStore.COMPACT_WINDOW_MIN_WIDTH,
          compact.display.workArea.width,
        ),
        compact.display.workArea.height,
      );
      window.setMaximumSize(
        Math.min(
          DesktopWindowPresentationStore.COMPACT_WINDOW_MAX_WIDTH,
          compact.display.workArea.width,
        ),
        compact.display.workArea.height,
      );
      if (wasVisible && modeChanged) {
        yield* sendPresentationAndAwait(window, snapshot);
      }
      window.setBounds(compact.bounds, wasVisible && environment.platform === "darwin");
      yield* presentationStore.setCompactPosition(
        DesktopWindowPresentationStore.compactWindowPositionFromBounds({
          displayId: String(compact.display.id),
          bounds: compact.bounds,
          workArea: compact.display.workArea,
        }),
      );
      if (!wasVisible && modeChanged) {
        yield* sendPresentationAndAwait(window, snapshot);
      }
      return snapshot;
    }

    if (window.isFullScreen()) window.setFullScreen(false);
    window.setMaximumSize(100_000, 100_000);
    window.setMinimumSize(WORKSPACE_MIN_WIDTH, WORKSPACE_MIN_HEIGHT);
    if (!window.isMaximized()) window.maximize();
    if (modeChanged) {
      yield* sendPresentationAndAwait(window, snapshot);
    }
    return snapshot;
  });

  const createWindow = Effect.fn("desktop.window.createWindow")(function* (): Effect.fn.Return<
    Electron.BrowserWindow,
    DesktopWindowError
  > {
    yield* previewManager.getBrowserSession();
    const applicationUrl = getDesktopUrl(environment.isDevelopment);
    const iconPaths = yield* assets.iconPaths;
    const iconOption = getIconOption(iconPaths, environment.platform);
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const window = yield* electronWindow.create({
      width: 1100,
      height: 780,
      minWidth: 840,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      ...(environment.platform === "darwin" ? { disableAutoHideCursor: true } : {}),
      backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
      ...iconOption,
      title: environment.displayName,
      ...getWindowTitleBarOptions(shouldUseDarkColors, environment.platform),
      webPreferences: {
        preload: environment.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        backgroundThrottling: false,
      },
    });
    yield* Ref.set(lastAcknowledgedPresentationRef, -1);
    pendingPresentationAcknowledgements.clear();

    if (environment.platform === "darwin") {
      window.setAutoHideCursor(false);
    }

    let compactGeometryFiber: Fiber.Fiber<void, never> | undefined;
    const clearCompactGeometrySync = () => {
      if (compactGeometryFiber === undefined) return;
      const fiber = compactGeometryFiber;
      compactGeometryFiber = undefined;
      runFork(Fiber.interrupt(fiber));
    };
    const scheduleCompactGeometrySync = () => {
      clearCompactGeometrySync();
      compactGeometryFiber = runFork(
        Effect.sleep(COMPACT_GEOMETRY_SAVE_DELAY_MS).pipe(
          Effect.andThen(persistCompactBounds(window)),
          Effect.onExit(() =>
            Effect.sync(() => {
              compactGeometryFiber = undefined;
            }),
          ),
        ),
      );
    };
    const onDisplayMetricsChanged = () => scheduleCompactGeometrySync();
    window.on("move", scheduleCompactGeometrySync);
    window.on("resize", scheduleCompactGeometrySync);
    Electron.screen?.on("display-added", onDisplayMetricsChanged);
    Electron.screen?.on("display-removed", onDisplayMetricsChanged);
    Electron.screen?.on("display-metrics-changed", onDisplayMetricsChanged);

    yield* previewManager.setMainWindow(window);
    window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
      if (
        typeof params.partition !== "string" ||
        !previewManager.isBrowserPartition(params.partition)
      ) {
        event.preventDefault();
        return;
      }
      webPreferences.sandbox = true;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = false;
    });

    window.webContents.on("context-menu", (event, params) => {
      event.preventDefault();

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          menuTemplate.push({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          });
        }
        if (params.dictionarySuggestions.length === 0) {
          menuTemplate.push({ label: "No suggestions", enabled: false });
        }
        menuTemplate.push({ type: "separator" });
      }

      if (Option.isSome(ElectronShell.parseSafeExternalUrl(params.linkURL))) {
        menuTemplate.push(
          {
            label: "Copy Link",
            click: () => {
              void runPromise(electronShell.copyText(params.linkURL));
            },
          },
          { type: "separator" },
        );
      }

      if (params.mediaType === "image") {
        menuTemplate.push({
          label: "Copy Image",
          click: () => window.webContents.copyImageAt(params.x, params.y),
        });
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );

      void runPromise(electronMenu.popupTemplate({ window, template: menuTemplate }));
    });

    window.webContents.setWindowOpenHandler(({ url, frameName }) => {
      const companionPortal = authorizeDesktopCompanionPortalWindow({ url, frameName });
      if (companionPortal) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            ...companionPortal.bounds,
            title: companionPortal.title,
            show: false,
            frame: false,
            transparent: true,
            hasShadow: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            movable: false,
            focusable: true,
            skipTaskbar: true,
            type: "panel",
            backgroundColor: "#00000000",
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              backgroundThrottling: false,
            },
          },
        };
      }
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });
    window.webContents.on("did-create-window", (childWindow, details) => {
      const attached = attachDesktopCompanionPortalWindow({
        url: details.url,
        window: childWindow,
      });
      if (!attached && !childWindow.isDestroyed()) childWindow.destroy();
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (
        isSameOriginRendererNavigation({
          applicationUrl,
          navigationUrl: url,
        })
      ) {
        return;
      }

      event.preventDefault();
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
    });

    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(environment.displayName);
    });

    if (environment.platform === "darwin") {
      window.on("enter-full-screen", () => {
        window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, true);
      });
      window.on("leave-full-screen", () => {
        window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, false);
      });
    }

    let developmentLoadRetryIndex = 0;
    let developmentLoadRetryFiber: Fiber.Fiber<void, never> | undefined;
    const clearDevelopmentLoadRetry = () => {
      if (developmentLoadRetryFiber === undefined) {
        return;
      }
      const retryFiber = developmentLoadRetryFiber;
      developmentLoadRetryFiber = undefined;
      runFork(Fiber.interrupt(retryFiber));
    };
    const loadApplication = () => {
      if (window.isDestroyed()) {
        return;
      }
      void window.loadURL(applicationUrl).catch(() => undefined);
    };
    const scheduleDevelopmentLoadRetry = () => {
      if (developmentLoadRetryFiber !== undefined || window.isDestroyed()) {
        return undefined;
      }

      const retryIndex = Math.min(
        developmentLoadRetryIndex,
        DEVELOPMENT_LOAD_RETRY_DELAYS_MS.length - 1,
      );
      const retryInMs = DEVELOPMENT_LOAD_RETRY_DELAYS_MS[retryIndex] ?? 2_000;
      developmentLoadRetryIndex += 1;
      developmentLoadRetryFiber = runFork(
        Effect.sleep(retryInMs).pipe(
          Effect.andThen(
            Effect.sync(() => {
              developmentLoadRetryFiber = undefined;
              if (!window.isDestroyed()) {
                loadApplication();
              }
            }),
          ),
        ),
      );
      return retryInMs;
    };

    window.webContents.on("did-finish-load", () => {
      if (
        environment.isDevelopment &&
        !isSameOriginRendererNavigation({
          applicationUrl,
          navigationUrl: window.webContents.getURL(),
        })
      ) {
        return;
      }
      clearDevelopmentLoadRetry();
      developmentLoadRetryIndex = 0;
      window.setTitle(environment.displayName);
      void runPromise(
        Effect.all([publishCurrentPresentation(window), flushPendingNavigation(window)], {
          concurrency: "unbounded",
          discard: true,
        }),
      );
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) {
          return;
        }
        const retryInMs =
          environment.isDevelopment &&
          isRetryableDevelopmentRendererLoadFailure({
            applicationUrl,
            errorCode,
            isMainFrame,
            validatedUrl: validatedURL,
          })
            ? scheduleDevelopmentLoadRetry()
            : undefined;
        void runPromise(
          logWindowWarning("main window failed to load", {
            errorCode,
            errorDescription,
            url: validatedURL,
            ...(retryInMs === undefined ? {} : { retryInMs }),
          }),
        );
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        logWindowWarning("main window render process gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
      void runPromise(electronWindow.clearMain(Option.some(window)));
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });

    const revealSubscribers: RevealSubscription[] = [(fire) => window.once("ready-to-show", fire)];
    if (environment.platform === "linux") {
      revealSubscribers.push((fire) => window.webContents.once("did-finish-load", fire));
    }
    bindFirstRevealTrigger(revealSubscribers, () => {
      // Reveal the real window, then close the connecting splash (if any) so the
      // two don't overlap and there's no blank gap between them.
      void runPromise(
        Ref.get(deferAutomaticRevealRef).pipe(
          Effect.flatMap((deferred) =>
            deferred
              ? Effect.void
              : publishCurrentPresentation(window).pipe(
                  Effect.andThen(electronWindow.reveal(window)),
                  Effect.andThen(dismissConnectingSplash),
                ),
          ),
        ),
      );
    });

    loadApplication();
    if (environment.isDevelopment) {
      window.webContents.openDevTools({ mode: "detach" });
    }

    window.on("closed", () => {
      clearDevelopmentLoadRetry();
      clearCompactGeometrySync();
      Electron.screen?.removeListener("display-added", onDisplayMetricsChanged);
      Electron.screen?.removeListener("display-removed", onDisplayMetricsChanged);
      Electron.screen?.removeListener("display-metrics-changed", onDisplayMetricsChanged);
      void runPromise(electronWindow.clearMain(Option.some(window)));
    });

    return window;
  });

  const createMain = Effect.gen(function* () {
    const window = yield* createWindow();
    yield* electronWindow.setMain(window);
    yield* logWindowInfo("main window created");
    return window;
  }).pipe(Effect.withSpan("desktop.window.createMain"));

  const ensureMain = Effect.gen(function* () {
    const existingWindow = yield* currentMainWindow;
    if (Option.isSome(existingWindow)) {
      return existingWindow.value;
    }
    return yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.ensureMain"));

  const revealAfterRendererReady = Effect.fn("desktop.window.revealAfterRendererReady")(function* (
    window: Electron.BrowserWindow,
  ) {
    yield* publishCurrentPresentation(window);
    yield* flushPendingNavigation(window);
    yield* Ref.set(deferAutomaticRevealRef, false);
    yield* electronWindow.reveal(window);
    yield* dismissConnectingSplash;
  });

  const scheduleRevealAfterRendererReady = (window: Electron.BrowserWindow): void => {
    if (!navigationLoadListeners.has(window.webContents)) {
      navigationLoadListeners.add(window.webContents);
      window.webContents.once("did-finish-load", () => {
        navigationLoadListeners.delete(window.webContents);
        void runPromise(revealAfterRendererReady(window));
      });
    }
  };

  const showWorkspace = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* transitionPresentation(window, "workspace", null);
    if (window.webContents.isLoadingMainFrame()) {
      scheduleRevealAfterRendererReady(window);
      return window;
    }
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.showWorkspace"));

  const showConversationFocus = Effect.gen(function* () {
    const window = yield* ensureMain;
    yield* transitionPresentation(window, "conversation-focus", null);
    if (window.webContents.isLoadingMainFrame()) {
      scheduleRevealAfterRendererReady(window);
      return window;
    }
    yield* electronWindow.reveal(window);
    return window;
  }).pipe(Effect.withSpan("desktop.window.showConversationFocus"));

  const openCompanionConversation = Effect.fn("desktop.window.openCompanionConversation")(
    function* (threadRef: ScopedThreadRef, anchor: CompanionWindowAnchor) {
      yield* Ref.set(pendingNavigationRef, Option.some(threadRef));
      const existingWindow = yield* currentMainWindow;
      if (Option.isNone(existingWindow)) {
        yield* Ref.set(deferAutomaticRevealRef, true);
      }
      const window = Option.isSome(existingWindow) ? existingWindow.value : yield* ensureMain;
      yield* transitionPresentation(window, "conversation-focus", anchor);
      if (window.webContents.isLoadingMainFrame()) {
        scheduleRevealAfterRendererReady(window);
        return window;
      }
      yield* flushPendingNavigation(window);
      yield* Ref.set(deferAutomaticRevealRef, false);
      yield* electronWindow.reveal(window);
      return window;
    },
  );

  const revealOrCreateMain = showWorkspace.pipe(
    Effect.withSpan("desktop.window.revealOrCreateMain"),
  );

  const createMainIfBackendReady = Effect.gen(function* () {
    const backendReady = yield* Ref.get(backendReadyRef);
    if (!backendReady) return;
    const existingWindow = yield* currentMainWindow;
    if (Option.isSome(existingWindow)) return;
    yield* createMain;
  }).pipe(Effect.withSpan("desktop.window.createMainIfBackendReady"));

  const showConnectingSplash = Effect.gen(function* () {
    // Only when nothing is shown yet: no real window, no existing splash.
    const existingSplash = yield* Ref.get(splashWindowRef);
    if (Option.isSome(existingSplash)) return;
    const existingWindow = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(existingWindow)) return;

    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const splash = yield* electronWindow.create({
      width: 360,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      center: true,
      show: false,
      skipTaskbar: false,
      backgroundColor: getInitialWindowBackgroundColor(shouldUseDarkColors),
      title: environment.displayName,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    yield* Ref.set(splashWindowRef, Option.some(splash));
    splash.once("closed", () => {
      void runPromise(Ref.set(splashWindowRef, Option.none()));
    });
    splash.once("ready-to-show", () => {
      if (!splash.isDestroyed()) {
        splash.show();
      }
    });
    void splash.loadURL(buildConnectingSplashDataUrl(shouldUseDarkColors));
    yield* logWindowInfo("connecting splash shown");
  }).pipe(
    // The splash is best-effort UX — never let it fail startup.
    Effect.catch((error) =>
      logWindowWarning("failed to show connecting splash", { message: error.message }),
    ),
    Effect.withSpan("desktop.window.showConnectingSplash"),
  );

  return DesktopWindow.of({
    createMain,
    ensureMain,
    revealOrCreateMain,
    activate: Effect.gen(function* () {
      const existingWindow = yield* currentMainWindow;
      if (Option.isSome(existingWindow)) {
        yield* transitionPresentation(existingWindow.value, "workspace", null);
        yield* electronWindow.reveal(existingWindow.value);
        return;
      }
      // No real main window yet. While the backend is still cold-booting,
      // re-reveal the connecting splash so taskbar/dock activation brings it
      // back instead of doing nothing. Once the backend is ready we fall
      // through to (re)create the real main -- including retrying a previously
      // failed open the pool swallowed -- rather than latching onto the splash.
      const backendReady = yield* Ref.get(backendReadyRef);
      if (!backendReady) {
        const splash = yield* Ref.get(splashWindowRef);
        if (Option.isSome(splash)) {
          yield* electronWindow.reveal(splash.value);
          return;
        }
      }
      if (backendReady) {
        yield* showWorkspace;
      }
    }).pipe(Effect.withSpan("desktop.window.activate")),
    createMainIfBackendReady,
    showConnectingSplash,
    handleBackendReady: Effect.fn("desktop.window.handleBackendReady")(function* (httpBaseUrl) {
      yield* Ref.set(backendReadyRef, true);
      yield* logWindowInfo("backend ready", { source: "http", url: httpBaseUrl.href });
      yield* createMainIfBackendReady;
    }),
    handleBackendNotReady: Ref.set(backendReadyRef, false).pipe(
      Effect.withSpan("desktop.window.handleBackendNotReady"),
    ),
    dispatchMenuAction: Effect.fn("desktop.window.dispatchMenuAction")(function* (action) {
      yield* Effect.annotateCurrentSpan({ action });
      const existingWindow = yield* focusedMainWindow;
      if (Option.isNone(existingWindow) && !(yield* Ref.get(backendReadyRef))) {
        return;
      }
      const targetWindow = Option.isSome(existingWindow) ? existingWindow.value : yield* ensureMain;

      yield* transitionPresentation(targetWindow, "workspace", null);

      const send = () =>
        runPromise(
          Effect.sync(() => {
            if (!targetWindow.isDestroyed()) {
              targetWindow.webContents.send(MENU_ACTION_CHANNEL, action);
            }
          }).pipe(Effect.andThen(electronWindow.reveal(targetWindow))),
        );

      if (targetWindow.webContents.isLoadingMainFrame()) {
        targetWindow.webContents.once("did-finish-load", () => {
          void send();
        });
        return;
      }

      yield* Effect.promise(send);
    }),
    navigateToThread: Effect.fn("desktop.window.navigateToThread")(function* (threadRef) {
      const existingWindow = yield* currentMainWindow;
      const anchor = {
        bounds: Option.isSome(existingWindow)
          ? existingWindow.value.getBounds()
          : Electron.screen.getPrimaryDisplay().workArea,
      };
      return yield* openCompanionConversation(threadRef, anchor);
    }),
    openCompanionConversation,
    showWorkspace,
    showConversationFocus,
    getPresentation: Ref.get(presentationRef),
    requestPresentation: Effect.fn("desktop.window.requestPresentation")(
      function* (mode, senderWebContentsId) {
        if (!(yield* isCurrentMainSender(senderWebContentsId))) {
          yield* logWindowWarning("rejected presentation request from an unregistered renderer", {
            senderWebContentsId,
          });
          return yield* Ref.get(presentationRef);
        }
        const window = yield* ensureMain;
        return yield* transitionPresentation(window, mode, null);
      },
    ),
    acknowledgePresentation: Effect.fn("desktop.window.acknowledgePresentation")(
      function* (input, senderWebContentsId) {
        if (!(yield* isCurrentMainSender(senderWebContentsId))) {
          yield* logWindowWarning(
            "rejected presentation acknowledgement from an unregistered renderer",
            { senderWebContentsId },
          );
          return;
        }
        const current = yield* Ref.get(presentationRef);
        if (input.transitionId !== current.transitionId || input.mode !== current.mode) return;
        yield* Ref.update(lastAcknowledgedPresentationRef, (value) =>
          Math.max(value, input.transitionId),
        );
        const pending = pendingPresentationAcknowledgements.get(input.transitionId);
        if (pending?.mode === input.mode) {
          yield* Deferred.succeed(pending.deferred, undefined);
        }
      },
    ),
    syncAppearance: Effect.gen(function* () {
      const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
      yield* electronWindow.syncAllAppearance((window) =>
        syncWindowAppearance(window, shouldUseDarkColors, environment.platform),
      );
    }).pipe(Effect.withSpan("desktop.window.syncAppearance")),
  });
});

export const layer = Layer.effect(DesktopWindow, make);
