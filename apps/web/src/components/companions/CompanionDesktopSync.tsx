import {
  deriveLatestCompanionConversationPreview,
  projectCompanionState,
} from "@t3tools/client-runtime/companions";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CompanionAssignment, CompanionProjection } from "@t3tools/contracts";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useThreadMessages, useThreadShell } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { useUiStateStore } from "~/uiStateStore";

const PREVIEW_SYNC_INTERVAL_MS = 100;

function makeSourceEpoch(): string {
  return `${Date.now()}-${performance.timeOrigin}-${performance.now()}`;
}

function projectionCoreSignature(
  projections: readonly CompanionProjection[],
  desktopScalePercent: number,
  desktopPreviewsEnabled: boolean,
): string {
  return `${desktopScalePercent}\u0004${desktopPreviewsEnabled ? "1" : "0"}\u0003${projections
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

function projectionSignature(
  projections: readonly CompanionProjection[],
  desktopScalePercent: number,
  desktopPreviewsEnabled: boolean,
): string {
  return `${projectionCoreSignature(
    projections,
    desktopScalePercent,
    desktopPreviewsEnabled,
  )}\u0005${projections
    .map((projection) => {
      const preview = projection.preview;
      return preview === null
        ? ""
        : [
            preview.userMessageId ?? "",
            preview.userText ?? "",
            preview.assistantMessageId ?? "",
            preview.assistantText ?? "",
            preview.assistantStreaming ? "1" : "0",
          ].join("\u0001");
    })
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
  previewEnabled = true,
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
    preview: previewEnabled ? (previous?.preview ?? null) : null,
  };
}

function CompanionProjectionObserver({
  assignment,
  desktopEnabled,
  desktopPreviewsEnabled,
  connectionAvailable,
  onProjection,
}: {
  readonly assignment: CompanionAssignment;
  readonly desktopEnabled: boolean;
  readonly desktopPreviewsEnabled: boolean;
  readonly connectionAvailable: boolean;
  readonly onProjection: (key: string, projection: CompanionProjection) => void;
}) {
  const threadKey = scopedThreadKey(assignment.threadRef);
  const projectionKey = assignmentProjectionKey(assignment.companionId, assignment.threadRef);
  const thread = useThreadShell(assignment.threadRef);
  const previewEnabled = desktopEnabled && desktopPreviewsEnabled && assignment.showOnDesktop;
  const messages = useThreadMessages(previewEnabled ? assignment.threadRef : null);
  const acknowledgedTurnId = useUiStateStore(
    (state) => state.companionAcknowledgedTurnIdByThreadKey[threadKey],
  );
  const previousRef = useRef<CompanionProjection | undefined>(undefined);

  const projection = useMemo<CompanionProjection>(() => {
    if (!thread) {
      return projectUnavailableCompanion(
        assignment,
        previousRef.current,
        desktopEnabled,
        previewEnabled,
      );
    }
    const state = projectCompanionState({
      thread,
      acknowledgedTurnId,
      connectionAvailable,
    });
    const threadTitle = thread.title.trim() || "Untitled conversation";
    return {
      companionId: assignment.companionId,
      threadRef: assignment.threadRef,
      threadTitle,
      signal: state.signal,
      baseAnimation: state.animation,
      accessibleLabel: `${threadTitle}: ${state.accessibleLabel}`,
      showOnDesktop: desktopEnabled && assignment.showOnDesktop,
      preview: previewEnabled ? deriveLatestCompanionConversationPreview(messages) : null,
    };
  }, [
    acknowledgedTurnId,
    assignment,
    connectionAvailable,
    desktopEnabled,
    messages,
    previewEnabled,
    thread,
  ]);

  previousRef.current = projection;
  useLayoutEffect(() => {
    onProjection(projectionKey, projection);
  }, [onProjection, projection, projectionKey]);

  return null;
}

