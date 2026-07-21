import {
  DesktopCompanionPortalInteractiveInput,
  DesktopCompanionPortalMetricsInput,
  DesktopCompanionPortalTokenInput,
  CompanionPointerEvent,
  CompanionProjectionSnapshot,
  DEFAULT_COMPANION_DESKTOP_EXPANDED_VIEW,
  DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT,
  type CompanionId,
  type CompanionDesktopExpandedView,
  type CompanionProjection,
  type DesktopCompanionCardMode,
  type DesktopCompanionOverlayPresentation,
  type DesktopCompanionPortalLayout,
  type DesktopCompanionPortalSurface,
  type DesktopCompanionPresentation,
  type DesktopCompanionVisibilityControlPresentation,
  type MainWindowAttentionState as MainWindowAttentionStateType,
} from "@t3tools/contracts";
import { companionDisplayDimensions } from "@t3tools/client-runtime/companions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import * as NodeCrypto from "node:crypto";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import {
  DESKTOP_COMPANION_VISIBILITY_CONTROL_POSITION_KEY,
  DesktopCompanionPositions,
  boundsFromPosition,
  constrainCompanionBounds,
  defaultCompanionBounds,
  defaultCompanionVisibilityControlBounds,
  positionFromBounds,
  type Rectangle,
} from "./DesktopCompanionPositions.ts";
import {
  cancelDesktopCompanionPortal,
  registerDesktopCompanionPortal,
  resetDesktopCompanionPortalRegistry,
} from "./DesktopCompanionPortalRegistry.ts";
import {
  captureDesktopCompanionNativeFocusOrigin,
  focusDesktopCompanionPortalWindow,
  prepareDesktopCompanionPortalFocus,
  restoreDesktopCompanionDevTools,
  restoreDesktopCompanionPortalFocus,
  suspendDesktopCompanionDevTools,
  type DesktopCompanionNativeFocusOrigin,
} from "./DesktopCompanionNativeFocus.ts";
import {
  COMPANION_COMPOSER_BUTTON_INSET,
  COMPANION_COMPOSER_BUTTON_SIZE,
  chooseCompanionPreviewGeometry,
  rectangleContainsPoint,
  type DesktopCompanionPreviewGeometry,
} from "./DesktopCompanionPreviewLayout.ts";

const DRAG_THRESHOLD = 6;
const MIN_MOVE_INTERVAL_MS = 1_000 / 60;
const VISIBILITY_CONTROL_SIZE = 40;
const decodeCompanionProjectionSnapshot = Schema.decodeUnknownEffect(CompanionProjectionSnapshot);
const decodeCompanionPointerEvent = Schema.decodeUnknownEffect(CompanionPointerEvent);
const decodeInteractive = Schema.decodeUnknownEffect(Schema.Boolean);
const decodePortalTokenInput = Schema.decodeUnknownEffect(DesktopCompanionPortalTokenInput);
const decodePortalMetricsInput = Schema.decodeUnknownEffect(DesktopCompanionPortalMetricsInput);
const decodePortalInteractiveInput = Schema.decodeUnknownEffect(
  DesktopCompanionPortalInteractiveInput,
);

interface CompanionLayout {
  projection: CompanionProjection;
  bounds: Rectangle;
  preview:
    | (DesktopCompanionPreviewGeometry & {
        readonly mode: DesktopCompanionCardMode;
      })
    | null;
}

interface DragState {
  readonly companionId: CompanionId;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly companionX: number;
  readonly companionY: number;
  dragging: boolean;
  lastMoveAt: number;
}

interface VisibilityControlDragState {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly controlX: number;
  readonly controlY: number;
  dragging: boolean;
  lastMoveAt: number;
}

interface OverlayWindowEntry {
  readonly window: Electron.BrowserWindow;
  readonly displayId: string;
  workArea: Electron.Rectangle;
  overlayBounds: Electron.Rectangle;
  layouts: CompanionLayout[];
  visibilityControlBounds: Rectangle | null;
  drag: DragState | null;
  visibilityControlDrag: VisibilityControlDragState | null;
  press: {
    readonly companionId: CompanionId | null;
    readonly target: CompanionPointerEvent["target"];
  } | null;
}

interface OverlayGroup {
  readonly display: Electron.Display;
  layouts: CompanionLayout[];
  visibilityControlBounds: Rectangle | null;
}

interface AcceptedSnapshot {
  readonly sourceEpoch: string;
  readonly revision: number;
  readonly retiredEpochs: ReadonlySet<string>;
}

interface PreviewSessionState {
  readonly threadKey: string;
  expanded: boolean;
  placement?: DesktopCompanionPreviewGeometry["placement"] | undefined;
  cardSize?: { readonly width: number; readonly height: number } | undefined;
}

interface CompanionPortalSession {
  readonly token: string;
  readonly frameName: string;
  readonly url: string;
  readonly companionId: CompanionId;
  readonly surface: DesktopCompanionPortalSurface;
  readonly mainWindow: Electron.BrowserWindow;
  readonly focusOrigin: DesktopCompanionNativeFocusOrigin;
  restoreExternalApplication: boolean;
  window: Electron.BrowserWindow | null;
  displayId: string;
  ready: boolean;
  layoutRevision: number;
  lastLayoutSignature: string | null;
  openTimeoutFiber: Fiber.Fiber<void, never> | null;
}

export function acceptCompanionSnapshot(
  current: AcceptedSnapshot | null,
  incoming: Pick<CompanionProjectionSnapshot, "sourceEpoch" | "revision">,
): AcceptedSnapshot | null {
  if (current === null) {
    return { ...incoming, retiredEpochs: new Set() };
  }
  if (incoming.sourceEpoch === current.sourceEpoch) {
    return incoming.revision > current.revision
      ? { ...current, revision: incoming.revision }
      : null;
  }
  if (current.retiredEpochs.has(incoming.sourceEpoch)) {
    return null;
  }
  return {
    sourceEpoch: incoming.sourceEpoch,
    revision: incoming.revision,
    retiredEpochs: new Set([...current.retiredEpochs, current.sourceEpoch]),
  };
}

function attentionStateForWindow(
  window: Electron.BrowserWindow | null,
): MainWindowAttentionStateType {
  return window === null || window.isDestroyed()
    ? { visible: false, focused: false, minimized: false }
    : {
        visible: window.isVisible(),
        focused: window.isFocused(),
        minimized: window.isMinimized(),
      };
}

function companionUrl(isDevelopment: boolean): string {
  return new URL("companion.html", getDesktopUrl(isDevelopment)).href;
}

function companionPortalUrl(isDevelopment: boolean, token: string): string {
  const url = new URL("companion-portal.html", getDesktopUrl(isDevelopment));
  url.searchParams.set("token", token);
  return url.href;
}

