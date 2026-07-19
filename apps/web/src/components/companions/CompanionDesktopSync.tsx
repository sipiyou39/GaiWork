import { projectCompanionState } from "@t3tools/client-runtime/companions";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CompanionAssignment, CompanionProjection } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useThreadShells } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { useUiStateStore } from "~/uiStateStore";

function makeSourceEpoch(): string {
  return `${Date.now()}-${performance.timeOrigin}-${performance.now()}`;
}

function projectionSignature(
  projections: readonly CompanionProjection[],
  desktopScalePercent: number,
): string {
  return `${desktopScalePercent}\u0003${projections
    .map((projection) =>
      [
        projection.companionId,
        projection.threadRef.environmentId,
        projection.threadRef.threadId,
        projection.threadTitle,
        projection.signal,
        projection.baseAnimation,
        projection.accessibleLabel,
        projection.showOnDesktop ? "1" : "0",
      ].join("\u0001"),
    )
    .join("\u0002")}`;
}

function assignmentProjectionKey(
  companionId: CompanionProjection["companionId"],
  threadRef: CompanionProjection["threadRef"],
): string {
  return `${companionId}\u0000${scopedThreadKey(threadRef)}`;
}

export function projectUnavailableCompanion(
  assignment: CompanionAssignment,
  previous?: CompanionProjection,
  desktopEnabled = true,
): CompanionProjection {
  const threadTitle = previous?.threadTitle ?? "Unavailable conversation";
  return {
    companionId: assignment.companionId,
    threadRef: assignment.threadRef,
    threadTitle,
    signal: "connecting",
    baseAnimation: "thinking",
    accessibleLabel: `${threadTitle}: Reconnecting`,
    showOnDesktop: desktopEnabled && assignment.showOnDesktop,
  };
}

export function CompanionDesktopSync() {
  const hydrated = useClientSettingsHydrated();
  const assignments = useClientSettings((settings) => settings.companionAssignments);
  const desktopEnabled = useClientSettings((settings) => settings.companionDesktopEnabled);
  const desktopScalePercent = useClientSettings(
    (settings) => settings.companionDesktopScalePercent,
  );
  const threads = useThreadShells();
  const acknowledgedTurnIds = useUiStateStore(
    (state) => state.companionAcknowledgedTurnIdByThreadKey,
  );
  const { environments } = useEnvironments();
  const epochRef = useRef(makeSourceEpoch());
  const revisionRef = useRef(0);
  const previousSignatureRef = useRef<string | null>(null);
  const lastKnownProjectionRef = useRef(new Map<string, CompanionProjection>());
  const [retryToken, setRetryToken] = useState(0);

  const projections = useMemo(() => {
    const threadByKey = new Map(
      threads.map((thread) => [
        scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
        thread,
      ]),
    );
    const environmentById = new Map(
      environments.map((environment) => [environment.environmentId, environment]),
    );
    return assignments.flatMap((assignment): CompanionProjection[] => {
      const threadKey = scopedThreadKey(assignment.threadRef);
      const thread = threadByKey.get(threadKey);
      if (!thread) {
        const previous = lastKnownProjectionRef.current.get(
          assignmentProjectionKey(assignment.companionId, assignment.threadRef),
        );
        return [projectUnavailableCompanion(assignment, previous, desktopEnabled)];
      }
      const environment = environmentById.get(assignment.threadRef.environmentId);
      const state = projectCompanionState({
        thread,
        acknowledgedTurnId: acknowledgedTurnIds[threadKey],
        connectionAvailable: environment?.connection.phase === "connected",
      });
      const threadTitle = thread.title.trim() || "Untitled conversation";
      return [
        {
          companionId: assignment.companionId,
          threadRef: assignment.threadRef,
          threadTitle,
          signal: state.signal,
          baseAnimation: state.animation,
          accessibleLabel: `${threadTitle}: ${state.accessibleLabel}`,
          showOnDesktop: desktopEnabled && assignment.showOnDesktop,
        },
      ];
    });
  }, [acknowledgedTurnIds, assignments, desktopEnabled, environments, threads]);

  useEffect(() => {
    const activeKeys = new Set(
      assignments.map((assignment) =>
        assignmentProjectionKey(assignment.companionId, assignment.threadRef),
      ),
    );
    for (const key of lastKnownProjectionRef.current.keys()) {
      if (!activeKeys.has(key)) lastKnownProjectionRef.current.delete(key);
    }
    for (const projection of projections) {
      lastKnownProjectionRef.current.set(
        assignmentProjectionKey(projection.companionId, projection.threadRef),
        projection,
      );
    }
  }, [assignments, projections]);

  useEffect(() => {
    const syncProjection = window.desktopBridge?.companions?.syncProjection;
    if (!hydrated || typeof syncProjection !== "function") return;
    const signature = projectionSignature(projections, desktopScalePercent);
    if (signature === previousSignatureRef.current) return;
    previousSignatureRef.current = signature;
    const revision = revisionRef.current;
    revisionRef.current += 1;
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    void syncProjection({
      sourceEpoch: epochRef.current,
      revision,
      desktopScalePercent,
      companions: projections,
    }).catch((error) => {
      console.error("[COMPANIONS] desktop projection sync failed", error);
      if (cancelled) return;
      previousSignatureRef.current = null;
      retryTimeout = setTimeout(() => setRetryToken((token) => token + 1), 1_000);
    });
    return () => {
      cancelled = true;
      if (retryTimeout !== null) clearTimeout(retryTimeout);
    };
  }, [desktopScalePercent, hydrated, projections, retryToken]);

  return null;
}
