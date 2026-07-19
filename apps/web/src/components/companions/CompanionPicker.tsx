import {
  assignCompanion,
  COMPANION_CATALOG,
  completedCompanionTurnId,
  findCompanionAssignmentById,
  findCompanionAssignmentForThread,
  removeCompanionAssignment,
} from "@t3tools/client-runtime/companions";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CompanionId, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { isElectron } from "~/env";
import { getClientSettings, useClientSettings, useCommitClientSettings } from "~/hooks/useSettings";
import { isMacPlatform } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { CompanionSprite } from "./CompanionSprite";

interface CompanionPickerContextValue {
  readonly openCompanionPicker: (threadRef: ScopedThreadRef) => void;
}

const CompanionPickerContext = createContext<CompanionPickerContextValue | null>(null);

export function useCompanionPicker(): CompanionPickerContextValue {
  const value = useContext(CompanionPickerContext);
  if (!value) {
    throw new Error("useCompanionPicker must be used inside CompanionPickerProvider");
  }
  return value;
}

export function CompanionPickerProvider({ children }: { readonly children: ReactNode }) {
  const assignments = useClientSettings((settings) => settings.companionAssignments);
  const showOnDesktopByDefault = useClientSettings(
    (settings) => settings.companionShowOnDesktopByDefault,
  );
  const commitClientSettings = useCommitClientSettings();
  const threadShells = useThreadShells();
  const threadShellByKey = useMemo(
    () =>
      new Map(
        threadShells.map((thread) => [
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
          thread,
        ]),
      ),
    [threadShells],
  );
  const threadTitles = useMemo(
    () => new Map([...threadShellByKey].map(([threadKey, thread]) => [threadKey, thread.title])),
    [threadShellByKey],
  );
  const acknowledgeCompanionTurn = useUiStateStore((state) => state.acknowledgeCompanionTurn);
  const clearCompanionAcknowledgement = useUiStateStore(
    (state) => state.clearCompanionAcknowledgement,
  );
  const [target, setTarget] = useState<ScopedThreadRef | null>(null);
  const [selectedId, setSelectedId] = useState<CompanionId | null>(null);
  const [showOnDesktop, setShowOnDesktop] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMacosDesktop =
    isElectron && typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

  const openCompanionPicker = useCallback(
    (threadRef: ScopedThreadRef) => {
      const current = findCompanionAssignmentForThread(assignments, threadRef);
      setTarget(threadRef);
      setSelectedId(current?.companionId ?? null);
      setShowOnDesktop(current?.showOnDesktop ?? (isMacosDesktop && showOnDesktopByDefault));
    },
    [assignments, isMacosDesktop, showOnDesktopByDefault],
  );

  const close = useCallback(() => {
    if (saving) return;
    setTarget(null);
  }, [saving]);

  const selectedUse = selectedId ? findCompanionAssignmentById(assignments, selectedId) : null;
  const selectedUsedElsewhere =
    target !== null &&
    selectedUse !== null &&
    scopedThreadKey(selectedUse.threadRef) !== scopedThreadKey(target);
  const targetTitle = target ? (threadTitles.get(scopedThreadKey(target)) ?? "Conversation") : "";
  const usedTitle = selectedUse
    ? (threadTitles.get(scopedThreadKey(selectedUse.threadRef)) ?? "another conversation")
    : null;
  const currentAssignment = target ? findCompanionAssignmentForThread(assignments, target) : null;

  const save = useCallback(async () => {
    if (!target || !selectedId || saving) return;
    setSaving(true);
    try {
      const current = getClientSettings().companionAssignments;
      await commitClientSettings({
        companionAssignments: assignCompanion({
          assignments: current,
          threadRef: target,
          companionId: selectedId,
          showOnDesktop: isMacosDesktop && showOnDesktop,
        }),
      });
      const targetKey = scopedThreadKey(target);
      const completedTurnId = completedCompanionTurnId(threadShellByKey.get(targetKey));
      if (completedTurnId) {
        acknowledgeCompanionTurn(targetKey, completedTurnId);
      }
      if (selectedUse && scopedThreadKey(selectedUse.threadRef) !== targetKey) {
        clearCompanionAcknowledgement(scopedThreadKey(selectedUse.threadRef));
      }
      setTarget(null);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not save companion",
          description:
            error instanceof Error ? error.message : "The local setting could not be saved.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [
    acknowledgeCompanionTurn,
    commitClientSettings,
    clearCompanionAcknowledgement,
    isMacosDesktop,
    saving,
    selectedId,
    selectedUse,
    showOnDesktop,
    target,
    threadShellByKey,
  ]);

  const remove = useCallback(async () => {
    if (!target || saving) return;
    setSaving(true);
    try {
      await commitClientSettings({
        companionAssignments: removeCompanionAssignment(
          getClientSettings().companionAssignments,
          target,
        ),
      });
      clearCompanionAcknowledgement(scopedThreadKey(target));
      setTarget(null);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not remove companion",
          description:
            error instanceof Error ? error.message : "The local setting could not be saved.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [clearCompanionAcknowledgement, commitClientSettings, saving, target]);

  const contextValue = useMemo(() => ({ openCompanionPicker }), [openCompanionPicker]);

  return (
    <CompanionPickerContext.Provider value={contextValue}>
      {children}
      <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
        <DialogPopup className="max-w-xl" showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>Choose a companion</DialogTitle>
            <DialogDescription>Assign a unique companion to “{targetTitle}”.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {COMPANION_CATALOG.map((companion) => {
                const used = findCompanionAssignmentById(assignments, companion.id);
                const isSelected = companion.id === selectedId;
                const usedBy = used
                  ? (threadTitles.get(scopedThreadKey(used.threadRef)) ?? "another conversation")
                  : null;
                return (
                  <button
                    key={companion.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={saving}
                    className={`relative flex min-w-0 cursor-pointer flex-col items-center rounded-xl border p-2 text-center transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/45 hover:bg-accent"
                    }`}
                    onClick={() => setSelectedId(companion.id)}
                  >
                    {isSelected ? (
                      <span className="absolute top-1.5 right-1.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-3" aria-hidden="true" />
                      </span>
                    ) : null}
                    <CompanionSprite
                      companionId={companion.id}
                      animation="idle"
                      accessibleLabel="Preview"
                      className="h-[78px] w-[72px]"
                      waveOnMount={false}
                    />
                    <span className="text-xs font-medium">{companion.displayName}</span>
                    {usedBy ? (
                      <span className="max-w-full truncate text-[10px] text-muted-foreground">
                        Used by “{usedBy}”
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Available</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedUsedElsewhere ? (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                This companion is used by “{usedTitle}”. Assigning it here will move it.
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={showOnDesktop}
                disabled={!isMacosDesktop || saving}
                onCheckedChange={(checked) => setShowOnDesktop(checked === true)}
              />
              <span>
                Show on desktop
                {!isMacosDesktop ? (
                  <span className="ml-2 text-xs text-muted-foreground">macOS app only</span>
                ) : null}
              </span>
            </label>
          </DialogPanel>
          <DialogFooter className="sm:justify-between">
            <div>
              {currentAssignment ? (
                <Button variant="ghost" disabled={saving} onClick={() => void remove()}>
                  Remove companion
                </Button>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={close}>
                Cancel
              </Button>
              <Button disabled={!selectedId || saving} onClick={() => void save()}>
                {saving ? "Saving…" : selectedUsedElsewhere ? "Move and assign" : "Assign"}
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </CompanionPickerContext.Provider>
  );
}
