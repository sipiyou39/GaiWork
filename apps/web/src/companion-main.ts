import type {
  CompanionAnimationState,
  CompanionId,
  CompanionPointerEvent,
  CompanionPreviewPlacement,
  CompanionSignal,
  DesktopCompanionOverlayPresentation,
  DesktopCompanionPresentation,
} from "@t3tools/contracts";
import {
  COMPANION_ANIMATIONS,
  COMPANION_ATLAS,
  getCompanionCatalogEntry,
} from "@t3tools/client-runtime/companions/catalog";
import { resolveCompanionInteractionAnimation } from "@t3tools/client-runtime/companions/interaction";
import {
  COMPANION_JUMP_REPEAT_DELAY_MS,
  companionAnimationDuration,
  companionTimeUntilNextFrame,
  resolveCompanionFrame,
} from "@t3tools/client-runtime/companions/player";

import "./companion.css";

interface SpriteState {
  presentation: DesktopCompanionPresentation;
  readonly element: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly toggle: HTMLButtonElement;
  readonly toggleChevron: SVGSVGElement;
  readonly card: HTMLElement;
  readonly status: HTMLElement;
  readonly assistantText: HTMLElement;
  readonly composerButton: HTMLButtonElement;
  image: HTMLImageElement | null;
  spriteReady: boolean;
  alphaMask: Uint8ClampedArray | null;
  mountedAt: number;
  animationStartedAt: number;
  activeAnimation: CompanionAnimationState | null;
  lastRenderedFrame: number;
  lastAssistantMessageId: string | null;
  contentPulseTimer: number | null;
  layoutAnimations: Animation[];
}

interface PointerHit {
  readonly companionId: CompanionId;
  readonly presentationIndex: number;
  readonly target: CompanionPointerEvent["target"];
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
let pressedTarget: CompanionPointerEvent["target"] = "companion";
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

function appendElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  parent.append(element);
  return element;
}

function makeChevron(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("preview-toggle-chevron");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m5.25 7.75 4.75 4.5 4.75-4.5");
  svg.append(path);
  return svg;
}

function makeComposerIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("conversation-preview-composer-icon");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M4.25 14.75 5 11.5 13.8 2.7a1.45 1.45 0 0 1 2.05 2.05L7.05 13.55l-2.8 1.2Z",
  );
  svg.append(path);
  return svg;
}

