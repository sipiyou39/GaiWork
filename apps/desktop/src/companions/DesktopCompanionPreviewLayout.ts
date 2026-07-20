import type { CompanionPreviewPlacement } from "@t3tools/contracts";

import type { Rectangle } from "./DesktopCompanionPositions.ts";

export const COMPANION_PREVIEW_CARD_WIDTH = 360;
export const COMPANION_PREVIEW_CARD_HEIGHT = 136;
export const COMPANION_PREVIEW_TOGGLE_SIZE = 34;
export const COMPANION_PREVIEW_SCREEN_MARGIN = 12;
export const COMPANION_PREVIEW_PLACEMENT_HYSTERESIS = 24;
const SPRITE_TOGGLE_GAP = 7;
const TOGGLE_CARD_GAP = 8;

export interface DesktopCompanionPreviewGeometry {
  readonly placement: CompanionPreviewPlacement;
  readonly cardBounds: Rectangle;
  readonly toggleBounds: Rectangle;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function clampRectangle(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const marginX = Math.min(
    COMPANION_PREVIEW_SCREEN_MARGIN,
    Math.max(0, (workArea.width - bounds.width) / 2),
  );
  const marginY = Math.min(
    COMPANION_PREVIEW_SCREEN_MARGIN,
    Math.max(0, (workArea.height - bounds.height) / 2),
  );
  return {
    ...bounds,
    x: Math.round(
      clamp(bounds.x, workArea.x + marginX, workArea.x + workArea.width - bounds.width - marginX),
    ),
    y: Math.round(
      clamp(bounds.y, workArea.y + marginY, workArea.y + workArea.height - bounds.height - marginY),
    ),
  };
}

function overflowPenalty(bounds: Rectangle, workArea: Rectangle): number {
  const left = Math.max(0, workArea.x + COMPANION_PREVIEW_SCREEN_MARGIN - bounds.x);
  const top = Math.max(0, workArea.y + COMPANION_PREVIEW_SCREEN_MARGIN - bounds.y);
  const right = Math.max(
    0,
    bounds.x + bounds.width - (workArea.x + workArea.width - COMPANION_PREVIEW_SCREEN_MARGIN),
  );
  const bottom = Math.max(
    0,
    bounds.y + bounds.height - (workArea.y + workArea.height - COMPANION_PREVIEW_SCREEN_MARGIN),
  );
  return (left + top + right + bottom) * 100_000;
}

function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

function rawCandidate(
  placement: CompanionPreviewPlacement,
  companion: Rectangle,
  cardWidth: number,
  cardHeight: number,
): DesktopCompanionPreviewGeometry {
  const centerX = companion.x + companion.width / 2;
  const centerY = companion.y + companion.height / 2;
  const toggleSize = COMPANION_PREVIEW_TOGGLE_SIZE;
  if (placement === "top") {
    const toggleY = companion.y - SPRITE_TOGGLE_GAP - toggleSize;
    return {
      placement,
      toggleBounds: {
        x: centerX - toggleSize / 2,
        y: toggleY,
        width: toggleSize,
        height: toggleSize,
      },
      cardBounds: {
        x: centerX - cardWidth / 2,
        y: toggleY - TOGGLE_CARD_GAP - cardHeight,
        width: cardWidth,
        height: cardHeight,
      },
    };
  }
  if (placement === "bottom") {
    const toggleY = companion.y + companion.height + SPRITE_TOGGLE_GAP;
    return {
      placement,
      toggleBounds: {
        x: centerX - toggleSize / 2,
        y: toggleY,
        width: toggleSize,
        height: toggleSize,
      },
      cardBounds: {
        x: centerX - cardWidth / 2,
        y: toggleY + toggleSize + TOGGLE_CARD_GAP,
        width: cardWidth,
        height: cardHeight,
      },
    };
  }
  if (placement === "left") {
    const toggleX = companion.x - SPRITE_TOGGLE_GAP - toggleSize;
    return {
      placement,
      toggleBounds: {
        x: toggleX,
        y: centerY - toggleSize / 2,
        width: toggleSize,
        height: toggleSize,
      },
      cardBounds: {
        x: toggleX - TOGGLE_CARD_GAP - cardWidth,
        y: centerY - cardHeight / 2,
        width: cardWidth,
        height: cardHeight,
      },
    };
  }
  const toggleX = companion.x + companion.width + SPRITE_TOGGLE_GAP;
  return {
    placement,
    toggleBounds: {
      x: toggleX,
      y: centerY - toggleSize / 2,
      width: toggleSize,
      height: toggleSize,
    },
    cardBounds: {
      x: toggleX + toggleSize + TOGGLE_CARD_GAP,
      y: centerY - cardHeight / 2,
      width: cardWidth,
      height: cardHeight,
    },
  };
}

export function chooseCompanionPreviewGeometry(input: {
  readonly companionBounds: Rectangle;
  readonly workArea: Rectangle;
  readonly obstacles?: ReadonlyArray<Rectangle>;
  readonly previousPlacement?: CompanionPreviewPlacement | undefined;
  readonly cardSize?:
    | {
        readonly width: number;
        readonly height: number;
      }
    | undefined;
}): DesktopCompanionPreviewGeometry {
  const cardWidth = Math.max(
    220,
    Math.min(
      input.cardSize?.width ?? COMPANION_PREVIEW_CARD_WIDTH,
      input.workArea.width - COMPANION_PREVIEW_SCREEN_MARGIN * 2,
    ),
  );
  const cardHeight = Math.min(
    input.cardSize?.height ?? COMPANION_PREVIEW_CARD_HEIGHT,
    input.workArea.height - COMPANION_PREVIEW_SCREEN_MARGIN * 2,
  );
  const placements: readonly CompanionPreviewPlacement[] = ["top", "bottom", "right", "left"];
  const candidates = placements.map((placement, preferenceIndex) => {
    const raw = rawCandidate(placement, input.companionBounds, cardWidth, cardHeight);
    const obstaclePenalty = (input.obstacles ?? []).reduce(
      (total, obstacle) =>
        total +
        intersectionArea(raw.cardBounds, obstacle) * 1_000 +
        intersectionArea(raw.toggleBounds, obstacle) * 5_000,
      0,
    );
    const hysteresis =
      placement === input.previousPlacement ? -COMPANION_PREVIEW_PLACEMENT_HYSTERESIS * 100_000 : 0;
    return {
      raw,
      score:
        overflowPenalty(raw.cardBounds, input.workArea) +
        overflowPenalty(raw.toggleBounds, input.workArea) +
        obstaclePenalty +
        preferenceIndex * 1_000 +
        hysteresis,
    };
  });
  candidates.sort((left, right) => left.score - right.score);
  const selected =
    candidates[0]?.raw ?? rawCandidate("top", input.companionBounds, cardWidth, cardHeight);
  return {
    placement: selected.placement,
    cardBounds: clampRectangle(selected.cardBounds, input.workArea),
    toggleBounds: clampRectangle(selected.toggleBounds, input.workArea),
  };
}

export function rectangleContainsPoint(
  bounds: Rectangle,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}
