import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { CompanionPointerEvent, CompanionProjectionSnapshot } from "./companions.ts";

describe("companion IPC contracts", () => {
  const decodeSnapshot = Schema.decodeUnknownSync(CompanionProjectionSnapshot);
  const decodePointerEvent = Schema.decodeUnknownSync(CompanionPointerEvent);

  it("limits a desktop snapshot to the nine global companion identities", () => {
    const projection = {
      companionId: "blue",
      threadRef: { environmentId: "environment-test", threadId: "thread-test" },
      threadTitle: "Test thread",
      signal: "idle",
      baseAnimation: "idle",
      accessibleLabel: "Test thread: Idle",
      showOnDesktop: true,
      preview: null,
    };

    expect(() =>
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        desktopScalePercent: 100,
        companions: Array.from({ length: 10 }, () => projection),
      }),
    ).toThrow();
  });

  it("defaults legacy desktop snapshots to the original companion size", () => {
    expect(
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        companions: [],
      }).desktopScalePercent,
    ).toBe(100);
    expect(
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        companions: [],
      }).desktopPreviewsEnabled,
    ).toBe(true);
  });

  it("rejects desktop scales outside the supported range", () => {
    expect(() =>
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        desktopScalePercent: 201,
        companions: [],
      }),
    ).toThrow();
  });

  it("rejects non-finite pointer coordinates", () => {
    expect(() =>
      decodePointerEvent({
        phase: "move",
        target: "companion",
        presentationIndex: 0,
        screenX: Number.NaN,
        screenY: 20,
      }),
    ).toThrow();
  });

  it("requires the isolated renderer to identify its pointer surface", () => {
    expect(() =>
      decodePointerEvent({
        phase: "up",
        presentationIndex: 0,
        screenX: 20,
        screenY: 20,
      }),
    ).toThrow();
  });
});
