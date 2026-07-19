import { describe, expect, it } from "vite-plus/test";

import { resolveCompanionInteractionAnimation } from "./interaction.ts";

describe("companion interaction animation", () => {
  it("keeps working visible through hover and initial appearance", () => {
    expect(
      resolveCompanionInteractionAnimation({
        baseAnimation: "working",
        hovered: true,
        appearing: true,
      }),
    ).toBe("working");
  });

  it("uses continuous-jump state for an idle hover", () => {
    expect(
      resolveCompanionInteractionAnimation({
        baseAnimation: "idle",
        hovered: true,
        appearing: false,
      }),
    ).toBe("jumping");
  });

  it("does not interrupt working while dragging", () => {
    expect(
      resolveCompanionInteractionAnimation({
        baseAnimation: "working",
        dragAnimation: "running-left",
        hovered: true,
        appearing: true,
      }),
    ).toBe("working");
  });

  it("uses running while dragging a companion that is not working", () => {
    expect(
      resolveCompanionInteractionAnimation({
        baseAnimation: "idle",
        dragAnimation: "running-left",
        hovered: true,
        appearing: true,
      }),
    ).toBe("running-left");
  });
});