function makePreviewUi(companionId: CompanionId) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "preview-toggle";
  toggle.tabIndex = -1;
  toggle.hidden = true;
  toggle.dataset.companionId = companionId;
  toggle.append(appendElement(toggle, "span", "preview-toggle-spinner"));
  const toggleChevron = makeChevron();
  toggle.append(toggleChevron);
  overlay.append(toggle);

  const card = document.createElement("article");
  card.className = "conversation-preview";
  card.hidden = true;
  card.setAttribute("aria-hidden", "true");
  card.dataset.companionId = companionId;

  const header = appendElement(card, "header", "conversation-preview-header");
  const statusPill = appendElement(header, "div", "conversation-preview-status-pill");
  appendElement(statusPill, "span", "conversation-preview-status-dot");
  const status = appendElement(statusPill, "span", "conversation-preview-status");

  const response = appendElement(card, "div", "conversation-preview-response");
  const assistantText = appendElement(response, "p", "conversation-preview-message");
  const footer = appendElement(card, "footer", "conversation-preview-footer");
  const responseLabel = appendElement(footer, "span", "conversation-preview-response-label");
  responseLabel.textContent = "Latest response";
  const composerButton = appendElement(footer, "button", "conversation-preview-composer-button");
  composerButton.type = "button";
  composerButton.tabIndex = -1;
  composerButton.append(makeComposerIcon());

  overlay.append(card);
  return { toggle, toggleChevron, card, status, assistantText, composerButton };
}

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

  const previewUi = makePreviewUi(nextPresentation.companionId);
  const now = performance.now();
  const sprite: SpriteState = {
    presentation: nextPresentation,
    element,
    context,
    ...previewUi,
    image: null,
    spriteReady: false,
    alphaMask: null,
    mountedAt: now,
    animationStartedAt: now,
    activeAnimation: null,
    lastRenderedFrame: -1,
    lastAssistantMessageId: null,
    contentPulseTimer: null,
    layoutAnimations: [],
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

function signalLabel(signal: CompanionSignal): string {
  switch (signal) {
    case "working":
      return "Working";
    case "completed-unseen":
      return "Completed";
    case "awaiting-approval":
      return "Approval needed";
    case "awaiting-user-input":
      return "Waiting for you";
    case "plan-ready":
      return "Plan ready";
    case "failed":
      return "Needs attention";
    case "connecting":
      return "Connecting";
    case "offline":
      return "Offline";
    default:
      return "Ready";
  }
}

function emptyAssistantText(signal: CompanionSignal): string {
  switch (signal) {
    case "working":
      return "The agent is working…";
    case "completed-unseen":
      return "The work is complete.";
    case "awaiting-approval":
      return "Your approval is required.";
    case "awaiting-user-input":
      return "The agent is waiting for your response.";
    case "failed":
      return "The agent needs your attention.";
    default:
      return "No agent response yet.";
  }
}

function chevronRotation(placement: CompanionPreviewPlacement, expanded: boolean): number {
  if (placement === "top") return expanded ? 0 : 180;
  if (placement === "bottom") return expanded ? 180 : 0;
  if (placement === "left") return expanded ? -90 : 90;
  return expanded ? 90 : -90;
}

function pulsePreviewContent(sprite: SpriteState): void {
  if (reducedMotion.matches) return;
  if (sprite.contentPulseTimer !== null) window.clearTimeout(sprite.contentPulseTimer);
  sprite.card.classList.remove("has-new-content");
  void sprite.card.offsetWidth;
  sprite.card.classList.add("has-new-content");
  sprite.contentPulseTimer = window.setTimeout(() => {
    sprite.contentPulseTimer = null;
    sprite.card.classList.remove("has-new-content");
  }, 500);
}

function animatePreviewReposition(
  sprite: SpriteState,
  element: HTMLElement,
  deltaX: number,
  deltaY: number,
): void {
  if (reducedMotion.matches || (deltaX === 0 && deltaY === 0)) return;
  const animation = element.animate(
    [{ translate: `${deltaX}px ${deltaY}px` }, { translate: "0 0" }],
    {
      duration: 180,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
  );
  sprite.layoutAnimations.push(animation);
  const remove = () => {
    sprite.layoutAnimations = sprite.layoutAnimations.filter(
      (candidate) => candidate !== animation,
    );
  };
  animation.addEventListener("finish", remove, { once: true });
  animation.addEventListener("cancel", remove, { once: true });
}

function updatePreviewUi(
  sprite: SpriteState,
  companion: DesktopCompanionPresentation,
  previousPreview: DesktopCompanionPresentation["preview"],
): void {
  const preview = companion.preview;
  if (preview === null) {
    sprite.toggle.hidden = true;
    sprite.card.hidden = true;
    return;
  }

  sprite.toggle.hidden = false;
  const composerActive = preview.mode === "composer" || preview.mode === "submitting";
  const expanded = preview.mode === "preview";
  const surfaceVisible = expanded || composerActive;
  sprite.card.hidden = false;
  sprite.toggle.style.left = `${preview.toggleX}px`;
  sprite.toggle.style.top = `${preview.toggleY}px`;
  sprite.toggle.style.width = `${preview.toggleSize}px`;
  sprite.toggle.style.height = `${preview.toggleSize}px`;
  sprite.toggle.style.setProperty(
    "--preview-chevron-rotation",
    `${chevronRotation(preview.placement, surfaceVisible)}deg`,
  );
  sprite.toggle.className = `preview-toggle placement-${preview.placement} signal-${companion.signal}${
    surfaceVisible ? " is-expanded" : ""
  }`;
  sprite.toggle.setAttribute(
    "aria-label",
    `${surfaceVisible ? "Hide" : "Show"} latest agent response`,
  );

  sprite.card.style.left = `${preview.cardX}px`;
  sprite.card.style.top = `${preview.cardY}px`;
  sprite.card.style.width = `${preview.cardWidth}px`;
  sprite.card.style.height = `${preview.cardHeight}px`;
  sprite.card.className = `conversation-preview placement-${preview.placement} signal-${
    companion.signal
  }${expanded ? " is-expanded" : ""}${composerActive ? " is-composer-handoff" : ""}${
    preview.assistantStreaming ? " is-streaming" : ""
  }`;
  sprite.card.setAttribute("aria-hidden", surfaceVisible ? "false" : "true");
  sprite.card.setAttribute(
    "aria-label",
    `Latest response: ${preview.assistantText ?? emptyAssistantText(companion.signal)}`,
  );

  sprite.status.textContent = signalLabel(companion.signal);
  sprite.assistantText.textContent = preview.assistantText ?? emptyAssistantText(companion.signal);
  sprite.composerButton.disabled = !preview.composerAvailable;
  sprite.composerButton.setAttribute(
    "aria-label",
    preview.composerAvailable
      ? "Reply from the desktop"
      : "Reply is available when the agent stops",
  );
  sprite.composerButton.title = preview.composerAvailable
    ? "Reply"
    : "Available when the agent stops";

  if (previousPreview && previousPreview.placement !== preview.placement) {
    for (const animation of sprite.layoutAnimations) animation.cancel();
    sprite.layoutAnimations = [];
    animatePreviewReposition(
      sprite,
      sprite.toggle,
      previousPreview.toggleX - preview.toggleX,
      previousPreview.toggleY - preview.toggleY,
    );
    animatePreviewReposition(
      sprite,
      sprite.card,
      previousPreview.cardX - preview.cardX,
      previousPreview.cardY - preview.cardY,
    );
  }

  const nextAssistantMessageId = preview.assistantMessageId;
  if (
    sprite.lastAssistantMessageId !== null &&
    nextAssistantMessageId !== null &&
    sprite.lastAssistantMessageId !== nextAssistantMessageId
  ) {
    pulsePreviewContent(sprite);
  }
  sprite.lastAssistantMessageId = nextAssistantMessageId;
}

function removeSprite(companionId: CompanionId, sprite: SpriteState): void {
  sprite.element.remove();
  sprite.toggle.remove();
  sprite.card.remove();
  if (sprite.contentPulseTimer !== null) window.clearTimeout(sprite.contentPulseTimer);
  for (const animation of sprite.layoutAnimations) animation.cancel();
  sprites.delete(companionId);
}

function updatePresentation(nextPresentation: DesktopCompanionOverlayPresentation): void {
  presentation = nextPresentation;
  presentationOrder = nextPresentation.companions.map((companion) => companion.companionId);
  const nextIds = new Set(presentationOrder);
  for (const [companionId, sprite] of sprites) {
    if (nextIds.has(companionId)) continue;
    removeSprite(companionId, sprite);
    if (pressedId === companionId && !dragging) {
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
    const previousPreview = sprite.presentation.preview;
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
    updatePreviewUi(sprite, companion, previousPreview);
  }
  scheduleRender();
}

function resolveAnimation(sprite: SpriteState, now: number): CompanionAnimationState {
  const isPressed = pressedId === sprite.presentation.companionId;
  return resolveCompanionInteractionAnimation({
    baseAnimation: sprite.presentation.baseAnimation,
    ...(isPressed && pressedTarget === "companion" && dragging
      ? { dragAnimation: dragDirection }
      : {}),
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
    setMouseEventsEnabled(hitTest(lastPointerClientX, lastPointerClientY) !== null);
  }
  if (Number.isFinite(nextRenderInMs)) scheduleRender(nextRenderInMs);
}

function pointInside(
  clientX: number,
  clientY: number,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return clientX >= x && clientX < x + width && clientY >= y && clientY < y + height;
}

function hitTest(clientX: number, clientY: number): PointerHit | null {
  if (!presentation) return null;
  for (let index = presentation.companions.length - 1; index >= 0; index -= 1) {
    const companion = presentation.companions[index];
    if (!companion) continue;
    const preview = companion.preview;
    if (
      preview?.mode === "preview" &&
      preview.composerAvailable &&
      pointInside(
        clientX,
        clientY,
        preview.composerButtonX,
        preview.composerButtonY,
        preview.composerButtonSize,
        preview.composerButtonSize,
      )
    ) {
      return { companionId: companion.companionId, presentationIndex: index, target: "composer" };
    }
    if (
      preview &&
      pointInside(
        clientX,
        clientY,
        preview.toggleX,
        preview.toggleY,
        preview.toggleSize,
        preview.toggleSize,
      )
    ) {
      return { companionId: companion.companionId, presentationIndex: index, target: "toggle" };
    }
    if (
      preview?.mode === "preview" &&
      pointInside(
        clientX,
        clientY,
        preview.cardX,
        preview.cardY,
        preview.cardWidth,
        preview.cardHeight,
      )
    ) {
      return { companionId: companion.companionId, presentationIndex: index, target: "preview" };
    }

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
      return {
        companionId: companion.companionId,
        presentationIndex: index,
        target: "companion",
      };
    }
  }
  return null;
}

function syncHoverAtPointer(clientX: number, clientY: number): boolean {
  lastPointerClientX = clientX;
  lastPointerClientY = clientY;
  if (pressedId) return false;
  const hit = hitTest(clientX, clientY);
  const nextHoveredId = hit?.target === "companion" ? hit.companionId : null;
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
    target: pressedTarget,
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
  if (pressedTarget !== "companion") return;
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
  if (dragging !== wasDragging || dragDirection !== previousDragDirection) scheduleRender();
});

document.addEventListener("pointerdown", (event) => {
  const hit = hitTest(event.clientX, event.clientY);
  if (!hit) return;
  event.preventDefault();
  pressedId = hit.companionId;
  pressedTarget = hit.target;
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
