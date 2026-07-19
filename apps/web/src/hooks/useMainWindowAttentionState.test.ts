import { describe, expect, it } from "vite-plus/test";

import { isMainWindowAttentive } from "./useMainWindowAttentionState";

describe("main window attention", () => {
  it("requires a visible, focused, non-minimized window", () => {
    expect(isMainWindowAttentive({ visible: true, focused: true, minimized: false })).toBe(true);
    expect(isMainWindowAttentive({ visible: false, focused: true, minimized: false })).toBe(false);
    expect(isMainWindowAttentive({ visible: true, focused: false, minimized: false })).toBe(false);
    expect(isMainWindowAttentive({ visible: true, focused: true, minimized: true })).toBe(false);
  });
});
