import { assert, describe, it } from "@effect/vitest";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  acceptCompanionSnapshot,
  companionOverlayBounds,
  desktopCompanionPresentation,
  desktopCompanionVisibilityControlPresentation,
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
          preview: null,
        },
        bounds: { x: 110, y: 220, width: 192, height: 208 },
        preview: null,
        overlayBounds: { x: 10, y: 20, width: 1200, height: 800 },
        desktopExpandedView: "response-and-composer",
      }),
      {
        companionId: "blue",
        signal: "working",
        baseAnimation: "working",
        accessibleLabel: "Secret thread: Working",
        x: 100,
        y: 200,
        width: 192,
        height: 208,
        preview: null,
      },
    );
  });

  it("keeps a stable work-area overlay at rest", () => {
    assert.deepEqual(
      companionOverlayBounds(
        [
          { bounds: { x: 100, y: 200, width: 192, height: 208 }, preview: null },
          { bounds: { x: 300, y: 200, width: 192, height: 208 }, preview: null },
        ],
        { x: 0, y: 24, width: 1200, height: 800 },
      ),
      { x: 0, y: 24, width: 1200, height: 800 },
    );
  });

  it("projects the global visibility control into an offset display", () => {
    assert.deepEqual(
      desktopCompanionVisibilityControlPresentation({
        bounds: { x: -1_902, y: 1_022, width: 40, height: 40 },
        overlayBounds: { x: -1_920, y: 24, width: 1_920, height: 1_056 },
      }),
      { x: 18, y: 998, size: 40 },
    );
  });

  it("exposes the reply button only for the response-only preference", () => {
    const projection = {
      companionId: "blue" as const,
      threadRef: {
        environmentId: EnvironmentId.make("environment-test"),
        threadId: ThreadId.make("thread-test"),
      },
      threadTitle: "Test thread",
      signal: "idle" as const,
      baseAnimation: "idle" as const,
      accessibleLabel: "Test thread: Idle",
      showOnDesktop: true,
      preview: {
        userMessageId: null,
        userText: null,
        assistantMessageId: null,
        assistantText: "Latest response",
        assistantStreaming: false,
      },
    };
    const preview = {
      placement: "top" as const,
      mode: "preview" as const,
      toggleBounds: { x: 579, y: 458, width: 34, height: 34 },
      cardBounds: { x: 416, y: 274, width: 420, height: 176 },
    };
    const common = {
      projection,
      bounds: { x: 500, y: 500, width: 192, height: 208 },
      preview,
      overlayBounds: { x: 0, y: 24, width: 1_200, height: 800 },
    };

    assert.isFalse(
      desktopCompanionPresentation({
        ...common,
        desktopExpandedView: "response-and-composer",
      }).preview?.showComposerButton,
    );
    assert.isTrue(
      desktopCompanionPresentation({
        ...common,
        desktopExpandedView: "response-only",
      }).preview?.showComposerButton,
    );
  });

  it("does not resize the native overlay when a preview collapses", () => {
    const base = {
      bounds: { x: 500, y: 500, width: 192, height: 208 },
      preview: {
        placement: "top" as const,
        mode: "preview" as const,
        toggleBounds: { x: 579, y: 458, width: 34, height: 34 },
        cardBounds: { x: 416, y: 314, width: 360, height: 136 },
      },
    };

    const workArea = { x: 0, y: 24, width: 1_200, height: 800 };
    assert.deepEqual(companionOverlayBounds([base], workArea), workArea);
    assert.deepEqual(
      companionOverlayBounds(
        [{ ...base, preview: { ...base.preview, mode: "collapsed" as const } }],
        workArea,
      ),
      workArea,
    );
  });

  it("keeps identical native bounds across repeated preview transitions", () => {
    const workArea = { x: -1_440, y: 24, width: 1_440, height: 876 };
    const bounds = { x: -260, y: 620, width: 192, height: 208 };
    for (let cycle = 0; cycle < 100; cycle += 1) {
      assert.deepEqual(
        companionOverlayBounds(
          [
            {
              bounds,
              preview: {
                placement: "top",
                mode: cycle % 2 === 0 ? "preview" : "collapsed",
                toggleBounds: { x: -181, y: 579, width: 34, height: 34 },
                cardBounds: { x: -344, y: 435, width: 360, height: 136 },
              },
            },
          ],
          workArea,
        ),
        workArea,
      );
    }
  });
});
