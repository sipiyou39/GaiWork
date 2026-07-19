import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldNavigateToCompanionThread } from "./AppSidebarLayout";

describe("companion thread navigation", () => {
  const environmentId = EnvironmentId.make("environment-test");
  const first = scopeThreadRef(environmentId, ThreadId.make("thread-first"));
  const second = scopeThreadRef(environmentId, ThreadId.make("thread-second"));

  it("does not route again when the companion conversation is already active", () => {
    expect(shouldNavigateToCompanionThread(first, first)).toBe(false);
    expect(shouldNavigateToCompanionThread(first, second)).toBe(true);
    expect(shouldNavigateToCompanionThread(null, first)).toBe(true);
  });
});
