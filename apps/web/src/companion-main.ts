import type {
  CompanionAnimationState,
  CompanionId,
  CompanionPointerEvent,
  DesktopCompanionOverlayPresentation,
  DesktopCompanionPresentation,
} from "@t3tools/contracts";
import {
  COMPANION_ANIMATIONS,
  COMPANION_ATLAS,
  COMPANION_JUMP_REPEAT_DELAY_MS,
  companionAnimationDuration,
  companionTimeUntilNextFrame,
  getCompanionCatalogEntry,
  resolveCompanionInteractionAnimation,
  resolveCompanionFrame,
} from "@t3tools/client-runtime/companions";

import "./companion.css";

interface SpriteState {
  presentation: DesktopCompanionPresentation;
  readonly element: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  image: HTMLImageElement | null;
  spriteReady: boolean;
  alphaMask: Uint8ClampedArray | null;
  mountedAt: number;
  animationStartedAt: number;
  activeAnimation: CompanionAnimationState | null;
  lastRenderedFrame: number;
}

const exposedBridge = window.companionBridge;
const overlayElement = document.getElementById("companions");
if (!exposedBridge || !overlayElement) {
  throw new Error("The companion renderer requires its isolated desktop bridge.");
}
const bridge = exposedBridge;
const overlay = overlayElement;
const sprites = new Map<CompanionId, SpriteState>();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let presentation: DesktopCompanionOverlayPresentation | null = null;
let presentationOrder: CompanionId[] = [];
let hoveredId: CompanionId | null = null;
let pressedId: CompanionId | null = null;
let pressedPresentationIndex = 0;
let pressedPointerId: number | null = null;
let dragging = false;
let dragDirection: "running-left" | "running-right" = "running-right";
let pointerDownScreenX = 0;
let pointerDownScreenY = 0;
let lastPointerScreenX = 0;
let lastPointerClientX: number | null = null;
let lastPointerClientY: number | null = null;
let mouseEventsEnabled = false;
let readySent = false;
let renderTimer: number | null = null;
let pointerMoveTimer: number | null = null;
let pendingPointerMove: CompanionPointerEvent | null = null;
let lastPointerMoveSentAt = Number.NEGATIVE_INFINITY;

const POINTER_MOVE_INTERVAL_MS = 1_000 / 60;

function scheduleRender(delayMs = 0): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(
    () => {
      renderTimer = null;
      render(performance.now());
    },
    Math.max(0, Math.ceil(delayMs)),
  );
}

function setMouseEventsEnabled(enabled: boolean): void {
  if (mouseEventsEnabled === enabled) return;
  mouseEventsEnabled = enabled;
  void bridge.setInteractive(enabled);
}

function makeSprite(nextPresentation: DesktopCompanionPresentation): SpriteState {
  const element = document.createElement("canvas");
  element.className = "companion";
  element.setAttribute("role", "img");
  element.width = COMPANION_ATLAS.cellWidth;
  element.height = COMPANION_ATLAS.cellHeight;
  overlay.append(element);

  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Unable to create a companion alpha-mask canvas.");

  const now = performance.now();
  const sprite: SpriteState = {
    presentation: nextPresentation,
    element,
    context,
    image: null,
    spriteReady: false,
    alphaMask: null,
    mountedAt: now,
    animationStartedAt: now,
    activeAnimation: null,
    lastRenderedFrame: -1,
  };
  const image = new Image();
  sprite.image = image;
  image.decoding = "async";
  image.addEventListener("load", () => {
    if (sprite.image !== image) return;
    sprite.spriteReady = true;
    sprite.lastRenderedFrame = -1;
    scheduleRender();
  });
  image.src = getCompanionCatalogEntry(nextPresentation.companionId).spritesheetUrl;
  return sprite;
}

function updatePresentation(nextPresentation: DesktopCompanionOverlayPresentation): void {
  presentation = nextPresentation;
  presentationOrder = nextPresentation.companions.map((companion) => companion.companionId);
  const nextIds = new Set(presentationOrder);
  for (const [companionId, sprite] of sprites) {
    if (nextIds.has(companionId)) continue;
    sprite.element.remove();
    sprites.delete(companionId);
    if (pressedId === companionId) {
      if (pressedPointerId !== null && overlay.hasPointerCapture(pressedPointerId)) {
        overlay.releasePointerCapture(pressedPointerId);
      }
      pressedId = null;
      pressedPointerId = null;
      dragging = false;
      setMouseEventsEnabled(false);
    }
    if (hoveredId === companionId) hoveredId = null;
  }
  for (const companion of nextPresentation.companions) {
    const sprite = sprites.get(companion.companionId) ?? makeSprite(companion);
    if (!sprites.has(companion.companionId)) sprites.set(companion.companionId, sprite);
    if (sprite.presentation.baseAnimation !== companion.baseAnimation) {
      sprite.activeAnimation = null;
      sprite.animationStartedAt = performance.now();
    }
    sprite.presentation = companion;
    sprite.element.style.left = `${companion.x}px`;
    sprite.element.style.top = `${companion.y}px`;
    sprite.element.style.width = `${companion.width}px`;
    sprite.element.style.height = `${companion.height}px`;
    sprite.element.setAttribute("aria-label", companion.accessibleLabel);
  }
  scheduleRender();
}

