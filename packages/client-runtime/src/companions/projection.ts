import type {
  CompanionAnimationState,
  CompanionSignal,
  OrchestrationThreadShell,
  TurnId,
} from "@t3tools/contracts";

export interface CompanionStateProjection {
  readonly signal: CompanionSignal;
  readonly animation: CompanionAnimationState;
  readonly accessibleLabel: string;
}

export interface CompanionProjectionInput {
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "hasActionableProposedPlan"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "interactionMode"
    | "latestTurn"
    | "session"
  >;
  readonly acknowledgedTurnId?: string | undefined;
  readonly connectionAvailable?: boolean | undefined;
}

export interface CompanionCompletionInput {
  readonly thread: Pick<OrchestrationThreadShell, "latestTurn">;
  readonly acknowledgedTurnId?: string | undefined;
}

export function completedCompanionTurnId(
  thread: Pick<OrchestrationThreadShell, "latestTurn"> | null | undefined,
): TurnId | null {
  return thread?.latestTurn?.state === "completed" ? thread.latestTurn.turnId : null;
}

export function hasUnacknowledgedCompanionCompletion(input: CompanionCompletionInput): boolean {
  const completedTurnId = completedCompanionTurnId(input.thread);
  return completedTurnId !== null && completedTurnId !== input.acknowledgedTurnId;
}

function isLatestTurnSettled(input: CompanionProjectionInput): boolean {
  const latestTurn = input.thread.latestTurn;
  if (!latestTurn?.startedAt || !latestTurn.completedAt) return false;
  return input.thread.session?.status !== "running";
}

function projection(
  signal: CompanionSignal,
  animation: CompanionAnimationState,
  accessibleLabel: string,
): CompanionStateProjection {
  return { signal, animation, accessibleLabel };
}

export function projectCompanionState(input: CompanionProjectionInput): CompanionStateProjection {
  const { thread } = input;
  if (thread.latestTurn?.state === "error" || thread.session?.status === "error") {
    return projection("failed", "failed", "Failed");
  }
  if (thread.hasPendingApprovals) {
    return projection("awaiting-approval", "thinking", "Pending approval");
  }
  if (thread.hasPendingUserInput) {
    return projection("awaiting-user-input", "thinking", "Awaiting your response");
  }
  if (input.connectionAvailable === false) {
    return projection("offline", "thinking", "Connection unavailable");
  }
  if (thread.session?.status === "starting") {
    return projection("connecting", "thinking", "Connecting");
  }
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return projection("working", "working", "Working");
  }
  if (thread.latestTurn?.state === "interrupted") {
    return projection("idle", "idle", "Idle after interruption");
  }
  if (
    thread.interactionMode === "plan" &&
    thread.hasActionableProposedPlan &&
    isLatestTurnSettled(input)
  ) {
    return projection("plan-ready", "ready", "Plan ready");
  }
  if (hasUnacknowledgedCompanionCompletion(input)) {
    return projection("completed-unseen", "jumping", "Completed — not yet viewed");
  }
  return projection("idle", "idle", "Idle");
}