export function CompanionDesktopSync() {
  const hydrated = useClientSettingsHydrated();
  const assignments = useClientSettings((settings) => settings.companionAssignments);
  const desktopEnabled = useClientSettings((settings) => settings.companionDesktopEnabled);
  const desktopPreviewsEnabled = useClientSettings(
    (settings) => settings.companionDesktopPreviewsEnabled,
  );
  const desktopScalePercent = useClientSettings(
    (settings) => settings.companionDesktopScalePercent,
  );
  const { environments } = useEnvironments();
  const environmentConnectedById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [
          environment.environmentId,
          environment.connection.phase === "connected",
        ]),
      ),
    [environments],
  );
  const epochRef = useRef(makeSourceEpoch());
  const revisionRef = useRef(0);
  const previousCoreSignatureRef = useRef<string | null>(null);
  const previousSignatureRef = useRef<string | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSignatureRef = useRef<string | null>(null);
  const [projectionByKey, setProjectionByKey] = useState(
    () => new Map<string, CompanionProjection>(),
  );
  const [retryToken, setRetryToken] = useState(0);

  const updateProjection = useCallback((key: string, projection: CompanionProjection) => {
    setProjectionByKey((current) => {
      if (current.get(key) === projection) return current;
      const next = new Map(current);
      next.set(key, projection);
      return next;
    });
  }, []);

  const activeProjectionKeys = useMemo(
    () =>
      new Set(
        assignments.map((assignment) =>
          assignmentProjectionKey(assignment.companionId, assignment.threadRef),
        ),
      ),
    [assignments],
  );

  const projections = useMemo(
    () =>
      assignments.map((assignment) => {
        const key = assignmentProjectionKey(assignment.companionId, assignment.threadRef);
        return (
          projectionByKey.get(key) ??
          projectUnavailableCompanion(assignment, undefined, desktopEnabled)
        );
      }),
    [assignments, desktopEnabled, projectionByKey],
  );

  useEffect(() => {
    setProjectionByKey((current) => {
      if ([...current.keys()].every((key) => activeProjectionKeys.has(key))) return current;
      return new Map([...current].filter(([key]) => activeProjectionKeys.has(key)));
    });
  }, [activeProjectionKeys]);

  useEffect(() => {
    const syncProjection = window.desktopBridge?.companions?.syncProjection;
    if (!hydrated || typeof syncProjection !== "function") return;

    const coreSignature = projectionCoreSignature(
      projections,
      desktopScalePercent,
      desktopPreviewsEnabled,
    );
    const signature = projectionSignature(projections, desktopScalePercent, desktopPreviewsEnabled);
    if (signature === previousSignatureRef.current) return;

    const coreChanged = coreSignature !== previousCoreSignatureRef.current;
    previousCoreSignatureRef.current = coreSignature;
    previousSignatureRef.current = signature;
    currentSignatureRef.current = signature;

    if (syncTimeoutRef.current !== null) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    const send = () => {
      syncTimeoutRef.current = null;
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      const revision = revisionRef.current;
      revisionRef.current += 1;
      void syncProjection({
        sourceEpoch: epochRef.current,
        revision,
        desktopScalePercent,
        desktopPreviewsEnabled,
        companions: projections,
      }).catch((error) => {
        console.error("[COMPANIONS] desktop projection sync failed", error);
        if (currentSignatureRef.current !== signature) return;
        previousSignatureRef.current = null;
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          setRetryToken((token) => token + 1);
        }, 1_000);
      });
    };

    if (coreChanged) {
      send();
    } else {
      syncTimeoutRef.current = setTimeout(send, PREVIEW_SYNC_INTERVAL_MS);
    }
  }, [desktopPreviewsEnabled, desktopScalePercent, hydrated, projections, retryToken]);

  useEffect(
    () => () => {
      if (syncTimeoutRef.current !== null) clearTimeout(syncTimeoutRef.current);
      if (retryTimeoutRef.current !== null) clearTimeout(retryTimeoutRef.current);
    },
    [],
  );

  return (
    <>
      {assignments.map((assignment) => {
        const key = assignmentProjectionKey(assignment.companionId, assignment.threadRef);
        return (
          <Fragment key={key}>
            <CompanionProjectionObserver
              assignment={assignment}
              desktopEnabled={desktopEnabled}
              desktopPreviewsEnabled={desktopPreviewsEnabled}
              connectionAvailable={
                environmentConnectedById.get(assignment.threadRef.environmentId) ?? false
              }
              onProjection={updateProjection}
            />
          </Fragment>
        );
      })}
    </>
  );
}
