import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ScopedThreadRef } from "./environment.ts";

export const COMPANION_IDS = [
  "aurore",
  "blue",
  "purple",
  "black",
  "yellow",
  "orange",
  "red",
  "gray",
  "white",
] as const;

export const CompanionId = Schema.Literals(COMPANION_IDS);
export type CompanionId = typeof CompanionId.Type;

export const MIN_COMPANION_DESKTOP_SCALE_PERCENT = 50;
export const MAX_COMPANION_DESKTOP_SCALE_PERCENT = 200;
export const DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT = 100;
export const CompanionDesktopScalePercent = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_COMPANION_DESKTOP_SCALE_PERCENT,
    maximum: MAX_COMPANION_DESKTOP_SCALE_PERCENT,
  }),
);
export type CompanionDesktopScalePercent = typeof CompanionDesktopScalePercent.Type;

export const MIN_COMPANION_SIDEBAR_SCALE_PERCENT = 75;
export const MAX_COMPANION_SIDEBAR_SCALE_PERCENT = 150;
export const DEFAULT_COMPANION_SIDEBAR_SCALE_PERCENT = 100;
export const CompanionSidebarScalePercent = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_COMPANION_SIDEBAR_SCALE_PERCENT,
    maximum: MAX_COMPANION_SIDEBAR_SCALE_PERCENT,
  }),
);
export type CompanionSidebarScalePercent = typeof CompanionSidebarScalePercent.Type;

export const COMPANION_ANIMATION_STATES = [
  "idle",
  "working",
  "thinking",
  "ready",
  "failed",
  "waving",
  "jumping",
  "running-left",
  "running-right",
] as const;

export const CompanionAnimationState = Schema.Literals(COMPANION_ANIMATION_STATES);
export type CompanionAnimationState = typeof CompanionAnimationState.Type;

export const COMPANION_SIGNALS = [
  "idle",
  "connecting",
  "offline",
  "working",
  "awaiting-approval",
  "awaiting-user-input",
  "plan-ready",
  "completed-unseen",
  "failed",
] as const;

export const CompanionSignal = Schema.Literals(COMPANION_SIGNALS);
export type CompanionSignal = typeof CompanionSignal.Type;

export const CompanionAssignment = Schema.Struct({
  companionId: CompanionId,
  threadRef: ScopedThreadRef,
  showOnDesktop: Schema.Boolean,
});
export type CompanionAssignment = typeof CompanionAssignment.Type;

export const CompanionProjection = Schema.Struct({
  companionId: CompanionId,
  threadRef: ScopedThreadRef,
  threadTitle: TrimmedNonEmptyString,
  signal: CompanionSignal,
  baseAnimation: CompanionAnimationState,
  accessibleLabel: TrimmedNonEmptyString,
  showOnDesktop: Schema.Boolean,
});
export type CompanionProjection = typeof CompanionProjection.Type;

/** Animation-only payload exposed to an isolated desktop companion renderer. */
export const DesktopCompanionPresentation = Schema.Struct({
  companionId: CompanionId,
  baseAnimation: CompanionAnimationState,
  accessibleLabel: TrimmedNonEmptyString,
  x: NonNegativeInt,
  y: NonNegativeInt,
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
});
export type DesktopCompanionPresentation = typeof DesktopCompanionPresentation.Type;

export const DesktopCompanionOverlayPresentation = Schema.Struct({
  displayId: TrimmedNonEmptyString,
  companions: Schema.Array(DesktopCompanionPresentation).check(
    Schema.isMaxLength(COMPANION_IDS.length),
  ),
});
export type DesktopCompanionOverlayPresentation = typeof DesktopCompanionOverlayPresentation.Type;

export const CompanionProjectionSnapshot = Schema.Struct({
  sourceEpoch: TrimmedNonEmptyString,
  revision: NonNegativeInt,
  desktopScalePercent: CompanionDesktopScalePercent.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT)),
  ),
  companions: Schema.Array(CompanionProjection).check(Schema.isMaxLength(COMPANION_IDS.length)),
});
export type CompanionProjectionSnapshot = typeof CompanionProjectionSnapshot.Type;

export const MainWindowAttentionState = Schema.Struct({
  visible: Schema.Boolean,
  focused: Schema.Boolean,
  minimized: Schema.Boolean,
});
export type MainWindowAttentionState = typeof MainWindowAttentionState.Type;

export const CompanionPointerEvent = Schema.Struct({
  phase: Schema.Literals(["down", "move", "up", "cancel"]),
  presentationIndex: NonNegativeInt,
  screenX: Schema.Finite,
  screenY: Schema.Finite,
});
export type CompanionPointerEvent = typeof CompanionPointerEvent.Type;
