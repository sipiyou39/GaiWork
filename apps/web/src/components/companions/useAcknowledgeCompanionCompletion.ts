import {
  completedCompanionTurnId,
  findCompanionAssignmentForThread,
} from "@t3tools/client-runtime/companions";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { getClientSettings } from "~/hooks/useSettings";
import { readThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";

/**
 * A companion result is acknowledged only by a deliberate action targeting
 * its conversation. Native focus/visibility and timestamp-based visit state
 * intentionally do not participate in this decision.
 */
export function useAcknowledgeCompanionCompletion(): (threadRef: ScopedThreadRef) => boolean {
  const acknowledgeCompanionTurn = useUiStateStore((state) => state.acknowledgeCompanionTurn);

  return useCallback(
    (threadRef) => {
      const assignment = findCompanionAssignmentForThread(
        getClientSettings().companionAssignments,
        threadRef,
      );
      if (!assignment) return false;

      const completedTurnId = completedCompanionTurnId(readThreadShell(threadRef));
      if (!completedTurnId) return false;

      acknowledgeCompanionTurn(scopedThreadKey(threadRef), completedTurnId);
      return true;
    },
    [acknowledgeCompanionTurn],
  );
}
