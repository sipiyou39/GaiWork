import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MessageId, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
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

export const COMPANION_DESKTOP_EXPANDED_VIEWS = ["response-only", "response-and-composer"] as const;
export const CompanionDesktopExpandedView = Schema.Literals(COMPANION_DESKTOP_EXPANDED_VIEWS);
export type CompanionDesktopExpandedView = typeof CompanionDesktopExpandedView.Type;
export const DEFAULT_COMPANION_DESKTOP_EXPANDED_VIEW: CompanionDesktopExpandedView =
  "response-and-composer";

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

export const COMPANION_PREVIEW_TITLE_MAX_LENGTH = 96;
export const COMPANION_PREVIEW_USER_MAX_LENGTH = 180;
export const COMPANION_PREVIEW_ASSISTANT_MAX_LENGTH = 960;

const CompanionPreviewText = (maximum: number) =>
  Schema.String.check(Schema.isTrimmed())
    .check(Schema.isNonEmpty())
    .check(Schema.isMaxLength(maximum));

/** Compact, plain-text view of the most recent exchange known by GaiWork. */
export const CompanionConversationPreview = Schema.Struct({
  userMessageId: Schema.NullOr(MessageId),
  userText: Schema.NullOr(CompanionPreviewText(COMPANION_PREVIEW_USER_MAX_LENGTH)),
  assistantMessageId: Schema.NullOr(MessageId),
  assistantText: Schema.NullOr(CompanionPreviewText(COMPANION_PREVIEW_ASSISTANT_MAX_LENGTH)),
  assistantStreaming: Schema.Boolean,
});
export type CompanionConversationPreview = typeof CompanionConversationPreview.Type;

export const CompanionProjection = Schema.Struct({
  companionId: CompanionId,
  threadRef: ScopedThreadRef,
  threadTitle: TrimmedNonEmptyString,
  signal: CompanionSignal,
  baseAnimation: CompanionAnimationState,
  accessibleLabel: TrimmedNonEmptyString,
  showOnDesktop: Schema.Boolean,
  preview: Schema.NullOr(CompanionConversationPreview),
});
export type CompanionProjection = typeof CompanionProjection.Type;

export const COMPANION_PREVIEW_PLACEMENTS = ["top", "bottom", "left", "right"] as const;
export const CompanionPreviewPlacement = Schema.Literals(COMPANION_PREVIEW_PLACEMENTS);
export type CompanionPreviewPlacement = typeof CompanionPreviewPlacement.Type;

export const DESKTOP_COMPANION_CARD_MODES = [
  "collapsed",
  "preview",
  "composer",
  "submitting",
] as const;
export const DesktopCompanionCardMode = Schema.Literals(DESKTOP_COMPANION_CARD_MODES);
export type DesktopCompanionCardMode = typeof DesktopCompanionCardMode.Type;

/** Geometry and content exposed to the isolated desktop companion renderer. */
export const DesktopCompanionPreviewPresentation = Schema.Struct({
  mode: DesktopCompanionCardMode,
  placement: CompanionPreviewPlacement,
  assistantMessageId: Schema.NullOr(MessageId),
  assistantText: Schema.NullOr(CompanionPreviewText(COMPANION_PREVIEW_ASSISTANT_MAX_LENGTH)),
  assistantStreaming: Schema.Boolean,
  composerAvailable: Schema.Boolean,
  showComposerButton: Schema.Boolean,
  cardX: NonNegativeInt,
  cardY: NonNegativeInt,
  cardWidth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  cardHeight: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  toggleX: NonNegativeInt,
  toggleY: NonNegativeInt,
  toggleSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
  composerButtonX: NonNegativeInt,
  composerButtonY: NonNegativeInt,
  composerButtonSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
});
export type DesktopCompanionPreviewPresentation = typeof DesktopCompanionPreviewPresentation.Type;