export function desktopCompanionPresentation(input: {
  readonly projection: CompanionProjection;
  readonly bounds: Rectangle;
  readonly preview: CompanionLayout["preview"];
  readonly overlayBounds: Rectangle;
  readonly desktopExpandedView: CompanionDesktopExpandedView;
}): DesktopCompanionPresentation {
  const conversationPreview = input.projection.preview;
  const preview =
    input.preview === null || conversationPreview === null
      ? null
      : {
          mode: input.preview.mode,
          placement: input.preview.placement,
          assistantMessageId: conversationPreview.assistantMessageId,
          assistantText: conversationPreview.assistantText,
          assistantStreaming: conversationPreview.assistantStreaming,
          composerAvailable: !["working", "connecting", "offline"].includes(
            input.projection.signal,
          ),
          showComposerButton: input.desktopExpandedView === "response-only",
          cardX: Math.max(0, Math.round(input.preview.cardBounds.x - input.overlayBounds.x)),
          cardY: Math.max(0, Math.round(input.preview.cardBounds.y - input.overlayBounds.y)),
          cardWidth: Math.round(input.preview.cardBounds.width),
          cardHeight: Math.round(input.preview.cardBounds.height),
          toggleX: Math.max(0, Math.round(input.preview.toggleBounds.x - input.overlayBounds.x)),
          toggleY: Math.max(0, Math.round(input.preview.toggleBounds.y - input.overlayBounds.y)),
          toggleSize: Math.round(input.preview.toggleBounds.width),
          composerButtonX: Math.max(
            0,
            Math.round(
              input.preview.cardBounds.x +
                input.preview.cardBounds.width -
                COMPANION_COMPOSER_BUTTON_INSET -
                COMPANION_COMPOSER_BUTTON_SIZE -
                input.overlayBounds.x,
            ),
          ),
          composerButtonY: Math.max(
            0,
            Math.round(
              input.preview.cardBounds.y +
                input.preview.cardBounds.height -
                COMPANION_COMPOSER_BUTTON_INSET -
                COMPANION_COMPOSER_BUTTON_SIZE -
                input.overlayBounds.y,
            ),
          ),
          composerButtonSize: COMPANION_COMPOSER_BUTTON_SIZE,
        };
  return {
    companionId: input.projection.companionId,
    signal: input.projection.signal,
    baseAnimation: input.projection.baseAnimation,
    accessibleLabel: input.projection.accessibleLabel,
    x: Math.max(0, Math.round(input.bounds.x - input.overlayBounds.x)),
    y: Math.max(0, Math.round(input.bounds.y - input.overlayBounds.y)),
    width: input.bounds.width,
    height: input.bounds.height,
    preview,
  };
}

export function companionOverlayBounds(
  _layouts: readonly Pick<CompanionLayout, "bounds" | "preview">[],
  workArea: Rectangle,
): Rectangle {
  return { ...workArea };
}

export function desktopCompanionVisibilityControlPresentation(input: {
  readonly bounds: Rectangle;
  readonly overlayBounds: Rectangle;
}): DesktopCompanionVisibilityControlPresentation {
  return {
    x: Math.max(0, Math.round(input.bounds.x - input.overlayBounds.x)),
    y: Math.max(0, Math.round(input.bounds.y - input.overlayBounds.y)),
    size: input.bounds.width,
  };
}

function rectanglesEqual(left: Rectangle, right: Rectangle): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export class DesktopCompanionManager extends Context.Service<
  DesktopCompanionManager,
  {
    readonly install: Effect.Effect<void, never, Scope.Scope>;
    readonly syncProjection: (
      snapshot: CompanionProjectionSnapshot,
      senderWebContentsId: number,
    ) => Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly resetPositions: (
      senderWebContentsId: number,
    ) => Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly destroyAll: Effect.Effect<void>;
  }
>()("@t3tools/desktop/companions/DesktopCompanionManager") {}

