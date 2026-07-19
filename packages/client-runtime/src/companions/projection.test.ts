import type {
  OrchestrationLatestTurn,
  OrchestrationSession,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectCompanionState, type CompanionProjectionInput } from "./projection.ts";

const threadId = ThreadId.make("thread-test");
const turnId = TurnId.make("turn-test");
const otherTurnId = TurnId.make("turn-other");

function latestTurn(
  state: OrchestrationLatestTurn["state"],
  completedAt: string | null = null,
): OrchestrationLatestTurn {
  return {
    turnId,
    state,
    requestedAt: "2026-01-01T10:00:00.000Z",
    startedAt: "2026-01-01T10:00:01.000Z",
    completedAt,
    assistantMessageId: null,
  };
}

function session(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId,
    status,
    providerName: null,
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? turnId : null,
    lastError: status === "error" ? "boom" : null,
    updatedAt: "2026-01-01T10:00:02.000Z",
  };
}

function input(
  overrides: Partial<CompanionProjectionInput["thread"]> = {},
  rest: Omit<CompanionProjectionInput, "thread"> = {},
): CompanionProjectionInput {
  const thread: CompanionProjectionInput["thread"] = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default",
    latestTurn: null,
    session: null,
    ...overrides,
  } satisfies Pick<
    OrchestrationThreadShell,
    | "hasActionableProposedPlan"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "interactionMode"
    | "latestTurn"
    | "session"
  >;
  return { thread, ...rest };
}

describe("companion projection", () => {
  it("prioritizes failure over blocking requests", () => {
    expect(
      projectCompanionState(
        input({
          latestTurn: latestTurn("error", "2026-01-01T10:00:03.000Z"),
          hasPendingApprovals: true,
        }),
      ).signal,
    ).toBe("failed");
  });

  it("maps approvals and questions to thinking before working", () => {
    expect(
      projectCompanionState(input({ hasPendingApprovals: true, session: session("running") }))
        .signal,
    ).toBe("awaiting-approval");
    expect(
      projectCompanionState(input({ hasPendingUserInput: true, session: session("running") }))
        .signal,
    ).toBe("awaiting-user-input");
  });

  it("maps an active turn to working", () => {
    expect(projectCompanionState(input({ session: session("running") })).animation).toBe("working");
  });

  it("keeps plan ready ahead of an unseen completion", () => {
    expect(
      projectCompanionState(
        input(
          {
            interactionMode: "plan",
            hasActionableProposedPlan: true,
            latestTurn: latestTurn("completed", "2026-01-01T10:00:05.000Z"),
            session: session("ready"),
          },
          { acknowledgedTurnId: otherTurnId },
        ),
      ),
    ).toMatchObject({ signal: "plan-ready", animation: "ready" });
  });

  it("maps a completed ordinary result to jumping until its turn is acknowledged", () => {
    const completed = latestTurn("completed", "2026-01-01T10:00:05.000Z");
    expect(projectCompanionState(input({ latestTurn: completed })).animation).toBe("jumping");
    expect(
      projectCompanionState(input({ latestTurn: completed }, { acknowledgedTurnId: otherTurnId }))
        .animation,
    ).toBe("jumping");
    expect(
      projectCompanionState(input({ latestTurn: completed }, { acknowledgedTurnId: turnId }))
        .animation,
    ).toBe("idle");
  });

  it("uses thinking rather than failed for lost connectivity", () => {
    expect(
      projectCompanionState(input({ session: session("running") }, { connectionAvailable: false })),
    ).toMatchObject({ signal: "offline", animation: "thinking" });
  });

  it("keeps session startup ahead of a completed result", () => {
    expect(
      projectCompanionState(
        input(
          {
            session: session("starting"),
            latestTurn: latestTurn("completed", "2026-01-01T10:00:05.000Z"),
          },
          { acknowledgedTurnId: otherTurnId },
        ),
      ),
    ).toMatchObject({ signal: "connecting", animation: "thinking" });
  });

  it("does not advertise a deliberately interrupted turn as unseen completion", () => {
    expect(
      projectCompanionState(
        input(
          { latestTurn: latestTurn("interrupted", "2026-01-01T10:00:05.000Z") },
          { acknowledgedTurnId: otherTurnId },
        ),
      ),
    ).toMatchObject({ signal: "idle", animation: "idle" });
  });
});
