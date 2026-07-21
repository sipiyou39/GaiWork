import { describe, expect, it, vi } from "vite-plus/test";

import {
  advanceCompanionCompletionTracker,
  createCompanionCompletionSoundPlayer,
  initialCompanionCompletionTrackerState,
} from "./companionCompletionSound";

class FakeAudio {
  currentTime = 0;
  preload = "none";
  readonly load = vi.fn();
  readonly pause = vi.fn();
  readonly play = vi.fn(async () => undefined);
  private readonly listeners = new Map<"ended" | "error", Set<() => void>>();

  addEventListener(type: "ended" | "error", listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "ended" | "error", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "ended" | "error"): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("companion completion sound tracking", () => {
  it("uses the first authoritative completion as a silent baseline", () => {
    const unavailable = advanceCompanionCompletionTracker(
      initialCompanionCompletionTrackerState(),
      {
        authoritative: false,
        completedTurnId: "turn-old",
        signal: "completed-unseen",
        eligible: true,
      },
    );
    expect(unavailable.state.initialized).toBe(false);

    const baseline = advanceCompanionCompletionTracker(unavailable.state, {
      authoritative: true,
      completedTurnId: "turn-old",
      signal: "completed-unseen",
      eligible: true,
    });
    expect(baseline).toEqual({
      state: { initialized: true, handledTurnId: "turn-old" },
      shouldPlay: false,
    });
  });

  it("plays exactly once when a newer turn becomes completed and unseen", () => {
    const baseline = advanceCompanionCompletionTracker(initialCompanionCompletionTrackerState(), {
      authoritative: true,
      completedTurnId: null,
      signal: "working",
      eligible: true,
    });
    const completed = advanceCompanionCompletionTracker(baseline.state, {
      authoritative: true,
      completedTurnId: "turn-new",
      signal: "completed-unseen",
      eligible: true,
    });
    expect(completed.shouldPlay).toBe(true);
    expect(
      advanceCompanionCompletionTracker(completed.state, {
        authoritative: true,
        completedTurnId: "turn-new",
        signal: "completed-unseen",
        eligible: true,
      }).shouldPlay,
    ).toBe(false);
  });

  it("does not replay a completion that arrived while notifications were ineligible", () => {
    const baseline = advanceCompanionCompletionTracker(initialCompanionCompletionTrackerState(), {
      authoritative: true,
      completedTurnId: null,
      signal: "working",
      eligible: false,
    });
    const hidden = advanceCompanionCompletionTracker(baseline.state, {
      authoritative: true,
      completedTurnId: "turn-hidden",
      signal: "completed-unseen",
      eligible: false,
    });
    expect(hidden.shouldPlay).toBe(false);
    expect(
      advanceCompanionCompletionTracker(hidden.state, {
        authoritative: true,
        completedTurnId: "turn-hidden",
        signal: "completed-unseen",
        eligible: true,
      }).shouldPlay,
    ).toBe(false);
  });
});

describe("companion completion sound player", () => {
  it("preloads one audio element and queues simultaneous completions", () => {
    const audio = new FakeAudio();
    const player = createCompanionCompletionSoundPlayer({ createAudio: () => audio });

    player.preload();
    player.play();
    player.play();
    expect(audio.preload).toBe("auto");
    expect(audio.load).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();

    audio.emit("ended");
    expect(audio.play).toHaveBeenCalledTimes(2);
    audio.emit("ended");
    player.dispose();
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it("clears queued sounds when notifications are disabled", () => {
    const audio = new FakeAudio();
    const player = createCompanionCompletionSoundPlayer({ createAudio: () => audio });

    player.play();
    player.play();
    player.stop();
    audio.emit("ended");
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });
});