const { logInfo, logWarning } = makeComponentLogger("desktop-companions");

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const positions = yield* DesktopCompanionPositions;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runPromise = Effect.runPromise;
  const runFork = Effect.runFork;
  const overlays = new Map<string, OverlayWindowEntry>();
  const displayIdByWebContentsId = new Map<number, string>();
  const guardedMainWindows = new WeakSet<Electron.BrowserWindow>();
  const inFlightPositions = new Map<
    CompanionId,
    { readonly displayId: string; readonly bounds: Rectangle }
  >();
  let inFlightVisibilityControl: {
    readonly displayId: string;
    readonly bounds: Rectangle;
  } | null = null;
  const previewSessions = new Map<CompanionId, PreviewSessionState>();
  let desiredProjections = new Map<CompanionId, CompanionProjection>();
  let desktopScalePercent = DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT;
  let desktopPreviewsEnabled = true;
  let desktopExpandedView = DEFAULT_COMPANION_DESKTOP_EXPANDED_VIEW;
  let companionsVisible = true;
  let desiredDisplayIds = new Set<string>();
  let acceptedSnapshot: AcceptedSnapshot | null = null;
  let reconciliationFiber: Fiber.Fiber<void, never> | null = null;
  let activePortal: CompanionPortalSession | null = null;
  let pendingNativeFocusRestore: Fiber.Fiber<void, never> | null = null;
  let nativeFocusRestoreRevision = 0;
  let mainDevToolsRestorePending = false;
  let emitActivePortalLayout = (): void => undefined;
  let closeActivePortal = (): void => undefined;
  let quitting = false;

  const cancelPendingNativeFocusRestore = (): void => {
    const pending = pendingNativeFocusRestore;
    if (pending === null) return;
    nativeFocusRestoreRevision += 1;
    pendingNativeFocusRestore = null;
    runFork(Fiber.interrupt(pending));
  };

  const currentMain = electronWindow.main.pipe(Effect.map(Option.getOrNull));

  const restoreMainDevToolsAfterExplicitFocus = (window: Electron.BrowserWindow): void => {
    if (!environment.isDevelopment || window.isDestroyed()) return;
    const restored = restoreDesktopCompanionDevTools({
      devTools: window.webContents,
      mainWindowFocused: window.isFocused(),
      restorePending: mainDevToolsRestorePending,
    });
    if (restored) mainDevToolsRestorePending = false;
  };

  const isCurrentMainSender = (senderWebContentsId: number) =>
    currentMain.pipe(
      Effect.map(
        (window) =>
          window !== null && !window.isDestroyed() && window.webContents.id === senderWebContentsId,
      ),
    );

  const entryForSender = (senderWebContentsId: number): OverlayWindowEntry | null => {
    const displayId = displayIdByWebContentsId.get(senderWebContentsId);
    return displayId ? (overlays.get(displayId) ?? null) : null;
  };

  const presentationForEntry = (
    entry: OverlayWindowEntry,
  ): DesktopCompanionOverlayPresentation => ({
    displayId: entry.displayId,
    companionsVisible,
    visibilityControl:
      entry.visibilityControlBounds === null
        ? null
        : desktopCompanionVisibilityControlPresentation({
            bounds: entry.visibilityControlBounds,
            overlayBounds: entry.overlayBounds,
          }),
    companions: entry.layouts.map((layout) =>
      desktopCompanionPresentation({
        projection: layout.projection,
        bounds: layout.bounds,
        preview: layout.preview,
        overlayBounds: entry.overlayBounds,
        desktopExpandedView,
      }),
    ),
  });

  const sendOverlayPresentation = (entry: OverlayWindowEntry): void => {
    if (entry.window.isDestroyed()) return;
    entry.window.webContents.send(
      IpcChannels.COMPANION_PROJECTION_CHANNEL,
      presentationForEntry(entry),
    );
    emitActivePortalLayout();
  };

  const emitAttentionState = (window: Electron.BrowserWindow): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(
      IpcChannels.MAIN_WINDOW_ATTENTION_STATE_CHANNEL,
      attentionStateForWindow(window),
    );
  };

  const markCompanionsReconnecting = (): void => {
    closeActivePortal();
    desiredProjections = new Map(
      [...desiredProjections].map(([companionId, projection]) => [
        companionId,
        {
          ...projection,
          signal: "connecting",
          baseAnimation: "thinking",
          accessibleLabel: `${projection.threadTitle}: Reconnecting`,
        },
      ]),
    );
    for (const entry of overlays.values()) {
      entry.layouts = entry.layouts.map((layout) => ({
        ...layout,
        projection: desiredProjections.get(layout.projection.companionId) ?? layout.projection,
      }));
      sendOverlayPresentation(entry);
    }
  };

  const attachMainWindowGuards = (window: Electron.BrowserWindow): void => {
    if (guardedMainWindows.has(window)) return;
    guardedMainWindows.add(window);
    window.on("close", (event) => {
      if (!quitting && desiredProjections.size > 0) {
        event.preventDefault();
        window.hide();
        emitAttentionState(window);
      }
    });
    const keepMainWindowPassiveForPortal = (): void => {
      const portal = activePortal;
      if (portal === null || portal.mainWindow !== window || !portal.restoreExternalApplication) {
        return;
      }
      prepareDesktopCompanionPortalFocus({
        mainWindow: window,
        origin: {
          ...portal.focusOrigin,
          restoreExternalApplication: portal.restoreExternalApplication,
        },
      });
    };
    window.on("show", () => {
      keepMainWindowPassiveForPortal();
      emitAttentionState(window);
    });
    window.on("hide", () => emitAttentionState(window));
    window.on("focus", () => {
      keepMainWindowPassiveForPortal();
      if (!activePortal?.restoreExternalApplication) {
        restoreMainDevToolsAfterExplicitFocus(window);
      }
      emitAttentionState(window);
    });
    window.on("blur", () => emitAttentionState(window));
    window.on("minimize", () => emitAttentionState(window));
    window.on("restore", () => emitAttentionState(window));
    window.webContents.on("render-process-gone", markCompanionsReconnecting);
    emitAttentionState(window);
  };

  const resolveDisplay = (displayId: string | null): Electron.Display => {
    const displays = Electron.screen.getAllDisplays();
    return (
      (displayId === null
        ? undefined
        : displays.find((display) => String(display.id) === displayId)) ??
      Electron.screen.getPrimaryDisplay()
    );
  };

  const previewThreadKey = (projection: CompanionProjection): string =>
    `${projection.threadRef.environmentId}\u0000${projection.threadRef.threadId}`;

  const previewSessionFor = (projection: CompanionProjection): PreviewSessionState => {
    const threadKey = previewThreadKey(projection);
    const existing = previewSessions.get(projection.companionId);
    if (existing?.threadKey === threadKey) return existing;
    const created: PreviewSessionState = { threadKey, expanded: false };
    previewSessions.set(projection.companionId, created);
    return created;
  };

  const applyPreviewGeometry = (input: {
    readonly workArea: Rectangle;
    readonly layouts: CompanionLayout[];
  }): void => {
    const spriteBounds = input.layouts.map((layout) => layout.bounds);
    const occupied: Rectangle[] = [];
    for (const layout of input.layouts) {
      if (!desktopPreviewsEnabled || layout.projection.preview === null) {
        layout.preview = null;
        continue;
      }
      const session = previewSessionFor(layout.projection);
      const geometry = chooseCompanionPreviewGeometry({
        companionBounds: layout.bounds,
        workArea: input.workArea,
        obstacles: [...spriteBounds.filter((bounds) => bounds !== layout.bounds), ...occupied],
        previousPlacement: session.placement,
      });
      session.placement = geometry.placement;
      const portalMode =
        activePortal?.companionId === layout.projection.companionId &&
        (activePortal.ready || activePortal.surface === "response-and-composer")
          ? "composer"
          : null;
      layout.preview = {
        ...geometry,
        mode: portalMode ?? (session.expanded ? "preview" : "collapsed"),
      };
      occupied.push(geometry.toggleBounds);
      if (session.expanded || portalMode !== null) occupied.push(geometry.cardBounds);
    }
  };

  const buildOverlayGroups = Effect.fn("desktop.companions.buildOverlayGroups")(function* () {
    const groups = new Map<string, OverlayGroup>();
    if (desiredProjections.size === 0) return groups;
    for (const display of Electron.screen.getAllDisplays()) {
      groups.set(String(display.id), { display, layouts: [], visibilityControlBounds: null });
    }
    const defaultIndexByDisplay = new Map<string, number>();
    const dimensions = companionDisplayDimensions(desktopScalePercent);
    for (const projection of desiredProjections.values()) {
      const inFlight = inFlightPositions.get(projection.companionId);
      const saved = inFlight ? null : yield* positions.get(projection.companionId);
      const display = inFlight
        ? resolveDisplay(inFlight.displayId)
        : resolveDisplay(saved?.displayId ?? null);
      const displayId = String(display.id);
      const defaultIndex = defaultIndexByDisplay.get(displayId) ?? 0;
      defaultIndexByDisplay.set(displayId, defaultIndex + 1);
      const bounds = inFlight
        ? {
            ...inFlight.bounds,
            width: dimensions.width,
            height: dimensions.height,
          }
        : saved
          ? boundsFromPosition({
              position: saved,
              workArea: display.workArea,
              width: dimensions.width,
              height: dimensions.height,
            })
          : defaultCompanionBounds({
              index: defaultIndex,
              workArea: display.workArea,
              width: dimensions.width,
              height: dimensions.height,
            });
      const group = groups.get(displayId) ?? {
        display,
        layouts: [],
        visibilityControlBounds: null,
      };
      group.layouts.push({
        projection,
        bounds: constrainCompanionBounds(bounds, display.workArea),
        preview: null,
      });
      groups.set(displayId, group);
    }

    const savedVisibilityControl = inFlightVisibilityControl
      ? null
      : yield* positions.get(DESKTOP_COMPANION_VISIBILITY_CONTROL_POSITION_KEY);
    const visibilityControlDisplay = inFlightVisibilityControl
      ? resolveDisplay(inFlightVisibilityControl.displayId)
      : resolveDisplay(savedVisibilityControl?.displayId ?? null);
    const visibilityControlBounds = inFlightVisibilityControl
      ? {
          ...inFlightVisibilityControl.bounds,
          width: VISIBILITY_CONTROL_SIZE,
          height: VISIBILITY_CONTROL_SIZE,
        }
      : savedVisibilityControl
        ? boundsFromPosition({
            position: savedVisibilityControl,
            workArea: visibilityControlDisplay.workArea,
            width: VISIBILITY_CONTROL_SIZE,
            height: VISIBILITY_CONTROL_SIZE,
          })
        : defaultCompanionVisibilityControlBounds({
            workArea: visibilityControlDisplay.workArea,
            size: VISIBILITY_CONTROL_SIZE,
          });
    const visibilityControlDisplayId = String(visibilityControlDisplay.id);
    const visibilityControlGroup = groups.get(visibilityControlDisplayId) ?? {
      display: visibilityControlDisplay,
      layouts: [],
      visibilityControlBounds: null,
    };
    visibilityControlGroup.visibilityControlBounds = constrainCompanionBounds(
      visibilityControlBounds,
      visibilityControlDisplay.workArea,
    );
    groups.set(visibilityControlDisplayId, visibilityControlGroup);

    for (const group of groups.values()) {
      applyPreviewGeometry({ workArea: group.display.workArea, layouts: group.layouts });
    }
    return groups;
  });

  let scheduleReconciliation = (): void => undefined;
  let reconcileOverlays: Effect.Effect<void, ElectronWindow.ElectronWindowCreateError> =
    Effect.void;

  const createOverlayWindow = Effect.fn("desktop.companions.createOverlayWindow")(function* (
    group: OverlayGroup,
  ) {
    const displayId = String(group.display.id);
    const overlayBounds = companionOverlayBounds(group.layouts, group.display.workArea);
    const window = yield* electronWindow.create({
      ...overlayBounds,
      title: `${environment.displayName} — Desktop companions`,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      type: "panel",
      backgroundColor: "#00000000",
      webPreferences: {
        preload: environment.path.join(environment.dirname, "companion-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const entry: OverlayWindowEntry = {
      window,
      displayId,
      workArea: group.display.workArea,
      overlayBounds,
      layouts: group.layouts,
      visibilityControlBounds: group.visibilityControlBounds,
      drag: null,
      visibilityControlDrag: null,
      press: null,
    };
    const webContentsId = window.webContents.id;
    overlays.set(displayId, entry);
    displayIdByWebContentsId.set(webContentsId, displayId);
    ElectronWindow.excludeWindowFromAppearanceSync(window);
    ElectronWindow.excludeWindowFromMainFallback(window);

    window.setHasShadow(false);
    window.setFocusable(false);
    window.setAlwaysOnTop(true, "screen-saver", 1);
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== companionUrl(environment.isDevelopment)) event.preventDefault();
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      void runPromise(
        logWarning("companion overlay renderer exited", {
          displayId,
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
      if (!window.isDestroyed()) window.destroy();
    });
    window.on("closed", () => {
      displayIdByWebContentsId.delete(webContentsId);
      if (overlays.get(displayId)?.window === window) overlays.delete(displayId);
      if (desiredDisplayIds.has(displayId)) scheduleReconciliation();
    });
    void window.loadURL(companionUrl(environment.isDevelopment)).catch((cause) => {
      void runPromise(
        logWarning("companion overlay failed to load", {
          displayId,
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      if (!window.isDestroyed()) window.destroy();
    });
    yield* logInfo("companion overlay created", {
      displayId,
      companionCount: group.layouts.length,
    });
  });

  reconcileOverlays = Effect.gen(function* () {
    if (environment.platform !== "darwin") return;
    const groups = yield* buildOverlayGroups();
    desiredDisplayIds = new Set(groups.keys());

    for (const [displayId, entry] of overlays) {
      if (groups.has(displayId)) continue;
      overlays.delete(displayId);
      displayIdByWebContentsId.delete(entry.window.webContents.id);
      if (!entry.window.isDestroyed()) entry.window.destroy();
    }

    for (const [displayId, group] of groups) {
      const entry = overlays.get(displayId);
      if (!entry) {
        yield* createOverlayWindow(group);
        continue;
      }
      entry.workArea = group.display.workArea;
      entry.layouts = group.layouts;
      entry.visibilityControlBounds = group.visibilityControlBounds;
      if (
        entry.drag &&
        !group.layouts.some((layout) => layout.projection.companionId === entry.drag?.companionId)
      ) {
        entry.drag = null;
      }
      if (
        entry.press &&
        entry.press.target !== "visibility-control" &&
        !group.layouts.some((layout) => layout.projection.companionId === entry.press?.companionId)
      ) {
        entry.press = null;
      }
      if (entry.visibilityControlDrag && group.visibilityControlBounds === null) {
        entry.visibilityControlDrag = null;
      }
      if (!entry.window.isDestroyed()) {
        const nextOverlayBounds = companionOverlayBounds(group.layouts, group.display.workArea);
        if (!rectanglesEqual(entry.overlayBounds, nextOverlayBounds)) {
          entry.overlayBounds = nextOverlayBounds;
          entry.window.setBounds(nextOverlayBounds, false);
        }
        sendOverlayPresentation(entry);
      }
    }

    const mainWindow = yield* currentMain;
    if (mainWindow) attachMainWindowGuards(mainWindow);
  });

  scheduleReconciliation = () => {
    if (quitting || desiredProjections.size === 0 || reconciliationFiber !== null) return;
    const recreation = Effect.sleep(1_000).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          reconciliationFiber = null;
          return reconcileOverlays.pipe(
            Effect.catch((cause) =>
              logWarning("companion overlay recreation failed", {
                cause: cause.message,
              }).pipe(Effect.andThen(Effect.sync(scheduleReconciliation))),
            ),
          );
        }),
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          reconciliationFiber = null;
        }),
      ),
    );
    reconciliationFiber = runFork(recreation);
  };

  const cancelScheduledReconciliation = Effect.gen(function* () {
    const fiber = reconciliationFiber;
    if (!fiber) return;
    reconciliationFiber = null;
    yield* Fiber.interrupt(fiber);
  });

  const revealAndNavigate = Effect.fn("desktop.companions.navigate")(function* (
    layout: CompanionLayout,
  ) {
    if (activePortal) activePortal.restoreExternalApplication = false;
    cancelPendingNativeFocusRestore();
    const mainWindow = yield* desktopWindow.openCompanionConversation(layout.projection.threadRef, {
      bounds: layout.bounds,
    });
    attachMainWindowGuards(mainWindow);
  });

  const acknowledgeProjection = Effect.fn("desktop.companions.acknowledge")(function* (
    projection: CompanionProjection,
  ) {
    const mainWindow = yield* currentMain;
    if (mainWindow === null || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(
      IpcChannels.COMPANION_ACKNOWLEDGE_THREAD_CHANNEL,
      projection.threadRef,
    );
  });

  const findDraggedLayout = (
    companionId: CompanionId,
  ): { readonly entry: OverlayWindowEntry; readonly layout: CompanionLayout } | null => {
    for (const entry of overlays.values()) {
      const layout = entry.layouts.find(
        (candidate) => candidate.projection.companionId === companionId,
      );
      if (layout) return { entry, layout };
    }
    return null;
  };

  const findVisibilityControl = (): {
    readonly entry: OverlayWindowEntry;
    readonly bounds: Rectangle;
  } | null => {
    for (const entry of overlays.values()) {
      if (entry.visibilityControlBounds) {
        return { entry, bounds: entry.visibilityControlBounds };
      }
    }
    return null;
  };

  const pointerTargetBounds = (
    layout: CompanionLayout,
    target: CompanionPointerEvent["target"],
  ): Rectangle | null => {
    if (target === "companion") return layout.bounds;
    if (layout.preview === null) return null;
    if (target === "toggle") return layout.preview.toggleBounds;
    if (target === "composer") {
      if (desktopExpandedView !== "response-only" || layout.preview.mode !== "preview") return null;
      return {
        x:
          layout.preview.cardBounds.x +
          layout.preview.cardBounds.width -
          COMPANION_COMPOSER_BUTTON_INSET -
          COMPANION_COMPOSER_BUTTON_SIZE,
        y:
          layout.preview.cardBounds.y +
          layout.preview.cardBounds.height -
          COMPANION_COMPOSER_BUTTON_INSET -
          COMPANION_COMPOSER_BUTTON_SIZE,
        width: COMPANION_COMPOSER_BUTTON_SIZE,
        height: COMPANION_COMPOSER_BUTTON_SIZE,
      };
    }
    return layout.preview.mode === "preview" ? layout.preview.cardBounds : null;
  };

  const moveLayout = (layout: CompanionLayout, nextBounds: Rectangle): void => {
    layout.bounds = nextBounds;
  };

  const reflowEntry = (entry: OverlayWindowEntry): void => {
    applyPreviewGeometry({ workArea: entry.workArea, layouts: entry.layouts });
    sendOverlayPresentation(entry);
  };

  const moveVisibilityControlToDisplay = (
    located: { readonly entry: OverlayWindowEntry; readonly bounds: Rectangle },
    display: Electron.Display,
    nextBounds: Rectangle,
  ): { readonly entry: OverlayWindowEntry; readonly bounds: Rectangle } => {
    const nextEntry = overlays.get(String(display.id)) ?? located.entry;
    const constrained = constrainCompanionBounds(nextBounds, display.workArea);
    if (nextEntry === located.entry) {
      located.entry.visibilityControlBounds = constrained;
      sendOverlayPresentation(located.entry);
      return { entry: located.entry, bounds: constrained };
    }
    located.entry.visibilityControlBounds = null;
    nextEntry.visibilityControlBounds = constrained;
    sendOverlayPresentation(located.entry);
    sendOverlayPresentation(nextEntry);
    return { entry: nextEntry, bounds: constrained };
  };

  const moveLayoutToDisplay = (
    located: { readonly entry: OverlayWindowEntry; readonly layout: CompanionLayout },
    display: Electron.Display,
    nextBounds: Rectangle,
  ): { readonly entry: OverlayWindowEntry; readonly layout: CompanionLayout } => {
    const nextEntry = overlays.get(String(display.id)) ?? located.entry;
    const constrained = constrainCompanionBounds(nextBounds, display.workArea);
    moveLayout(located.layout, constrained);
    if (nextEntry === located.entry) {
      reflowEntry(located.entry);
      return located;
    }
    located.entry.layouts = located.entry.layouts.filter(
      (candidate) => candidate !== located.layout,
    );
    nextEntry.layouts = [...nextEntry.layouts, located.layout];
    reflowEntry(located.entry);
    reflowEntry(nextEntry);
    return { entry: nextEntry, layout: located.layout };
  };

  const portalLayoutFor = (portal: CompanionPortalSession): DesktopCompanionPortalLayout | null => {
    const located = findDraggedLayout(portal.companionId);
    const compactPreview = located?.layout.preview;
    if (!located || !compactPreview) return null;
    const { entry } = located;
    const session = previewSessions.get(portal.companionId);
    const portalGeometry = chooseCompanionPreviewGeometry({
      companionBounds: located.layout.bounds,
      workArea: entry.workArea,
      obstacles: entry.layouts
        .filter((layout) => layout !== located.layout)
        .map((layout) => layout.bounds),
      previousPlacement: compactPreview.placement,
      cardSize: session?.cardSize,
    });
    const signature = [
      entry.displayId,
      portalGeometry.placement,
      portalGeometry.cardBounds.x,
      portalGeometry.cardBounds.y,
      portalGeometry.cardBounds.width,
      portalGeometry.cardBounds.height,
      compactPreview.cardBounds.x,
      compactPreview.cardBounds.y,
      entry.workArea.width,
      entry.workArea.height,
    ].join(":");
    if (signature === portal.lastLayoutSignature) return null;
    portal.lastLayoutSignature = signature;
    if (portal.displayId !== entry.displayId) {
      portal.displayId = entry.displayId;
    }
    if (
      portal.window &&
      !portal.window.isDestroyed() &&
      !rectanglesEqual(portal.window.getBounds(), entry.workArea)
    ) {
      portal.window.setBounds(entry.workArea, false);
    }
    const layout: DesktopCompanionPortalLayout = {
      token: portal.token,
      revision: portal.layoutRevision,
      displayId: entry.displayId,
      placement: portalGeometry.placement,
      cardX: Math.max(0, Math.round(portalGeometry.cardBounds.x - entry.overlayBounds.x)),
      cardY: Math.max(0, Math.round(portalGeometry.cardBounds.y - entry.overlayBounds.y)),
      cardWidth: Math.round(portalGeometry.cardBounds.width),
      cardHeight: Math.round(portalGeometry.cardBounds.height),
      compactCardX: Math.max(0, Math.round(compactPreview.cardBounds.x - entry.overlayBounds.x)),
      compactCardY: Math.max(0, Math.round(compactPreview.cardBounds.y - entry.overlayBounds.y)),
      compactCardWidth: Math.round(compactPreview.cardBounds.width),
      compactCardHeight: Math.round(compactPreview.cardBounds.height),
      workAreaWidth: entry.workArea.width,
      workAreaHeight: entry.workArea.height,
    };
    portal.layoutRevision += 1;
    return layout;
  };

  emitActivePortalLayout = (): void => {
    const portal = activePortal;
    if (!portal || portal.mainWindow.isDestroyed()) return;
    const layout = portalLayoutFor(portal);
    if (!layout) return;
    portal.mainWindow.webContents.send(IpcChannels.COMPANION_PORTAL_LAYOUT_CHANNEL, layout);
  };

  const restorePortalNativeFocus = (portal: CompanionPortalSession): void => {
    if (!portal.restoreExternalApplication) return;
    cancelPendingNativeFocusRestore();
    restoreDesktopCompanionPortalFocus({
      application: Electron.app,
      origin: {
        ...portal.focusOrigin,
        restoreExternalApplication: portal.restoreExternalApplication,
      },
      overlays: [...overlays.values()].map((entry) => entry.window),
      platform: environment.platform,
      schedule: (restore) => {
        const revision = ++nativeFocusRestoreRevision;
        pendingNativeFocusRestore = runFork(
          Effect.sleep(1).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (revision !== nativeFocusRestoreRevision) return;
                pendingNativeFocusRestore = null;
                if (!quitting) restore();
              }),
            ),
          ),
        );
      },
    });
  };

  const closePortalNow = (token: string, restoreApplicationFocus = true): void => {
    const portal = activePortal;
    if (!portal || portal.token !== token) return;
    activePortal = null;
    cancelDesktopCompanionPortal(token);
    if (portal.openTimeoutFiber !== null) runFork(Fiber.interrupt(portal.openTimeoutFiber));
    const session = previewSessions.get(portal.companionId);
    if (session) {
      session.expanded = false;
      session.cardSize = undefined;
    }
    // Deactivate GaiWork before destroying its focused portal. Otherwise AppKit
    // promotes the main window (or detached DevTools) as the next key window.
    if (restoreApplicationFocus) restorePortalNativeFocus(portal);
    if (portal.window && !portal.window.isDestroyed()) portal.window.destroy();
    void runPromise(reconcileOverlays).catch((cause) => {
      void runPromise(
        logWarning("could not restore companion preview after closing composer", {
          companionId: portal.companionId,
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    });
  };
  closeActivePortal = () => {
    const portal = activePortal;
    if (portal) closePortalNow(portal.token);
  };

  const requestPortalClose = (portal: CompanionPortalSession): void => {
    if (!portal.mainWindow.isDestroyed()) {
      portal.mainWindow.webContents.send(IpcChannels.COMPANION_CLOSE_COMPOSER_CHANNEL, {
        token: portal.token,
      });
    }
  };

  const configurePortalWindow = (
    portal: CompanionPortalSession,
    window: Electron.BrowserWindow,
  ): void => {
    if (activePortal?.token !== portal.token) {
      if (!window.isDestroyed()) window.destroy();
      return;
    }
    portal.window = window;
    ElectronWindow.excludeWindowFromAppearanceSync(window);
    ElectronWindow.excludeWindowFromMainFallback(window);
    window.setHasShadow(false);
    window.setAlwaysOnTop(true, "screen-saver", 2);
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== portal.url) event.preventDefault();
    });
    window.webContents.on("render-process-gone", () => closePortalNow(portal.token));
    window.on("focus", () => {
      if (
        environment.platform !== "darwin" ||
        activePortal?.token !== portal.token ||
        window.isDestroyed()
      ) {
        return;
      }
      focusDesktopCompanionPortalWindow({
        application: Electron.app,
        window,
        platform: environment.platform,
      });
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame) return;
        void runPromise(
          logWarning("companion composer document failed to load", {
            companionId: portal.companionId,
            errorCode,
            errorDescription,
            validatedUrl,
          }),
        );
      },
    );
    window.on("closed", () => {
      if (activePortal?.token === portal.token) closePortalNow(portal.token);
    });
  };

  const openComposer = Effect.fn("desktop.companions.openComposer")(function* (
    projection: CompanionProjection,
    surface: DesktopCompanionPortalSurface,
  ) {
    if (
      surface === "composer-only" &&
      ["working", "connecting", "offline"].includes(projection.signal)
    ) {
      return;
    }
    const located = findDraggedLayout(projection.companionId);
    const mainWindow = yield* currentMain;
    if (!located?.layout.preview || mainWindow === null || mainWindow.isDestroyed()) return;
    let transferredFocus:
      | {
          readonly origin: DesktopCompanionNativeFocusOrigin;
          readonly restoreExternalApplication: boolean;
        }
      | undefined;
    if (activePortal) {
      if (activePortal.companionId === projection.companionId && activePortal.surface === surface) {
        return;
      }
      transferredFocus = {
        origin: activePortal.focusOrigin,
        restoreExternalApplication: activePortal.restoreExternalApplication,
      };
      requestPortalClose(activePortal);
      closePortalNow(activePortal.token, false);
    }
    cancelPendingNativeFocusRestore();

    const focusOrigin =
      transferredFocus?.origin ??
      captureDesktopCompanionNativeFocusOrigin({
        application: {
          isFocused: () => Electron.BrowserWindow.getFocusedWindow() !== null,
        },
        platform: environment.platform,
      });
    const restoreExternalApplication =
      transferredFocus?.restoreExternalApplication ?? focusOrigin.restoreExternalApplication;
    if (transferredFocus === undefined && restoreExternalApplication) {
      prepareDesktopCompanionPortalFocus({ mainWindow, origin: focusOrigin });
      mainDevToolsRestorePending =
        suspendDesktopCompanionDevTools({
          devTools: mainWindow.webContents,
          shouldSuspend: environment.isDevelopment,
        }) || mainDevToolsRestorePending;
    }

    const session = previewSessionFor(projection);
    session.expanded = true;
    const token = NodeCrypto.randomUUID();
    const frameName = `gaiwork-companion-${projection.companionId}-${token}`;
    const url = companionPortalUrl(environment.isDevelopment, token);
    const portal: CompanionPortalSession = {
      token,
      frameName,
      url,
      companionId: projection.companionId,
      surface,
      mainWindow,
      focusOrigin,
      restoreExternalApplication,
      window: null,
      displayId: located.entry.displayId,
      ready: false,
      layoutRevision: 0,
      lastLayoutSignature: null,
      openTimeoutFiber: null,
    };
    activePortal = portal;
    registerDesktopCompanionPortal({
      token,
      url,
      frameName,
      bounds: located.entry.workArea,
      title: `${environment.displayName} — Companion composer`,
      onCreated: (window) => configurePortalWindow(portal, window),
    });
    const layout = portalLayoutFor(portal);
    if (!layout) {
      closePortalNow(token);
      return;
    }
    portal.openTimeoutFiber = runFork(
      Effect.sleep(10_000).pipe(Effect.andThen(Effect.sync(() => closePortalNow(token)))),
    );
    mainWindow.webContents.send(IpcChannels.COMPANION_OPEN_COMPOSER_CHANNEL, {
      token,
      frameName,
      url,
      companionId: projection.companionId,
      threadRef: projection.threadRef,
      surface,
      layout,
    });
  });

  const togglePreview = Effect.fn("desktop.companions.togglePreview")(function* (
    projection: CompanionProjection,
  ) {
    if (activePortal?.companionId === projection.companionId) {
      previewSessionFor(projection).expanded = false;
      requestPortalClose(activePortal);
      return;
    }
    if (desktopExpandedView === "response-and-composer") {
      if (projection.signal === "completed-unseen") {
        yield* acknowledgeProjection(projection);
      }
      yield* openComposer(projection, "response-and-composer");
      return;
    }
    const session = previewSessionFor(projection);
    const nextExpanded = !session.expanded;
    session.expanded = nextExpanded;
    if (nextExpanded && projection.signal === "completed-unseen") {
      yield* acknowledgeProjection(projection);
    }
    yield* reconcileOverlays;
  });

  const handlePointer = Effect.fn("desktop.companions.pointer")(function* (
    senderWebContentsId: number,
    pointerEvent: CompanionPointerEvent,
  ) {
    const entry = entryForSender(senderWebContentsId);
    if (!entry || entry.window.isDestroyed()) return;
    if (pointerEvent.phase === "down") {
      if (pointerEvent.target === "visibility-control") {
        const controlBounds = entry.visibilityControlBounds;
        if (
          controlBounds === null ||
          !rectangleContainsPoint(controlBounds, {
            x: pointerEvent.screenX,
            y: pointerEvent.screenY,
          })
        ) {
          yield* logWarning("rejected visibility control pointer outside its presentation bounds", {
            senderWebContentsId,
          });
          return;
        }
        entry.press = { companionId: null, target: "visibility-control" };
        entry.drag = null;
        entry.visibilityControlDrag = {
          pointerX: pointerEvent.screenX,
          pointerY: pointerEvent.screenY,
          controlX: controlBounds.x,
          controlY: controlBounds.y,
          dragging: false,
          lastMoveAt: 0,
        };
        return;
      }
      if (!companionsVisible) {
        yield* logWarning("rejected hidden companion pointer target", {
          senderWebContentsId,
          target: pointerEvent.target,
        });
        return;
      }
      const layout = entry.layouts[pointerEvent.presentationIndex];
      const targetBounds = layout ? pointerTargetBounds(layout, pointerEvent.target) : null;
      if (
        !layout ||
        targetBounds === null ||
        !rectangleContainsPoint(targetBounds, {
          x: pointerEvent.screenX,
          y: pointerEvent.screenY,
        })
      ) {
        yield* logWarning("rejected companion pointer target outside its presentation bounds", {
          senderWebContentsId,
          presentationIndex: pointerEvent.presentationIndex,
          target: pointerEvent.target,
        });
        return;
      }
      entry.press = {
        companionId: layout.projection.companionId,
        target: pointerEvent.target,
      };
      entry.visibilityControlDrag = null;
      if (pointerEvent.target !== "companion") {
        entry.drag = null;
        return;
      }
      entry.drag = {
        companionId: layout.projection.companionId,
        pointerX: pointerEvent.screenX,
        pointerY: pointerEvent.screenY,
        companionX: layout.bounds.x,
        companionY: layout.bounds.y,
        dragging: false,
        lastMoveAt: 0,
      };
      return;
    }

    if (pointerEvent.phase === "cancel") {
      entry.press = null;
      const cancelledDrag = entry.drag;
      const cancelledVisibilityControlDrag = entry.visibilityControlDrag;
      if (cancelledDrag) inFlightPositions.delete(cancelledDrag.companionId);
      entry.drag = null;
      entry.visibilityControlDrag = null;
      if (cancelledVisibilityControlDrag) inFlightVisibilityControl = null;
      if (cancelledDrag?.dragging || cancelledVisibilityControlDrag?.dragging) {
        yield* reconcileOverlays;
      }
      return;
    }

    const press = entry.press;
    const visibilityControlDrag = entry.visibilityControlDrag;
    if (press?.target === "visibility-control" && visibilityControlDrag) {
      let located = findVisibilityControl();
      if (!located) {
        entry.press = null;
        entry.visibilityControlDrag = null;
        inFlightVisibilityControl = null;
        return;
      }
      const deltaX = pointerEvent.screenX - visibilityControlDrag.pointerX;
      const deltaY = pointerEvent.screenY - visibilityControlDrag.pointerY;
      if (pointerEvent.phase === "move") {
        if (!visibilityControlDrag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
          visibilityControlDrag.dragging = true;
        }
        const now = performance.now();
        if (
          !visibilityControlDrag.dragging ||
          now - visibilityControlDrag.lastMoveAt < MIN_MOVE_INTERVAL_MS
        ) {
          return;
        }
        visibilityControlDrag.lastMoveAt = now;
        const display = Electron.screen.getDisplayNearestPoint({
          x: pointerEvent.screenX,
          y: pointerEvent.screenY,
        });
        located = moveVisibilityControlToDisplay(located, display, {
          ...located.bounds,
          x: Math.round(visibilityControlDrag.controlX + deltaX),
          y: Math.round(visibilityControlDrag.controlY + deltaY),
        });
        inFlightVisibilityControl = {
          displayId: located.entry.displayId,
          bounds: located.bounds,
        };
        return;
      }

      if (!visibilityControlDrag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
        visibilityControlDrag.dragging = true;
      }
      if (visibilityControlDrag.dragging) {
        const display = Electron.screen.getDisplayNearestPoint({
          x: pointerEvent.screenX,
          y: pointerEvent.screenY,
        });
        located = moveVisibilityControlToDisplay(located, display, {
          ...located.bounds,
          x: Math.round(visibilityControlDrag.controlX + deltaX),
          y: Math.round(visibilityControlDrag.controlY + deltaY),
        });
      }
      entry.press = null;
      entry.visibilityControlDrag = null;
      if (visibilityControlDrag.dragging) {
        const display = Electron.screen.getDisplayMatching(located.bounds as Electron.Rectangle);
        const constrained = constrainCompanionBounds(located.bounds, display.workArea);
        located.entry.visibilityControlBounds = constrained;
        yield* positions.set(
          DESKTOP_COMPANION_VISIBILITY_CONTROL_POSITION_KEY,
          positionFromBounds({
            displayId: String(display.id),
            bounds: constrained,
            workArea: display.workArea,
          }),
        );
        inFlightVisibilityControl = null;
        yield* reconcileOverlays;
        return;
      }
      inFlightVisibilityControl = null;
      if (
        pointerEvent.phase === "up" &&
        pointerEvent.target === "visibility-control" &&
        rectangleContainsPoint(located.bounds, {
          x: pointerEvent.screenX,
          y: pointerEvent.screenY,
        })
      ) {
        companionsVisible = !companionsVisible;
        if (!companionsVisible) closeActivePortal();
        for (const overlayEntry of overlays.values()) sendOverlayPresentation(overlayEntry);
      }
      return;
    }

    if (!companionsVisible) {
      entry.press = null;
      entry.drag = null;
      return;
    }
    if (press && press.target !== "companion") {
      if (pointerEvent.phase !== "up") return;
      entry.press = null;
      if (press.companionId === null) return;
      const located = findDraggedLayout(press.companionId);
      const layout = located?.layout ?? null;
      const targetBounds = layout ? pointerTargetBounds(layout, press.target) : null;
      if (
        !layout ||
        pointerEvent.target !== press.target ||
        targetBounds === null ||
        !rectangleContainsPoint(targetBounds, {
          x: pointerEvent.screenX,
          y: pointerEvent.screenY,
        })
      ) {
        return;
      }
      if (press.target === "toggle") {
        yield* togglePreview(layout.projection);
      } else if (press.target === "composer") {
        yield* openComposer(layout.projection, "composer-only");
      } else {
        yield* acknowledgeProjection(layout.projection);
      }
      return;
    }

    const drag = entry.drag;
    if (!drag) return;
    let located = findDraggedLayout(drag.companionId);
    if (!located) {
      entry.drag = null;
      inFlightPositions.delete(drag.companionId);
      return;
    }
    const deltaX = pointerEvent.screenX - drag.pointerX;
    const deltaY = pointerEvent.screenY - drag.pointerY;
    if (pointerEvent.phase === "move") {
      if (!drag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
        drag.dragging = true;
      }
      const now = performance.now();
      if (!drag.dragging || now - drag.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
      drag.lastMoveAt = now;
      const nextBounds = {
        ...located.layout.bounds,
        x: Math.round(drag.companionX + deltaX),
        y: Math.round(drag.companionY + deltaY),
      };
      const display = Electron.screen.getDisplayNearestPoint({
        x: pointerEvent.screenX,
        y: pointerEvent.screenY,
      });
      located = moveLayoutToDisplay(located, display, nextBounds);
      inFlightPositions.set(drag.companionId, {
        displayId: located.entry.displayId,
        bounds: located.layout.bounds,
      });
      return;
    }

    if (!drag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
      drag.dragging = true;
    }
    if (drag.dragging) {
      const nextBounds = {
        ...located.layout.bounds,
        x: Math.round(drag.companionX + deltaX),
        y: Math.round(drag.companionY + deltaY),
      };
      const display = Electron.screen.getDisplayNearestPoint({
        x: pointerEvent.screenX,
        y: pointerEvent.screenY,
      });
      located = moveLayoutToDisplay(located, display, nextBounds);
    }
    entry.drag = null;
    entry.press = null;
    if (drag.dragging) {
      const display = Electron.screen.getDisplayMatching(
        located.layout.bounds as Electron.Rectangle,
      );
      const constrained = constrainCompanionBounds(located.layout.bounds, display.workArea);
      moveLayout(located.layout, constrained);
      yield* positions.set(
        drag.companionId,
        positionFromBounds({
          displayId: String(display.id),
          bounds: constrained,
          workArea: display.workArea,
        }),
      );
      inFlightPositions.delete(drag.companionId);
      yield* reconcileOverlays;
      return;
    }
    inFlightPositions.delete(drag.companionId);
    if (pointerEvent.phase === "up") {
      yield* acknowledgeProjection(located.layout.projection);
      yield* revealAndNavigate(located.layout);
    }
  });

  const syncProjection = Effect.fn("desktop.companions.syncProjection")(function* (
    snapshot: CompanionProjectionSnapshot,
    senderWebContentsId: number,
  ) {
    if (!(yield* isCurrentMainSender(senderWebContentsId))) {
      yield* logWarning("rejected companion projection from an unregistered renderer", {
        senderWebContentsId,
      });
      return;
    }
    const accepted = acceptCompanionSnapshot(acceptedSnapshot, snapshot);
    if (accepted === null) return;
    acceptedSnapshot = accepted;
    const expandedViewChanged = desktopExpandedView !== snapshot.desktopExpandedView;
    desktopScalePercent = snapshot.desktopScalePercent;
    desktopPreviewsEnabled = snapshot.desktopPreviewsEnabled;
    desktopExpandedView = snapshot.desktopExpandedView;
    desiredProjections = new Map(
      snapshot.companions
        .filter((projection) => projection.showOnDesktop)
        .map((projection) => [projection.companionId, projection] as const),
    );
    if (activePortal && (!desktopPreviewsEnabled || expandedViewChanged)) {
      closePortalNow(activePortal.token);
    } else if (activePortal) {
      const portalProjection = desiredProjections.get(activePortal.companionId);
      if (!portalProjection) {
        closePortalNow(activePortal.token);
      } else if (
        activePortal.surface === "composer-only" &&
        ["working", "connecting", "offline"].includes(portalProjection.signal)
      ) {
        requestPortalClose(activePortal);
      }
    }
    for (const companionId of previewSessions.keys()) {
      if (!desiredProjections.has(companionId) || !desktopPreviewsEnabled) {
        previewSessions.delete(companionId);
      }
    }
    for (const companionId of inFlightPositions.keys()) {
      if (!desiredProjections.has(companionId)) inFlightPositions.delete(companionId);
    }
    yield* cancelScheduledReconciliation;
    yield* reconcileOverlays;
  });

  const resetPositions = Effect.fn("desktop.companions.resetPositions")(function* (
    senderWebContentsId: number,
  ) {
    if (!(yield* isCurrentMainSender(senderWebContentsId))) {
      yield* logWarning("rejected companion position reset from an unregistered renderer", {
        senderWebContentsId,
      });
      return;
    }
    yield* positions.reset;
    closeActivePortal();
    inFlightPositions.clear();
    inFlightVisibilityControl = null;
    previewSessions.clear();
    yield* cancelScheduledReconciliation;
    yield* reconcileOverlays;
  });

  const destroyAllNow = () => {
    quitting = true;
    nativeFocusRestoreRevision += 1;
    const focusRestore = pendingNativeFocusRestore;
    pendingNativeFocusRestore = null;
    mainDevToolsRestorePending = false;
    if (focusRestore !== null) {
      runFork(Fiber.interrupt(focusRestore));
    }
    const portal = activePortal;
    activePortal = null;
    if (portal) {
      if (portal.openTimeoutFiber !== null) runFork(Fiber.interrupt(portal.openTimeoutFiber));
      if (portal.window && !portal.window.isDestroyed()) portal.window.destroy();
    }
    resetDesktopCompanionPortalRegistry();
    desiredProjections = new Map();
    desiredDisplayIds = new Set();
    inFlightPositions.clear();
    inFlightVisibilityControl = null;
    if (reconciliationFiber) runFork(Fiber.interrupt(reconciliationFiber));
    reconciliationFiber = null;
    for (const entry of overlays.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy();
    }
    overlays.clear();
    displayIdByWebContentsId.clear();
  };
  const destroyAll = Effect.sync(destroyAllNow);

  const install = Effect.acquireRelease(
    Effect.sync(() => {
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_SYNC_PROJECTION_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_RESET_POSITIONS_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_SET_INTERACTIVE_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_POINTER_EVENT_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_READY_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_CLOSING_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_METRICS_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_INTERACTIVE_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_FOCUS_CHANNEL);
      Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_CLOSE_CHANNEL);

      Electron.ipcMain.handle(
        IpcChannels.COMPANION_SYNC_PROJECTION_CHANNEL,
        (event, raw: unknown) =>
          runPromise(
            decodeCompanionProjectionSnapshot(raw).pipe(
              Effect.flatMap((snapshot) => syncProjection(snapshot, event.sender.id)),
            ),
          ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_RESET_POSITIONS_CHANNEL, (event) =>
        runPromise(resetPositions(event.sender.id)),
      );
      Electron.ipcMain.handle(
        IpcChannels.COMPANION_SET_INTERACTIVE_CHANNEL,
        (event, raw: unknown) =>
          runPromise(
            decodeInteractive(raw).pipe(
              Effect.flatMap((interactive) =>
                Effect.sync(() => {
                  const entry = entryForSender(event.sender.id);
                  if (!entry || entry.window.isDestroyed()) return;
                  entry.window.setIgnoreMouseEvents(!interactive, { forward: true });
                }),
              ),
            ),
          ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_POINTER_EVENT_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodeCompanionPointerEvent(raw).pipe(
            Effect.flatMap((pointerEvent) => handlePointer(event.sender.id, pointerEvent)),
          ),
        ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_PORTAL_READY_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodePortalTokenInput(raw).pipe(
            Effect.flatMap((input) =>
              Effect.gen(function* () {
                if (!(yield* isCurrentMainSender(event.sender.id))) return;
                const portal = activePortal;
                if (!portal || portal.token !== input.token || !portal.window) return;
                if (portal.openTimeoutFiber !== null) {
                  yield* Fiber.interrupt(portal.openTimeoutFiber);
                }
                portal.openTimeoutFiber = null;
                portal.lastLayoutSignature = null;
                const projection = desiredProjections.get(portal.companionId);
                if (projection) yield* acknowledgeProjection(projection);
                focusDesktopCompanionPortalWindow({
                  application: Electron.app,
                  window: portal.window,
                  platform: environment.platform,
                });
                portal.ready = true;
                yield* reconcileOverlays;
              }),
            ),
          ),
        ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_PORTAL_CLOSING_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodePortalTokenInput(raw).pipe(
            Effect.flatMap((input) =>
              Effect.gen(function* () {
                if (!(yield* isCurrentMainSender(event.sender.id))) return;
                const portal = activePortal;
                if (!portal || portal.token !== input.token) return;
                portal.ready = false;
                const session = previewSessions.get(portal.companionId);
                if (session) session.expanded = false;
                yield* reconcileOverlays;
              }),
            ),
          ),
        ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_PORTAL_METRICS_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodePortalMetricsInput(raw).pipe(
            Effect.flatMap((input) =>
              Effect.gen(function* () {
                if (!(yield* isCurrentMainSender(event.sender.id))) return;
                const portal = activePortal;
                if (!portal || portal.token !== input.token) return;
                const session = previewSessions.get(portal.companionId);
                if (!session) return;
                if (
                  session.cardSize?.width === input.width &&
                  session.cardSize.height === input.height
                ) {
                  return;
                }
                session.cardSize = { width: input.width, height: input.height };
                portal.lastLayoutSignature = null;
                yield* reconcileOverlays;
              }),
            ),
          ),
        ),
      );
      Electron.ipcMain.handle(
        IpcChannels.COMPANION_PORTAL_INTERACTIVE_CHANNEL,
        (event, raw: unknown) =>
          runPromise(
            decodePortalInteractiveInput(raw).pipe(
              Effect.flatMap((input) =>
                Effect.gen(function* () {
                  if (!(yield* isCurrentMainSender(event.sender.id))) return;
                  const portal = activePortal;
                  if (!portal || portal.token !== input.token || !portal.window) return;
                  if (!portal.window.isDestroyed()) {
                    portal.window.setIgnoreMouseEvents(!input.interactive, { forward: true });
                  }
                }),
              ),
            ),
          ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_PORTAL_FOCUS_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodePortalTokenInput(raw).pipe(
            Effect.flatMap((input) =>
              Effect.gen(function* () {
                if (!(yield* isCurrentMainSender(event.sender.id))) return;
                const portal = activePortal;
                if (!portal || portal.token !== input.token || !portal.window) return;
                focusDesktopCompanionPortalWindow({
                  application: Electron.app,
                  window: portal.window,
                  platform: environment.platform,
                });
              }),
            ),
          ),
        ),
      );
      Electron.ipcMain.handle(IpcChannels.COMPANION_PORTAL_CLOSE_CHANNEL, (event, raw: unknown) =>
        runPromise(
          decodePortalTokenInput(raw).pipe(
            Effect.flatMap((input) =>
              Effect.gen(function* () {
                if (!(yield* isCurrentMainSender(event.sender.id))) return;
                closePortalNow(input.token);
              }),
            ),
          ),
        ),
      );

      Electron.ipcMain.removeAllListeners(IpcChannels.COMPANION_GET_PROJECTION_CHANNEL);
      Electron.ipcMain.on(IpcChannels.COMPANION_GET_PROJECTION_CHANNEL, (event) => {
        const entry = entryForSender(event.sender.id);
        event.returnValue = entry ? presentationForEntry(entry) : null;
      });
      Electron.ipcMain.removeAllListeners(IpcChannels.COMPANION_READY_CHANNEL);
      Electron.ipcMain.on(IpcChannels.COMPANION_READY_CHANNEL, (event) => {
        const entry = entryForSender(event.sender.id);
        if (!entry || entry.window.isDestroyed()) return;
        entry.window.showInactive();
      });
      Electron.ipcMain.removeAllListeners(IpcChannels.GET_MAIN_WINDOW_ATTENTION_STATE_CHANNEL);
      Electron.ipcMain.on(IpcChannels.GET_MAIN_WINDOW_ATTENTION_STATE_CHANNEL, (event) => {
        const mainWindow = Electron.BrowserWindow.fromWebContents(event.sender);
        event.returnValue = attentionStateForWindow(mainWindow);
      });

      const onBeforeQuit = () => destroyAllNow();
      Electron.app.on("before-quit", onBeforeQuit);

      const onDisplayChange = () => {
        void runPromise(reconcileOverlays).catch((cause) => {
          void runPromise(
            logWarning("could not reflow companion overlays", {
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
          );
        });
      };
      Electron.screen.on("display-added", onDisplayChange);
      Electron.screen.on("display-removed", onDisplayChange);
      Electron.screen.on("display-metrics-changed", onDisplayChange);
      return { onBeforeQuit, onDisplayChange };
    }),
    ({ onBeforeQuit, onDisplayChange }) =>
      Effect.sync(() => {
        destroyAllNow();
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_SYNC_PROJECTION_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_RESET_POSITIONS_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_SET_INTERACTIVE_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_POINTER_EVENT_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_READY_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_CLOSING_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_METRICS_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_INTERACTIVE_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_FOCUS_CHANNEL);
        Electron.ipcMain.removeHandler(IpcChannels.COMPANION_PORTAL_CLOSE_CHANNEL);
        Electron.ipcMain.removeAllListeners(IpcChannels.COMPANION_GET_PROJECTION_CHANNEL);
        Electron.ipcMain.removeAllListeners(IpcChannels.COMPANION_READY_CHANNEL);
        Electron.ipcMain.removeAllListeners(IpcChannels.GET_MAIN_WINDOW_ATTENTION_STATE_CHANNEL);
        Electron.app.removeListener("before-quit", onBeforeQuit);
        Electron.screen.removeListener("display-added", onDisplayChange);
        Electron.screen.removeListener("display-removed", onDisplayChange);
        Electron.screen.removeListener("display-metrics-changed", onDisplayChange);
      }),
  ).pipe(Effect.asVoid);

  return DesktopCompanionManager.of({ install, syncProjection, resetPositions, destroyAll });
});

export const layer = Layer.effect(DesktopCompanionManager, make);
