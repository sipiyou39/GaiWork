import { describe, expect, it } from "vite-plus/test";

import {
  companionAnimationDuration,
  companionBackgroundPosition,
  companionTimeUntilNextFrame,
  COMPANION_JUMP_REPEAT_DELAY_MS,
  resolveCompanionFrame,
} from "./player.ts";

describe("companion player", () => {
  it("uses exact manifest timing for looping animations", () => {
    expect(resolveCompanionFrame("working", 0)).toBe(0);
    expect(resolveCompanionFrame("working", 119)).toBe(0);
    expect(resolveCompanionFrame("working", 120)).toBe(1);
    expect(resolveCompanionFrame("working", companionAnimationDuration("working"))).toBe(0);
  });

  it("holds non-looping terminal states on their final frame", () => {
    expect(resolveCompanionFrame("ready", 50_000)).toBe(5);
    expect(resolveCompanionFrame("failed", 50_000)).toBe(7);
  });

  it("restarts jumping immediately without an attention pause", () => {
    const duration = companionAnimationDuration("jumping");
    expect(
      resolveCompanionFrame("jumping", duration - 1, {
        repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS,
      }),
    ).toBe(4);
    expect(
      resolveCompanionFrame("jumping", duration, {
        repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS,
      }),
    ).toBe(0);
  });

  it("returns representative static frames with reduced motion", () => {
    expect(resolveCompanionFrame("working", 1_000, { reducedMotion: true })).toBe(0);
    expect(resolveCompanionFrame("ready", 0, { reducedMotion: true })).toBe(5);
  });

  it("schedules only manifest frame boundaries", () => {
    expect(companionTimeUntilNextFrame("working", 0)).toBe(120);
    expect(companionTimeUntilNextFrame("working", 119)).toBe(1);
    expect(companionTimeUntilNextFrame("working", companionAnimationDuration("working"))).toBe(120);
  });

  it("sleeps while a terminal frame is persistent", () => {
    expect(companionTimeUntilNextFrame("ready", 1_000)).toBe(Number.POSITIVE_INFINITY);
    expect(companionTimeUntilNextFrame("failed", 50_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it("schedules the immediate jump restart after the final frame", () => {
    const duration = companionAnimationDuration("jumping");
    expect(
      companionTimeUntilNextFrame("jumping", duration - 1, {
        repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS,
      }),
    ).toBe(1);
  });

  it("does not schedule frames with reduced motion", () => {
    expect(companionTimeUntilNextFrame("thinking", 0, { reducedMotion: true })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("maps atlas rows and columns to CSS percentages", () => {
    expect(companionBackgroundPosition("ready", 5)).toEqual({ xPercent: 500 / 7, yPercent: 100 });
  });
});
