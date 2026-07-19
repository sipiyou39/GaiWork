import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import {
  findCompanionAssignmentForThread,
  projectCompanionState,
} from "@t3tools/client-runtime/companions";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { PlusIcon } from "lucide-react";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { cn } from "~/lib/utils";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import { CompanionSprite } from "../companions/CompanionSprite";
import { useCompanionPicker } from "../companions/CompanionPicker";
import { useAcknowledgeCompanionCompletion } from "../companions/useAcknowledgeCompanionCompletion";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threadRef = scopeThreadRef(activeThreadEnvironmentId, activeThreadId);
  const thread = useThreadShell(threadRef);
  const threadKey = scopedThreadKey(threadRef);
  const acknowledgedTurnId = useUiStateStore(
    (state) => state.companionAcknowledgedTurnIdByThreadKey[threadKey],
  );
  const companionAssignments = useClientSettings((settings) => settings.companionAssignments);
  const companionAssignment = findCompanionAssignmentForThread(companionAssignments, threadRef);
  const environment = useEnvironment(activeThreadEnvironmentId);
  const companionState = !companionAssignment
    ? null
    : thread
      ? projectCompanionState({
          thread,
          acknowledgedTurnId,
          connectionAvailable: environment?.connection.phase === "connected",
        })
      : ({ signal: "connecting", animation: "thinking", accessibleLabel: "Reconnecting" } as const);
  const { openCompanionPicker } = useCompanionPicker();
  const acknowledgeCompanionCompletion = useAcknowledgeCompanionCompletion();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={companionAssignment ? "Change companion" : "Choose companion"}
                className="no-drag-region inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => {
                  acknowledgeCompanionCompletion(threadRef);
                  openCompanionPicker(threadRef);
                }}
              >
                {companionAssignment && companionState ? (
                  <CompanionSprite
                    companionId={companionAssignment.companionId}
                    animation={companionState.animation}
                    accessibleLabel={companionState.accessibleLabel}
                    className="h-8 w-[30px]"
                  />
                ) : (
                  <PlusIcon className="size-4" />
                )}
              </button>
            }
          />
          <TooltipPopup side="bottom">
            {companionAssignment ? "Change companion" : "Choose companion"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <h2
                aria-label={activeThreadTitle}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >
                {activeThreadTitle}
              </h2>
            }
          />
          <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
        </Tooltip>
      </div>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen ? "pr-0" : "pr-16",
        )}
      >
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={threadRef}
            {...(draftId ? { draftId } : {})}
          />
        )}
      </div>
    </div>
  );
});
