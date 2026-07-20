import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useDesktopCompanionComposerStore } from "./desktopCompanionComposerStore";

beforeEach(() => useDesktopCompanionComposerStore.setState({ owner: null }));

describe("desktop companion composer ownership", () => {
  it("atomically transfers ownership to the newest desktop composer", () => {
    const firstReclaim = vi.fn();
    const secondReclaim = vi.fn();
    const store = useDesktopCompanionComposerStore.getState();

    store.claim({ token: "first", threadKey: "environment:first", reclaim: firstReclaim });
    store.claim({ token: "second", threadKey: "environment:second", reclaim: secondReclaim });

    expect(useDesktopCompanionComposerStore.getState().owner).toMatchObject({
      token: "second",
      threadKey: "environment:second",
    });
  });

  it("ignores stale releases so they cannot reclaim a newer editor", () => {
    const store = useDesktopCompanionComposerStore.getState();
    store.claim({ token: "current", threadKey: "environment:thread", reclaim: vi.fn() });

    store.release("stale");
    expect(useDesktopCompanionComposerStore.getState().owner?.token).toBe("current");

    store.release("current");
    expect(useDesktopCompanionComposerStore.getState().owner).toBeNull();
  });
});
