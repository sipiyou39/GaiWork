import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopeThreadRef } from "../environment/scoped.ts";
import {
  assignCompanion,
  findCompanionAssignmentById,
  findCompanionAssignmentForThread,
  normalizeCompanionAssignments,
  removeCompanionAssignment,
  removeCompanionAssignmentsForThreads,
} from "./assignments.ts";

const environmentId = EnvironmentId.make("environment-test");
const threadA = scopeThreadRef(environmentId, ThreadId.make("thread-a"));
const threadB = scopeThreadRef(environmentId, ThreadId.make("thread-b"));

describe("companion assignments", () => {
  it("keeps only the first valid assignment for each companion and thread", () => {
    const normalized = normalizeCompanionAssignments([
      { companionId: "aurore", threadRef: threadA, showOnDesktop: true },
      { companionId: "aurore", threadRef: threadB, showOnDesktop: false },
      { companionId: "blue", threadRef: threadA, showOnDesktop: false },
      { companionId: "blue", threadRef: threadB, showOnDesktop: false },
    ]);

    expect(normalized).toEqual([
      { companionId: "aurore", threadRef: threadA, showOnDesktop: true },
      { companionId: "blue", threadRef: threadB, showOnDesktop: false },
    ]);
  });

  it("transfers a used companion and releases the target's previous companion", () => {
    const assignments = [
      { companionId: "aurore", threadRef: threadA, showOnDesktop: true },
      { companionId: "blue", threadRef: threadB, showOnDesktop: false },
    ] as const;

    const next = assignCompanion({
      assignments,
      companionId: "aurore",
      threadRef: threadB,
      showOnDesktop: true,
    });

    expect(next).toEqual([{ companionId: "aurore", threadRef: threadB, showOnDesktop: true }]);
    expect(findCompanionAssignmentForThread(next, threadB)?.companionId).toBe("aurore");
    expect(findCompanionAssignmentById(next, "blue")).toBeNull();
  });

  it("removes an assignment by scoped thread identity", () => {
    expect(
      removeCompanionAssignment(
        [{ companionId: "aurore", threadRef: threadA, showOnDesktop: true }],
        threadA,
      ),
    ).toEqual([]);
  });

  it("cleans assignments atomically after bulk archive or deletion", () => {
    expect(
      removeCompanionAssignmentsForThreads(
        [
          { companionId: "aurore", threadRef: threadA, showOnDesktop: true },
          { companionId: "blue", threadRef: threadB, showOnDesktop: false },
        ],
        [threadA, threadB],
      ),
    ).toEqual([]);
  });
});
