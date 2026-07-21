import type { CompanionSignal } from "@t3tools/contracts";

export const COMPANION_COMPLETION_SOUND_URL = "/companions/sounds/completion.mp3";

const MAX_QUEUED_COMPLETION_SOUNDS = 8;

export interface CompanionCompletionTrackerState {
  readonly initialized: boolean;
  readonly handledTurnId: string | null;
}

export interface CompanionCompletionObservation {
  readonly authoritative: boolean;
  readonly completedTurnId: string | null;
  readonly signal: CompanionSignal;
  readonly eligible: boolean;
}

export function initialCompanionCompletionTrackerState(): CompanionCompletionTrackerState {
  return { initialized: false, handledTurnId: null };
}

export function advanceCompanionCompletionTracker(
  state: CompanionCompletionTrackerState,
  observation: CompanionCompletionObservation,
): {
  readonly state: CompanionCompletionTrackerState;
  readonly shouldPlay: boolean;
} {
  if (!observation.authoritative) return { state, shouldPlay: false };
  if (!state.initialized) {
    return {
      state: {
        initialized: true,
        handledTurnId: observation.completedTurnId,
      },
      shouldPlay: false,
    };
  }
  if (observation.completedTurnId === null || observation.completedTurnId === state.handledTurnId) {
    return { state, shouldPlay: false };
  }
  return {
    state: {
      initialized: true,
      handledTurnId: observation.completedTurnId,
    },
    shouldPlay: observation.signal === "completed-unseen" && observation.eligible,
  };
}

interface CompletionAudio {
  currentTime: number;
  preload: string;
  load(): void;
  pause(): void;
  play(): Promise<void>;
  addEventListener(type: "ended" | "error", listener: () => void): void;
  removeEventListener(type: "ended" | "error", listener: () => void): void;
}

export interface CompanionCompletionSoundPlayer {
  readonly preload: () => void;
  readonly play: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
}

export function createCompanionCompletionSoundPlayer(options: {
  readonly createAudio: () => CompletionAudio;
  readonly onPlaybackError?: ((cause: unknown) => void) | undefined;
}): CompanionCompletionSoundPlayer {
  let audio: CompletionAudio | null = null;
  let disposed = false;
  let playing = false;
  let queued = 0;
  let playbackRevision = 0;

  const reportPlaybackError = (cause: unknown): void => {
    if (!playing) return;
    playing = false;
    queued = 0;
    options.onPlaybackError?.(cause);
  };

  const onEnded = (): void => {
    if (!playing) return;
    playing = false;
    drain();
  };
  const onError = (): void =>
    reportPlaybackError(new Error("Completion sound could not be loaded."));

  const ensureAudio = (): CompletionAudio | null => {
    if (audio) return audio;
    try {
      const created = options.createAudio();
      created.preload = "auto";
      created.addEventListener("ended", onEnded);
      created.addEventListener("error", onError);
      created.load();
      audio = created;
      return created;
    } catch (cause) {
      options.onPlaybackError?.(cause);
      return null;
    }
  };

  function drain(): void {
    if (disposed || playing || queued === 0) return;
    const target = ensureAudio();
    if (!target) {
      queued = 0;
      return;
    }
    queued -= 1;
    target.currentTime = 0;
    playing = true;
    const revision = ++playbackRevision;
    try {
      void target.play().catch((cause: unknown) => {
        if (revision === playbackRevision) reportPlaybackError(cause);
      });
    } catch (cause) {
      if (revision === playbackRevision) reportPlaybackError(cause);
    }
  }

  const stop = (): void => {
    queued = 0;
    playing = false;
    playbackRevision += 1;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  return {
    preload: () => {
      if (!disposed) ensureAudio();
    },
    play: () => {
      if (disposed) return;
      queued = Math.min(MAX_QUEUED_COMPLETION_SOUNDS, queued + 1);
      drain();
    },
    stop,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      audio?.removeEventListener("ended", onEnded);
      audio?.removeEventListener("error", onError);
      audio = null;
    },
  };
}

let sharedPlayer: CompanionCompletionSoundPlayer | null = null;

function companionCompletionSoundPlayer(): CompanionCompletionSoundPlayer {
  sharedPlayer ??= createCompanionCompletionSoundPlayer({
    createAudio: () => new Audio(COMPANION_COMPLETION_SOUND_URL),
    onPlaybackError: (cause) => {
      console.warn("[COMPANIONS] completion sound playback failed", cause);
    },
  });
  return sharedPlayer;
}

export function preloadCompanionCompletionSound(): void {
  companionCompletionSoundPlayer().preload();
}

export function playCompanionCompletionSound(): void {
  companionCompletionSoundPlayer().play();
}

export function stopCompanionCompletionSound(): void {
  sharedPlayer?.stop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sharedPlayer?.dispose();
    sharedPlayer = null;
  });
}
