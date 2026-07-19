import type { CompanionAnimationState } from "@t3tools/contracts";

export type CompanionDragAnimation = Extract<
  CompanionAnimationState,
  "running-left" | "running-right"
>;

export function resolveCompanionInteractionAnimation(input: {
  readonly baseAnimation: CompanionAnimationState;
  readonly dragAnimation?: CompanionDragAnimation | undefined;
  readonly hovered: boolean;
  readonly appearing: boolean;
}): CompanionAnimationState {
  // Active work is semantic state, not decoration. No pointer interaction
  // should make a working companion look available or interrupt its work.
  if (input.baseAnimation === "working") return "working";

  if (input.dragAnimation) return input.dragAnimation;
  if (input.hovered) return "jumping";
  if (input.appearing) return "waving";
  return input.baseAnimation;
}
