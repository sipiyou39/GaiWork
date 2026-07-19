import {
  CompanionPointerEvent,
  CompanionProjectionSnapshot,
  DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT,
  type CompanionId,
  type CompanionProjection,
  type DesktopCompanionOverlayPresentation,
  type DesktopCompanionPresentation,
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

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import {
  DesktopCompanionPositions,
  boundsFromPosition,
  constrainCompanionBounds,
  defaultCompanionBounds,
  positionFromBounds,
  type Rectangle,
} from "./DesktopCompanionPositions.ts";

const DRAG_THRESHOLD = 6;
const MIN_MOVE_INTERVAL_MS = 1_000 / 60;
const decodeCompanionProjectionSnapshot = Schema.decodeUnknownEffect(CompanionProjectionSnapshot);
const decodeCompanionPointerEvent = Schema.decodeUnknownEffect(CompanionPointerEvent);
const decodeInteractive = Schema.decodeUnknownEffect(Schema.Boolean);

interface CompanionLayout {
  projection: CompanionProjection;
  bounds: Rectangle;
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

interface OverlayWindowEntry {
  readonly window: Electron.BrowserWindow;
  readonly displayId: string;
  workArea: Electron.Rectangle;
  overlayBounds: Electron.Rectangle;
  layouts: CompanionLayout[];
  drag: DragState | null;
}

interface OverlayGroup {
  readonly display: Electron.Display;
  readonly layouts: CompanionLayout[];
}

interface AcceptedSnapshot {
  readonly sourceEpoch: string;
  readonly revision: number;
  readonly retiredEpochs: ReadonlySet<string>;
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

export function desktopCompanionPresentation(input: {
  readonly projection: CompanionProjection;
  readonly bounds: Rectangle;
  readonly overlayBounds: Rectangle;
}): DesktopCompanionPresentation {
  return {
    companionId: input.projection.companionId,
    baseAnimation: input.projection.baseAnimation,
    accessibleLabel: input.projection.accessibleLabel,
    x: Math.max(0, Math.round(input.bounds.x - input.overlayBounds.x)),
    y: Math.max(0, Math.round(input.bounds.y - input.overlayBounds.y)),
    width: input.bounds.width,
    height: input.bounds.height,
  };
}

export function companionOverlayBounds(
  layouts: readonly Pick<CompanionLayout, "bounds">[],
  workArea: Rectangle,
): Rectangle {
  if (layouts.length === 0) {
    return { x: workArea.x, y: workArea.y, width: 1, height: 1 };
  }
  const bounds = layouts.map((layout) => constrainCompanionBounds(layout.bounds, workArea));
  const left = Math.min(...bounds.map((entry) => entry.x));
  const top = Math.min(...bounds.map((entry) => entry.y));
  const right = Math.max(...bounds.map((entry) => entry.x + entry.width));
  const bottom = Math.max(...bounds.map((entry) => entry.y + entry.height));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
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
  let desiredProjections = new Map<CompanionId, CompanionProjection>();
  let desktopScalePercent = DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT;
  let desiredDisplayIds = new Set<string>();
  let acceptedSnapshot: AcceptedSnapshot | null = null;
  let reconciliationFiber: Fiber.Fiber<void, never> | null = null;
  let quitting = false;

  const currentMain = electronWindow.main.pipe(Effect.map(Option.getOrNull));

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
    companions: entry.layouts.map((layout) =>
      desktopCompanionPresentation({
        projection: layout.projection,
        bounds: layout.bounds,
        overlayBounds: entry.overlayBounds,
      }),
    ),
  });

  const sendOverlayPresentation = (entry: OverlayWindowEntry): void => {
    if (entry.window.isDestroyed()) return;
    entry.window.webContents.send(
      IpcChannels.COMPANION_PROJECTION_CHANNEL,
      presentationForEntry(entry),
    );
  };

  const emitAttentionState = (window: Electron.BrowserWindow): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(
      IpcChannels.MAIN_WINDOW_ATTENTION_STATE_CHANNEL,
      attentionStateForWindow(window),
    );
  };

  const markCompanionsReconnecting = (): void => {
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
    window.on("show", () => emitAttentionState(window));
    window.on("hide", () => emitAttentionState(window));
    window.on("focus", () => emitAttentionState(window));
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

  const buildOverlayGroups = Effect.fn("desktop.companions.buildOverlayGroups")(function* () {
    const groups = new Map<string, OverlayGroup>();
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
      const group = groups.get(displayId) ?? { display, layouts: [] };
      group.layouts.push({
        projection,
        bounds: constrainCompanionBounds(bounds, display.workArea),
      });
      groups.set(displayId, group);
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
      drag: null,
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
      if (
        entry.drag &&
        !group.layouts.some((layout) => layout.projection.companionId === entry.drag?.companionId)
      ) {
        entry.drag = null;
      }
      if (!entry.window.isDestroyed()) {
        entry.overlayBounds = companionOverlayBounds(group.layouts, group.display.workArea);
        entry.window.setBounds(entry.overlayBounds, false);
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
    projection: CompanionProjection,
  ) {
    const mainWindow = yield* desktopWindow.navigateToThread(projection.threadRef);
    attachMainWindowGuards(mainWindow);
  });

  const findDraggedLayout = (
    entry: OverlayWindowEntry,
    companionId: CompanionId,
  ): CompanionLayout | null =>
    entry.layouts.find((layout) => layout.projection.companionId === companionId) ?? null;

  const handlePointer = Effect.fn("desktop.companions.pointer")(function* (
    senderWebContentsId: number,
    pointerEvent: CompanionPointerEvent,
  ) {
    const entry = entryForSender(senderWebContentsId);
    if (!entry || entry.window.isDestroyed()) return;
    if (pointerEvent.phase === "down") {
      const layout = entry.layouts[pointerEvent.presentationIndex];
      if (
        !layout ||
        pointerEvent.screenX < layout.bounds.x ||
        pointerEvent.screenX >= layout.bounds.x + layout.bounds.width ||
        pointerEvent.screenY < layout.bounds.y ||
        pointerEvent.screenY >= layout.bounds.y + layout.bounds.height
      ) {
        yield* logWarning("rejected companion pointer target outside its presentation bounds", {
          senderWebContentsId,
          presentationIndex: pointerEvent.presentationIndex,
        });
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

    const drag = entry.drag;
    if (!drag) return;
    const layout = findDraggedLayout(entry, drag.companionId);
    if (!layout) {
      entry.drag = null;
      inFlightPositions.delete(drag.companionId);
      return;
    }
    const deltaX = pointerEvent.screenX - drag.pointerX;
    const deltaY = pointerEvent.screenY - drag.pointerY;
    if (pointerEvent.phase === "move") {
      if (!drag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
        drag.dragging = true;
        entry.overlayBounds = entry.workArea;
        entry.window.setBounds(entry.workArea, false);
      }
      const now = performance.now();
      if (!drag.dragging || now - drag.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
      drag.lastMoveAt = now;
      layout.bounds = {
        ...layout.bounds,
        x: Math.round(drag.companionX + deltaX),
        y: Math.round(drag.companionY + deltaY),
      };
      inFlightPositions.set(drag.companionId, {
        displayId: entry.displayId,
        bounds: layout.bounds,
      });
      sendOverlayPresentation(entry);
      return;
    }

    if (!drag.dragging && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
      drag.dragging = true;
    }
    if (drag.dragging) {
      layout.bounds = {
        ...layout.bounds,
        x: Math.round(drag.companionX + deltaX),
        y: Math.round(drag.companionY + deltaY),
      };
    }
    entry.drag = null;
    if (drag.dragging) {
      const display = Electron.screen.getDisplayMatching(layout.bounds as Electron.Rectangle);
      const constrained = constrainCompanionBounds(layout.bounds, display.workArea);
      layout.bounds = constrained;
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
    if (pointerEvent.phase === "up") yield* revealAndNavigate(layout.projection);
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
    desktopScalePercent = snapshot.desktopScalePercent;
    desiredProjections = new Map(
      snapshot.companions
        .filter((projection) => projection.showOnDesktop)
        .map((projection) => [projection.companionId, projection] as const),
    );
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
    inFlightPositions.clear();
    yield* cancelScheduledReconciliation;
    yield* reconcileOverlays;
  });

  const destroyAllNow = () => {
    quitting = true;
    desiredProjections = new Map();
    desiredDisplayIds = new Set();
    inFlightPositions.clear();
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
