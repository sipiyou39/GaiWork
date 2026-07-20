import {
  DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT,
  DEFAULT_COMPANION_SIDEBAR_SCALE_PERCENT,
  MAX_COMPANION_DESKTOP_SCALE_PERCENT,
  MAX_COMPANION_SIDEBAR_SCALE_PERCENT,
  MIN_COMPANION_DESKTOP_SCALE_PERCENT,
  MIN_COMPANION_SIDEBAR_SCALE_PERCENT,
} from "@t3tools/contracts";
import {
  companionDisplayDimensions,
  sidebarCompanionDisplayDimensions,
} from "@t3tools/client-runtime/companions";
import { LoaderIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { isElectron } from "~/env";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { isMacPlatform } from "~/lib/utils";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

function ScaleControl({
  value,
  min,
  max,
  step,
  label,
  disabled = false,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3 sm:w-64">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${value}%`}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-45"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {value}%
      </output>
    </div>
  );
}

export function CompanionSettingsPanel() {
  const settings = useClientSettings();
  const updateSettings = useUpdateClientSettings();
  const [resettingPositions, setResettingPositions] = useState(false);
  const desktopSupported =
    isElectron && typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const desktopDimensions = companionDisplayDimensions(settings.companionDesktopScalePercent);
  const sidebarDimensions = sidebarCompanionDisplayDimensions(
    settings.companionSidebarScalePercent,
  );
  const desktopStatus = desktopSupported
    ? `${desktopDimensions.width} × ${desktopDimensions.height} points`
    : "Available in the macOS desktop app.";

  const resetDesktopPositions = useCallback(async () => {
    const resetPositions = window.desktopBridge?.companions?.resetPositions;
    if (typeof resetPositions !== "function" || resettingPositions) return;
    setResettingPositions(true);
    try {
      await resetPositions();
      toastManager.add({
        type: "success",
        title: "Desktop positions reset",
        description: "Companions were arranged again from the bottom-right corner.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not reset desktop positions",
        description: error instanceof Error ? error.message : "The reset failed.",
      });
    } finally {
      setResettingPositions(false);
    }
  }, [resettingPositions]);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Desktop companions">
        <SettingsRow
          title="Show desktop companions"
          description="Temporarily show or hide every desktop companion without changing conversation assignments."
          status={
            desktopSupported ? `${settings.companionAssignments.length} assigned` : desktopStatus
          }
          control={
            <Switch
              checked={settings.companionDesktopEnabled}
              disabled={!desktopSupported}
              aria-label="Show desktop companions"
              onCheckedChange={(checked) =>
                updateSettings({ companionDesktopEnabled: Boolean(checked) })
              }
            />
          }
        />

        <SettingsRow
          title="Desktop size"
          description="Resize every desktop companion while keeping its position relative to the screen."
          status={desktopStatus}
          resetAction={
            settings.companionDesktopScalePercent !== DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT ? (
              <SettingResetButton
                label="desktop companion size"
                onClick={() =>
                  updateSettings({
                    companionDesktopScalePercent: DEFAULT_COMPANION_DESKTOP_SCALE_PERCENT,
                  })
                }
              />
            ) : null
          }
          control={
            <ScaleControl
              value={settings.companionDesktopScalePercent}
              min={MIN_COMPANION_DESKTOP_SCALE_PERCENT}
              max={MAX_COMPANION_DESKTOP_SCALE_PERCENT}
              step={5}
              label="Desktop companion size"
              disabled={!desktopSupported}
              onChange={(companionDesktopScalePercent) =>
                updateSettings({ companionDesktopScalePercent })
              }
            />
          }
        />

        <SettingsRow
          title="Conversation previews"
          description="Show an optional macOS-style preview of the latest prompt and agent response beside each desktop companion. Previews always start collapsed."
          control={
            <Switch
              checked={settings.companionDesktopPreviewsEnabled}
              disabled={!desktopSupported || !settings.companionDesktopEnabled}
              aria-label="Enable desktop companion conversation previews"
              onCheckedChange={(checked) =>
                updateSettings({ companionDesktopPreviewsEnabled: Boolean(checked) })
              }
            />
          }
        />

        <SettingsRow
          title="Show new companions by default"
          description="Preselect “Show on desktop” the first time a companion is assigned to a conversation."
          control={
            <Switch
              checked={settings.companionShowOnDesktopByDefault}
              disabled={!desktopSupported}
              aria-label="Show newly assigned companions on the desktop by default"
              onCheckedChange={(checked) =>
                updateSettings({ companionShowOnDesktopByDefault: Boolean(checked) })
              }
            />
          }
        />

        <SettingsRow
          title="Desktop positions"
          description="Return all visible companions to an orderly layout in the bottom-right corner."
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={!desktopSupported || resettingPositions}
              onClick={() => void resetDesktopPositions()}
            >
              {resettingPositions ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <RotateCcwIcon className="size-3.5" />
              )}
              Reset positions
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="Inside GaiWork">
        <SettingsRow
          title="Sidebar size"
          description="Adjust companion size in conversation rows. Larger companions increase the row height automatically."
          status={`${sidebarDimensions.width} × ${sidebarDimensions.height} pixels`}
          resetAction={
            settings.companionSidebarScalePercent !== DEFAULT_COMPANION_SIDEBAR_SCALE_PERCENT ? (
              <SettingResetButton
                label="sidebar companion size"
                onClick={() =>
                  updateSettings({
                    companionSidebarScalePercent: DEFAULT_COMPANION_SIDEBAR_SCALE_PERCENT,
                  })
                }
              />
            ) : null
          }
          control={
            <ScaleControl
              value={settings.companionSidebarScalePercent}
              min={MIN_COMPANION_SIDEBAR_SCALE_PERCENT}
              max={MAX_COMPANION_SIDEBAR_SCALE_PERCENT}
              step={5}
              label="Sidebar companion size"
              onChange={(companionSidebarScalePercent) =>
                updateSettings({ companionSidebarScalePercent })
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
