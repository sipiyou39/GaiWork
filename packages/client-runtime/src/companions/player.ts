import type { CompanionAnimationState } from "@t3tools/contracts";

import { COMPANION_ANIMATIONS } from "./catalog.ts";

/** Jumping is an attention animation and restarts immediately after its last frame. */
export const COMPANION_JUMP_REPEAT_DELAY_MS = 0;

export interface ResolveCompanionFrameOptions {
  readonly repeatDelayMs?: number | undefined;
  readonly reducedMotion?: boolean | undefined;
}

export function companionAnimationDuration(animation: CompanionAnimationState): number {
  return COMPANION_ANIMATIONS[animation].durationsMs.reduce(
    (total, duration) => total + duration,
    0,
  );
}

export function resolveCompanionFrame(
  animation: CompanionAnimationState,
  elapsedMs: number,
  options: ResolveCompanionFrameOptions = {},
): number {
  const definition = COMPANION_ANIMATIONS[animation];
  if (options.reducedMotion) {
    return animation === "ready" || animation === "failed" ? definition.frameCount - 1 : 0;
  }

  const duration = companionAnimationDuration(animation);
  const normalizedElapsed = Math.max(0, elapsedMs);
  let cursor: number;
  if (definition.loop) {
    cursor = normalizedElapsed % duration;
  } else if (options.repeatDelayMs !== undefined) {
    const cycleDuration = duration + Math.max(0, options.repeatDelayMs);
    cursor = normalizedElapsed % cycleDuration;
    if (cursor >= duration) {
      return definition.frameCount - 1;
    }
  } else if (normalizedElapsed >= duration) {
    return definition.frameCount - 1;
  } else {
    cursor = normalizedElapsed;
  }

  let accumulated = 0;
  for (const [frame, frameDuration] of definition.durationsMs.entries()) {
    accumulated += frameDuration;
    if (cursor < accumulated) {
      return frame;
    }
  }
  return definition.frameCount - 1;
}

/**
 * Returns the delay before the rendered frame can visibly change. This lets
 * lightweight desktop renderers sleep between manifest frame boundaries
 * instead of polling every display refresh.
 */
export function companionTimeUntilNextFrame(
  animation: CompanionAnimationState,
  elapsedMs: number,
  options: ResolveCompanionFrameOptions = {},
): number {
  if (options.reducedMotion) return Number.POSITIVE_INFINITY;

  const definition = COMPANION_ANIMATIONS[animation];
  const duration = companionAnimationDuration(animation);
  const normalizedElapsed = Math.max(0, elapsedMs);
  let cursor: number;
  let cycleDuration: number | null = null;

  if (definition.loop) {
    cycleDuration = duration;
    cursor = normalizedElapsed % duration;
  } else if (options.repeatDelayMs !== undefined) {
    cycleDuration = duration + Math.max(0, options.repeatDelayMs);
    cursor = normalizedElapsed % cycleDuration;
    if (cursor >= duration) {
      return Math.max(1, cycleDuration - cursor);
    }
  } else {
    if (normalizedElapsed >= duration) return Number.POSITIVE_INFINITY;
    cursor = normalizedElapsed;
  }

  let accumulated = 0;
  for (const [frame, frameDuration] of definition.durationsMs.entries()) {
    accumulated += frameDuration;
    if (cursor >= accumulated) continue;
    if (!definition.loop && cycleDuration === null && frame === definition.frameCount - 1) {
      return Number.POSITIVE_INFINITY;
    }
    if (cycleDuration !== null && frame === definition.frameCount - 1) {
      return Math.max(1, cycleDuration - cursor);
    }
    return Math.max(1, accumulated - cursor);
  }

  return Number.POSITIVE_INFINITY;
}

export function companionBackgroundPosition(
  animation: CompanionAnimationState,
  frame: number,
): { readonly xPercent: number; readonly yPercent: number } {
  const definition = COMPANION_ANIMATIONS[animation];
  const safeFrame = Math.max(0, Math.min(frame, definition.frameCount - 1));
  return {
    xPercent: safeFrame * (100 / 7),
    yPercent: definition.row * (100 / 8),
  };
}
