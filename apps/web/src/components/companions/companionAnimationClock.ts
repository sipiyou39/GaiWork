type Listener = () => void;

const listeners = new Set<Listener>();
let currentTime = typeof performance === "undefined" ? 0 : performance.now();
let animationFrame: number | null = null;
let lastEmission = 0;
let visibilityListenerAttached = false;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function tick(time: number) {
  animationFrame = null;
  const presentationTransitioning =
    typeof document !== "undefined" &&
    document.documentElement.dataset.mainWindowTransitioning === "true";
  if ((typeof document === "undefined" || !document.hidden) && !presentationTransitioning) {
    currentTime = time;
    if (time - lastEmission >= 40) {
      lastEmission = time;
      emit();
    }
  }
  if (listeners.size > 0) {
    animationFrame = requestAnimationFrame(tick);
  }
}

function startClock() {
  if (animationFrame !== null || typeof requestAnimationFrame === "undefined") return;
  if (typeof document !== "undefined" && document.hidden) return;
  animationFrame = requestAnimationFrame(tick);
}

function stopClock() {
  if (animationFrame === null || typeof cancelAnimationFrame === "undefined") return;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopClock();
    return;
  }
  currentTime = performance.now();
  emit();
  startClock();
}

export function subscribeCompanionAnimationClock(listener: Listener): () => void {
  listeners.add(listener);
  if (!visibilityListenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }
  startClock();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopClock();
      if (visibilityListenerAttached && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        visibilityListenerAttached = false;
      }
    }
  };
}

export function getCompanionAnimationTime(): number {
  return currentTime;
}

export function getCompanionAnimationServerTime(): number {
  return 0;
}