/** Minimal presentation payload exposed to an isolated desktop companion renderer. */
export const DesktopCompanionPresentation = Schema.Struct({
  companionId: CompanionId,
  signal: CompanionSignal,
  baseAnimation: CompanionAnimationState,
  accessibleLabel: TrimmedNonEmptyString,
  x: NonNegativeInt,
  y: NonNegativeInt,
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  preview: Schema.NullOr(DesktopCompanionPreviewPresentation),
});
export type DesktopCompanionPresentation = typeof DesktopCompanionPresentation.Type;

/** Global desktop control that remains available while companions are hidden. */
export const DesktopCompanionVisibilityControlPresentation = Schema.Struct({
  x: NonNegativeInt,
  y: NonNegativeInt,
  size: Schema.Int.check(Schema.isBetween({ minimum: 28, maximum: 96 })),
});
export type DesktopCompanionVisibilityControlPresentation =
  typeof DesktopCompanionVisibilityControlPresentation.Type;

export const DesktopCompanionOverlayPresentation = Schema.Struct({
  displayId: TrimmedNonEmptyString,
  companionsVisible: Schema.Boolean,
  visibilityControl: Schema.NullOr(DesktopCompanionVisibilityControlPresentation),
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
  desktopPreviewsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  desktopExpandedView: CompanionDesktopExpandedView.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_COMPANION_DESKTOP_EXPANDED_VIEW)),
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
  target: Schema.Literals(["companion", "preview", "toggle", "composer", "visibility-control"]),
  presentationIndex: NonNegativeInt,
  screenX: Schema.Finite,
  screenY: Schema.Finite,
});
export type CompanionPointerEvent = typeof CompanionPointerEvent.Type;

const DesktopCompanionPortalToken = TrimmedNonEmptyString;

export const DESKTOP_COMPANION_PORTAL_SURFACES = [
  "composer-only",
  "response-and-composer",
] as const;
export const DesktopCompanionPortalSurface = Schema.Literals(DESKTOP_COMPANION_PORTAL_SURFACES);
export type DesktopCompanionPortalSurface = typeof DesktopCompanionPortalSurface.Type;

export const DesktopCompanionPortalLayout = Schema.Struct({
  token: DesktopCompanionPortalToken,
  revision: NonNegativeInt,
  displayId: TrimmedNonEmptyString,
  placement: CompanionPreviewPlacement,
  cardX: NonNegativeInt,
  cardY: NonNegativeInt,
  cardWidth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  cardHeight: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  compactCardX: NonNegativeInt,
  compactCardY: NonNegativeInt,
  compactCardWidth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  compactCardHeight: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  workAreaWidth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20_000 })),
  workAreaHeight: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20_000 })),
});
export type DesktopCompanionPortalLayout = typeof DesktopCompanionPortalLayout.Type;

export const DesktopCompanionPortalRequest = Schema.Struct({
  token: DesktopCompanionPortalToken,
  frameName: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  companionId: CompanionId,
  threadRef: ScopedThreadRef,
  surface: DesktopCompanionPortalSurface,
  layout: DesktopCompanionPortalLayout,
});
export type DesktopCompanionPortalRequest = typeof DesktopCompanionPortalRequest.Type;

export const DesktopCompanionPortalTokenInput = Schema.Struct({
  token: DesktopCompanionPortalToken,
});
export type DesktopCompanionPortalTokenInput = typeof DesktopCompanionPortalTokenInput.Type;

export const DesktopCompanionPortalInteractiveInput = Schema.Struct({
  token: DesktopCompanionPortalToken,
  interactive: Schema.Boolean,
});
export type DesktopCompanionPortalInteractiveInput =
  typeof DesktopCompanionPortalInteractiveInput.Type;

export const DesktopCompanionPortalMetricsInput = Schema.Struct({
  token: DesktopCompanionPortalToken,
  width: Schema.Int.check(Schema.isBetween({ minimum: 220, maximum: 1_200 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 136, maximum: 1_000 })),
});
export type DesktopCompanionPortalMetricsInput = typeof DesktopCompanionPortalMetricsInput.Type;
