import type { CompanionAnimationState, CompanionId } from "@t3tools/contracts";

export const COMPANION_ATLAS = {
  width: 1536,
  height: 1872,
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
} as const;

export interface CompanionDisplayDimensions {
  readonly width: number;
  readonly height: number;
}

export function companionDisplayDimensions(scalePercent: number): CompanionDisplayDimensions {
  const normalizedScale = Number.isFinite(scalePercent) ? Math.max(1, scalePercent) : 100;
  return {
    width: Math.max(1, Math.round((COMPANION_ATLAS.cellWidth * normalizedScale) / 100)),
    height: Math.max(1, Math.round((COMPANION_ATLAS.cellHeight * normalizedScale) / 100)),
  };
}

export function sidebarCompanionDisplayDimensions(
  scalePercent: number,
): CompanionDisplayDimensions {
  const normalizedScale = Number.isFinite(scalePercent) ? Math.max(1, scalePercent) : 100;
  return {
    width: Math.max(1, Math.round((28 * normalizedScale) / 100)),
    height: Math.max(1, Math.round((30 * normalizedScale) / 100)),
  };
}

export interface CompanionAnimationDefinition {
  readonly row: number;
  readonly frameCount: number;
  readonly durationsMs: readonly number[];
  readonly loop: boolean;
}

export const COMPANION_ANIMATIONS: Readonly<
  Record<CompanionAnimationState, CompanionAnimationDefinition>
> = {
  idle: {
    row: 0,
    frameCount: 6,
    durationsMs: [1680, 660, 660, 840, 840, 1920],
    loop: true,
  },
  "running-right": {
    row: 1,
    frameCount: 8,
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true,
  },
  "running-left": {
    row: 2,
    frameCount: 8,
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true,
  },
  waving: {
    row: 3,
    frameCount: 4,
    durationsMs: [140, 140, 140, 280],
    loop: false,
  },
  jumping: {
    row: 4,
    frameCount: 5,
    durationsMs: [140, 140, 140, 140, 280],
    loop: false,
  },
  failed: {
    row: 5,
    frameCount: 8,
    durationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
    loop: false,
  },
  thinking: {
    row: 6,
    frameCount: 6,
    durationsMs: [150, 150, 150, 150, 150, 260],
    loop: true,
  },
  working: {
    row: 7,
    frameCount: 6,
    durationsMs: [120, 120, 120, 120, 120, 220],
    loop: true,
  },
  ready: {
    row: 8,
    frameCount: 6,
    durationsMs: [150, 150, 150, 150, 150, 280],
    loop: false,
  },
};

export interface CompanionCatalogEntry {
  readonly id: CompanionId;
  readonly displayName: string;
  readonly palette: {
    readonly shadow: string;
    readonly base: string;
    readonly light: string;
  };
  readonly spritesheetUrl: string;
  readonly manifestUrl: string;
}

const entry = (
  id: CompanionId,
  displayName: string,
  palette: CompanionCatalogEntry["palette"],
): CompanionCatalogEntry => ({
  id,
  displayName,
  palette,
  spritesheetUrl: `/companions/${id}/spritesheet.webp`,
  manifestUrl: `/companions/${id}/manifest.json`,
});

export const COMPANION_CATALOG: readonly CompanionCatalogEntry[] = [
  entry("aurore", "Aurore", { shadow: "#3CA995", base: "#83CF8C", light: "#F2BE4F" }),
  entry("blue", "Blue", { shadow: "#2945A6", base: "#5277EC", light: "#91C8FF" }),
  entry("purple", "Purple", { shadow: "#6035A8", base: "#9460E2", light: "#D8A5FF" }),
  entry("black", "Black", { shadow: "#090C12", base: "#202631", light: "#657085" }),
  entry("yellow", "Yellow", { shadow: "#9A6500", base: "#E8B817", light: "#FFF397" }),
  entry("orange", "Orange", { shadow: "#BB4C16", base: "#F27B25", light: "#FFD159" }),
  entry("red", "Red", { shadow: "#791323", base: "#D52F3F", light: "#FF776D" }),
  entry("gray", "Gray", { shadow: "#2F374C", base: "#64708B", light: "#BBC5D8" }),
  entry("white", "White", { shadow: "#748196", base: "#DDE4EF", light: "#FFFFFF" }),
];

export const COMPANION_CATALOG_BY_ID = new Map(
  COMPANION_CATALOG.map((companion) => [companion.id, companion] as const),
);

export function getCompanionCatalogEntry(id: CompanionId): CompanionCatalogEntry {
  return COMPANION_CATALOG_BY_ID.get(id)!;
}
