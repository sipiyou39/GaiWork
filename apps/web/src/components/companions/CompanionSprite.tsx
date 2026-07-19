import type { CompanionAnimationState, CompanionId } from "@t3tools/contracts";
import {
  companionAnimationDuration,
  companionBackgroundPosition,
  COMPANION_JUMP_REPEAT_DELAY_MS,
  getCompanionCatalogEntry,
  resolveCompanionInteractionAnimation,
  resolveCompanionFrame,
} from "@t3tools/client-runtime/companions";
import { type CSSProperties, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import {
  getCompanionAnimationServerTime,
  getCompanionAnimationTime,
  subscribeCompanionAnimationClock,
} from "./companionAnimationClock";

export interface CompanionSpriteProps {
  readonly companionId: CompanionId;
  readonly animation: CompanionAnimationState;
  readonly accessibleLabel: string;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly waveOnMount?: boolean | undefined;
  readonly interactive?: boolean | undefined;
}

export function CompanionSprite({
  companionId,
  animation,
  accessibleLabel,
  className,
  style,
  waveOnMount = true,
  interactive = true,
}: CompanionSpriteProps) {
  const now = useSyncExternalStore(
    subscribeCompanionAnimationClock,
    getCompanionAnimationTime,
    getCompanionAnimationServerTime,
  );
  const mountedAtRef = useRef(now);
  const animationStartedAtRef = useRef(now);
  const previousAnimationRef = useRef<CompanionAnimationState | null>(null);
  const [hovered, setHovered] = useState(false);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const waving = waveOnMount && now - mountedAtRef.current < companionAnimationDuration("waving");
  const effectiveAnimation: CompanionAnimationState = resolveCompanionInteractionAnimation({
    baseAnimation: animation,
    hovered,
    appearing: waving,
  });

  if (previousAnimationRef.current !== effectiveAnimation) {
    previousAnimationRef.current = effectiveAnimation;
    animationStartedAtRef.current = now;
  }

  const frame = resolveCompanionFrame(effectiveAnimation, now - animationStartedAtRef.current, {
    ...(effectiveAnimation === "jumping" ? { repeatDelayMs: COMPANION_JUMP_REPEAT_DELAY_MS } : {}),
    reducedMotion,
  });
  const position = companionBackgroundPosition(effectiveAnimation, frame);
  const companion = getCompanionCatalogEntry(companionId);

  return (
    <span
      role="img"
      aria-label={`${companion.displayName}: ${accessibleLabel}`}
      className={cn("inline-block shrink-0 bg-no-repeat", className)}
      style={{
        ...style,
        backgroundImage: `url(${JSON.stringify(companion.spritesheetUrl)})`,
        backgroundPosition: `${position.xPercent}% ${position.yPercent}%`,
        backgroundSize: "800% 900%",
        imageRendering: "pixelated",
      }}
      onPointerEnter={interactive ? () => setHovered(true) : undefined}
      onPointerLeave={interactive ? () => setHovered(false) : undefined}
    />
  );
}
