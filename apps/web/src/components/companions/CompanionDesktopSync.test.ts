import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type CompanionProjection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectUnavailableCompanion } from "./CompanionDesktopSync";

describe("desktop companion reconnect projection", () => {
  const threadRef = scopeThreadRef(
    EnvironmentId.make("environment-test"),
    ThreadId.make("thread-test"),
  );

  it("keeps the assignment visible and preserves its last known title", () => {
    const previous: CompanionProjection = {
      companionId: "blue",
      threadRef,
      threadTitle: "Build the dashboard",
      signal: "working",
      baseAnimation: "working",
      accessibleLabel: "Build the dashboard: Working",
      showOnDesktop: true,
      preview: null,
    };

    expect(
      projectUnavailableCompanion(
        { companionId: "blue", threadRef, showOnDesktop: true },
        previous,
      ),
    ).toEqual({
      companionId: "blue",
      threadRef,
      threadTitle: "Build the dashboard",
      signal: "connecting",
      baseAnimation: "thinking",
      accessibleLabel: "Build the dashboard: Reconnecting",
      showOnDesktop: true,
      preview: null,
    });
  });

  it("preserves the assignment while the global desktop switch is off", () => {
    expect(
      projectUnavailableCompanion(
        { companionId: "blue", threadRef, showOnDesktop: true },
        undefined,
        false,
      ).showOnDesktop,
    ).toBe(false);
  });
});
