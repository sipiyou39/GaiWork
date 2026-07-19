import type { CompanionAssignment, CompanionId, ScopedThreadRef } from "@t3tools/contracts";

import { scopedThreadKey } from "../environment/scoped.ts";

export function normalizeCompanionAssignments(
  assignments: readonly CompanionAssignment[],
): CompanionAssignment[] {
  const usedCompanions = new Set<CompanionId>();
  const usedThreads = new Set<string>();
  const normalized: CompanionAssignment[] = [];

  for (const assignment of assignments) {
    const threadKey = scopedThreadKey(assignment.threadRef);
    if (usedCompanions.has(assignment.companionId) || usedThreads.has(threadKey)) {
      continue;
    }
    usedCompanions.add(assignment.companionId);
    usedThreads.add(threadKey);
    normalized.push(assignment);
  }

  return normalized;
}

export function findCompanionAssignmentForThread(
  assignments: readonly CompanionAssignment[],
  threadRef: ScopedThreadRef,
): CompanionAssignment | null {
  const targetKey = scopedThreadKey(threadRef);
  return (
    assignments.find((assignment) => scopedThreadKey(assignment.threadRef) === targetKey) ?? null
  );
}

export function findCompanionAssignmentById(
  assignments: readonly CompanionAssignment[],
  companionId: CompanionId,
): CompanionAssignment | null {
  return assignments.find((assignment) => assignment.companionId === companionId) ?? null;
}

export function assignCompanion(input: {
  readonly assignments: readonly CompanionAssignment[];
  readonly threadRef: ScopedThreadRef;
  readonly companionId: CompanionId;
  readonly showOnDesktop: boolean;
}): CompanionAssignment[] {
  const targetKey = scopedThreadKey(input.threadRef);
  const remaining = input.assignments.filter(
    (assignment) =>
      assignment.companionId !== input.companionId &&
      scopedThreadKey(assignment.threadRef) !== targetKey,
  );
  return normalizeCompanionAssignments([
    ...remaining,
    {
      companionId: input.companionId,
      threadRef: input.threadRef,
      showOnDesktop: input.showOnDesktop,
    },
  ]);
}

export function removeCompanionAssignment(
  assignments: readonly CompanionAssignment[],
  threadRef: ScopedThreadRef,
): CompanionAssignment[] {
  const targetKey = scopedThreadKey(threadRef);
  return assignments.filter((assignment) => scopedThreadKey(assignment.threadRef) !== targetKey);
}

export function removeCompanionAssignmentsForThreads(
  assignments: readonly CompanionAssignment[],
  threadRefs: readonly ScopedThreadRef[],
): CompanionAssignment[] {
  const removedKeys = new Set(threadRefs.map(scopedThreadKey));
  return assignments.filter(
    (assignment) => !removedKeys.has(scopedThreadKey(assignment.threadRef)),
  );
}
