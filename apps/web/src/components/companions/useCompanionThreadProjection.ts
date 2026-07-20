import {
  deriveLatestCompanionConversationPreview,
  projectCompanionState,
} from "@t3tools/client-runtime/companions";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CompanionAssignment, CompanionProjection } from "@t3tools/contracts";
import { useMemo, useRef } from "react";

import { useThreadMessages, useThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";

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

export function useCompanionThreadProjection({
  assignment,
  desktopEnabled,
  desktopPreviewsEnabled,
  connectionAvailable,
}: {
  readonly assignment: CompanionAssignment;
  readonly desktopEnabled: boolean;
  readonly desktopPreviewsEnabled: boolean;
  readonly connectionAvailable: boolean;
}): CompanionProjection {
  const threadKey = scopedThreadKey(assignment.threadRef);
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
  return projection;
}