function resolveAnimation(sprite: SpriteState, now: number): CompanionAnimationState {
  const isPressed = pressedId === sprite.presentation.companionId;
  return resolveCompanionInteractionAnimation({
    baseAnimation: sprite.presentation.baseAnimation,
    ...(isPressed && dragging ? { dragAnimation: dragDirection } : {}),
    hovered: hoveredId === sprite.presentation.companionId,
    appearing: now - sprite.mountedAt < companionAnimationDuration("waving"),
  });
}

function drawAlphaMask(
  sprite: SpriteState,
  animation: CompanionAnimationState,
  frame: number,
): void {
  if (!sprite.image || !sprite.spriteReady) return;
  const row = COMPANION_ANIMATIONS[animation].row;
  sprite.context.clearRect(0, 0, sprite.element.width, sprite.element.height);
  sprite.context.drawImage(
    sprite.image,
    frame * COMPANION_ATLAS.cellWidth,
    row * COMPANION_ATLAS.cellHeight,
    COMPANION_ATLAS.cellWidth,
    COMPANION_ATLAS.cellHeight,
    0,
    0,
    COMPANION_ATLAS.cellWidth,
    COMPANION_ATLAS.cellHeight,
  );
  sprite.alphaMask = sprite.context.getImageData(
    0,
    0,
    sprite.element.width,
    sprite.element.height,
  ).data;
}

function render(now: number): void {
  let nextRenderInMs = Number.POSITIVE_INFINITY;
  for (const companionId of presentationOrder) {
    const sprite = sprites.get(companionId);
    if (!sprite) continue;
    const animation = resolveAnimation(sprite, now);
    if (sprite.activeAnimation !== animation) {
      sprite.activeAnimation = animation;
      sprite.animationStartedAt = now;
      sprite.lastRenderedFrame = -1;
    }
    const frame = resolveCompanionFrame(animation, now - sprite.animationStartedAt, {
      ...(animation === "jumping" ? { repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS } : {}),
      reducedMotion: reducedMotion.matches,
    });
    if (frame !== sprite.lastRenderedFrame) {
      sprite.lastRenderedFrame = frame;
      drawAlphaMask(sprite, animation, frame);
    }
    const animationDelay = companionTimeUntilNextFrame(animation, now - sprite.animationStartedAt, {
      ...(animation === "jumping" ? { repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS } : {}),
      reducedMotion: reducedMotion.matches,
    });
    nextRenderInMs = Math.min(nextRenderInMs, animationDelay);
    if (animation === "waving") {
      nextRenderInMs = Math.min(
        nextRenderInMs,
        Math.max(1, companionAnimationDuration("waving") - (now - sprite.mountedAt)),
      );
    }
  }
  if (
    !readySent &&
    presentationOrder.length > 0 &&
    presentationOrder.every((companionId) => {
      const sprite = sprites.get(companionId);
      return sprite?.spriteReady === true && sprite.lastRenderedFrame >= 0;
    })
  ) {
    readySent = true;
    bridge.notifyReady();
  }
  if (pressedId === null && lastPointerClientX !== null && lastPointerClientY !== null) {
    // The sprite can move away from a stationary pointer between frames. Keep
    // the hover animation latched until the next pointer movement, but make
    // the current transparent pixel click-through immediately.
    setMouseEventsEnabled(hitTest(lastPointerClientX, lastPointerClientY) !== null);
  }
  if (Number.isFinite(nextRenderInMs)) scheduleRender(nextRenderInMs);
}

function hitTest(
  clientX: number,
  clientY: number,
): {
  readonly companionId: CompanionId;
  readonly presentationIndex: number;
} | null {
  if (!presentation) return null;
  for (let index = presentation.companions.length - 1; index >= 0; index -= 1) {
    const companion = presentation.companions[index];
    if (!companion) continue;
    const sprite = sprites.get(companion.companionId);
    if (!sprite?.alphaMask) continue;
    const displayX = clientX - companion.x;
    const displayY = clientY - companion.y;
    if (
      displayX < 0 ||
      displayY < 0 ||
      displayX >= companion.width ||
      displayY >= companion.height
    ) {
      continue;
    }
    const x = Math.min(
      COMPANION_ATLAS.cellWidth - 1,
      Math.floor((displayX * COMPANION_ATLAS.cellWidth) / companion.width),
    );
    const y = Math.min(
      COMPANION_ATLAS.cellHeight - 1,
      Math.floor((displayY * COMPANION_ATLAS.cellHeight) / companion.height),
    );
    if ((sprite.alphaMask[(y * COMPANION_ATLAS.cellWidth + x) * 4 + 3] ?? 0) >= 24) {
      return { companionId: companion.companionId, presentationIndex: index };
    }
  }
  return null;
}

