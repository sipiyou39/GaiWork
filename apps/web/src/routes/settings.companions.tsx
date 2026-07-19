import { createFileRoute } from "@tanstack/react-router";

import { CompanionSettingsPanel } from "../components/settings/CompanionSettingsPanel";

function SettingsCompanionsRoute() {
  return <CompanionSettingsPanel />;
}

export const Route = createFileRoute("/settings/companions")({
  component: SettingsCompanionsRoute,
});
