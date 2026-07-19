import { assert, describe, it } from "@effect/vitest";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  acceptCompanionSnapshot,
  companionOverlayBounds,
  desktopCompanionPresentation,
} from "./DesktopCompanionManager.ts";

describe("companion projection revisions", () => {
  it("accepts only increasing revisions from the active renderer epoch", () => {
    const first = acceptCompanionSnapshot(null, { sourceEpoch: "first", revision: 1 });
    assert.isNotNull(first);
    assert.isNull(acceptCompanionSnapshot(first, { sourceEpoch: "first", revision: 1 }));
    assert.isNull(acceptCompanionSnapshot(first, { sourceEpoch: "first", revision: 0 }));
    assert.strictEqual(
      acceptCompanionSnapshot(first, { sourceEpoch: "first", revision: 2 })?.revision,
      2,
    );
  });

  it("retires old epochs after a renderer restart", () => {
    const first = acceptCompanionSnapshot(null, { sourceEpoch: "first", revision: 10 });
    const second = acceptCompanionSnapshot(first, { sourceEpoch: "second", revision: 0 });
    assert.strictEqual(second?.sourceEpoch, "second");
    assert.isNull(acceptCompanionSnapshot(second, { sourceEpoch: "first", revision: 11 }));
  });
});

describe("isolated companion presentation", () => {
  it("does not expose the conversation identity to the companion renderer", () => {
    assert.deepEqual(
      desktopCompanionPresentation({
        projection: {
          companionId: "blue",
          threadRef: {
            environmentId: EnvironmentId.make("environment-test"),
            threadId: ThreadId.make("thread-test"),
          },
          threadTitle: "Secret thread",
          signal: "working",
          baseAnimation: "working",
          accessibleLabel: "Secret thread: Working",
          showOnDesktop: true,
        },
        bounds: { x: 110, y: 220, width: 192, height: 208 },
        overlayBounds: { x: 10, y: 20, width: 1200, height: 800 },
      }),
      {
        companionId: "blue",
        baseAnimation: "working",
        accessibleLabel: "Secret thread: Working",
        x: 100,
        y: 200,
        width: 192,
        height: 208,
      },
    );
  });

  it("uses only the compact union of companion rectangles at rest", () => {
    assert.deepEqual(
      companionOverlayBounds(
        [
          { bounds: { x: 100, y: 200, width: 192, height: 208 } },
          { bounds: { x: 300, y: 200, width: 192, height: 208 } },
        ],
        { x: 0, y: 24, width: 1200, height: 800 },
      ),
      { x: 100, y: 200, width: 392, height: 208 },
    );
  });
});