function syncHoverAtPointer(clientX: number, clientY: number): boolean {
  lastPointerClientX = clientX;
  lastPointerClientY = clientY;
  if (pressedId) return false;
  const hit = hitTest(clientX, clientY);
  const nextHoveredId = hit?.companionId ?? null;
  const changed = hoveredId !== nextHoveredId;
  hoveredId = nextHoveredId;
  setMouseEventsEnabled(hit !== null);
  return changed;
}

function pointerEventPayload(
  phase: CompanionPointerEvent["phase"],
  event: PointerEvent,
): CompanionPointerEvent {
  return {
    phase,
    presentationIndex: pressedPresentationIndex,
    screenX: event.screenX,
    screenY: event.screenY,
  };
}

function cancelPendingPointerMove(): void {
  if (pointerMoveTimer !== null) window.clearTimeout(pointerMoveTimer);
  pointerMoveTimer = null;
  pendingPointerMove = null;
}

function schedulePointerMove(event: PointerEvent): void {
  pendingPointerMove = pointerEventPayload("move", event);
  if (pointerMoveTimer !== null) return;
  const delay = Math.max(0, POINTER_MOVE_INTERVAL_MS - (performance.now() - lastPointerMoveSentAt));
  pointerMoveTimer = window.setTimeout(() => {
    pointerMoveTimer = null;
    const next = pendingPointerMove;
    pendingPointerMove = null;
    if (!next || pressedId === null) return;
    lastPointerMoveSentAt = performance.now();
    void bridge.sendPointerEvent(next);
  }, Math.ceil(delay));
}

function sendTerminalPointerEvent(
  phase: Extract<CompanionPointerEvent["phase"], "up" | "cancel">,
  event: PointerEvent,
): void {
  // The terminal event carries the latest coordinates, so dropping a queued
  // intermediate move preserves the exact final position while keeping move
  // IPC at or below 60 Hz.
  cancelPendingPointerMove();
  void bridge.sendPointerEvent(pointerEventPayload(phase, event));
}

document.addEventListener("pointermove", (event) => {
  const previousDragDirection = dragDirection;
  const wasDragging = dragging;
  const hoverChanged = syncHoverAtPointer(event.clientX, event.clientY);
  if (pressedId) setMouseEventsEnabled(true);
  if (!pressedId) {
    if (hoverChanged) scheduleRender();
    return;
  }
  if (
    !dragging &&
    Math.hypot(event.screenX - pointerDownScreenX, event.screenY - pointerDownScreenY) >= 6
  ) {
    dragging = true;
  }
  if (dragging && event.screenX !== lastPointerScreenX) {
    dragDirection = event.screenX < lastPointerScreenX ? "running-left" : "running-right";
    lastPointerScreenX = event.screenX;
  }
  schedulePointerMove(event);
  if (dragging !== wasDragging || dragDirection !== previousDragDirection) {
    scheduleRender();
  }
});

document.addEventListener("pointerdown", (event) => {
  const hit = hitTest(event.clientX, event.clientY);
  if (!hit) return;
  event.preventDefault();
  pressedId = hit.companionId;
  pressedPresentationIndex = hit.presentationIndex;
  pressedPointerId = event.pointerId;
  dragging = false;
  hoveredId = null;
  pointerDownScreenX = event.screenX;
  pointerDownScreenY = event.screenY;
  lastPointerScreenX = event.screenX;
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  overlay.setPointerCapture(event.pointerId);
  cancelPendingPointerMove();
  lastPointerMoveSentAt = Number.NEGATIVE_INFINITY;
  void bridge.sendPointerEvent(pointerEventPayload("down", event));
  scheduleRender();
});

document.addEventListener("pointerup", (event) => {
  if (!pressedId) return;
  event.preventDefault();
  sendTerminalPointerEvent("up", event);
  pressedId = null;
  dragging = false;
  if (pressedPointerId !== null && overlay.hasPointerCapture(pressedPointerId)) {
    overlay.releasePointerCapture(pressedPointerId);
  }
  pressedPointerId = null;
  syncHoverAtPointer(event.clientX, event.clientY);
  scheduleRender();
});

document.addEventListener("pointercancel", (event) => {
  if (!pressedId) return;
  sendTerminalPointerEvent("cancel", event);
  pressedId = null;
  dragging = false;
  pressedPointerId = null;
  hoveredId = null;
  setMouseEventsEnabled(false);
  scheduleRender();
});

window.addEventListener("blur", () => {
  if (!pressedId) {
    hoveredId = null;
    setMouseEventsEnabled(false);
    scheduleRender();
  }
});

reducedMotion.addEventListener("change", () => scheduleRender());

bridge.onProjection(updatePresentation);
const initialPresentation = bridge.getInitialProjection();
if (initialPresentation) updatePresentation(initialPresentation);
scheduleRender();
