import { describe, expect, it } from "vite-plus/test";

import { companionDisplayDimensions, sidebarCompanionDisplayDimensions } from "./catalog.ts";

describe("companion display dimensions", () => {
  it("scales desktop companions while preserving the atlas aspect ratio", () => {
    expect(companionDisplayDimensions(50)).toEqual({ width: 96, height: 104 });
    expect(companionDisplayDimensions(100)).toEqual({ width: 192, height: 208 });
    expect(companionDisplayDimensions(200)).toEqual({ width: 384, height: 416 });
  });

  it("scales the compact sidebar footprint independently", () => {
    expect(sidebarCompanionDisplayDimensions(75)).toEqual({ width: 21, height: 23 });
    expect(sidebarCompanionDisplayDimensions(150)).toEqual({ width: 42, height: 45 });
  });
});
