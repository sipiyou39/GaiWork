import { describe, expect, it } from "vite-plus/test";

import {
  chooseCompanionPreviewGeometry,
  rectangleContainsPoint,
} from "./DesktopCompanionPreviewLayout.ts";

const workArea = { x: 0, y: 0, width: 1_440, height: 900 };

describe("desktop companion preview placement", () => {
  it("prefers a notification above a companion when there is room", () => {
    const result = chooseCompanionPreviewGeometry({
      companionBounds: { x: 800, y: 600, width: 192, height: 208 },
      workArea,
    });
    expect(result.placement).toBe("top");
    expect(result.toggleBounds.y + result.toggleBounds.height).toBe(603);
    expect(result.cardBounds.y + result.cardBounds.height).toBeLessThan(result.toggleBounds.y);
  });

  it("moves below a companion near the top edge", () => {
    const result = chooseCompanionPreviewGeometry({
      companionBounds: { x: 620, y: 8, width: 192, height: 208 },
      workArea,
    });
    expect(result.placement).toBe("bottom");
    expect(result.toggleBounds.y).toBe(213);
    expect(result.cardBounds.y).toBeGreaterThan(result.toggleBounds.y);
  });

  it("keeps all geometry inside the available screen", () => {
    const result = chooseCompanionPreviewGeometry({
      companionBounds: { x: 0, y: 650, width: 192, height: 208 },
      workArea,
      obstacles: [{ x: 0, y: 250, width: 500, height: 300 }],
    });
    for (const bounds of [result.cardBounds, result.toggleBounds]) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.height);
    }
  });

  it("repositions a variable-size card while preserving screen margins", () => {
    const result = chooseCompanionPreviewGeometry({
      companionBounds: { x: 1_310, y: 380, width: 120, height: 130 },
      workArea,
      cardSize: { width: 720, height: 420 },
    });
    expect(result.placement).toBe("left");
    expect(result.toggleBounds.x + result.toggleBounds.width).toBe(1_307);
    expect(result.cardBounds.x).toBeGreaterThanOrEqual(12);
    expect(result.cardBounds.x + result.cardBounds.width).toBeLessThanOrEqual(1_428);
  });

  it("uses 24-point hysteresis to avoid placement oscillation during a drag", () => {
    const companionBounds = { x: 624, y: 250, width: 192, height: 208 };
    const withoutHistory = chooseCompanionPreviewGeometry({ companionBounds, workArea });
    const withHistory = chooseCompanionPreviewGeometry({
      companionBounds,
      workArea,
      previousPlacement: "bottom",
    });
    expect(withoutHistory.placement).toBe("top");
    expect(withHistory.placement).toBe("bottom");
  });

  it("uses half-open rectangles for secure pointer validation", () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };
    expect(rectangleContainsPoint(bounds, { x: 10, y: 20 })).toBe(true);
    expect(rectangleContainsPoint(bounds, { x: 40, y: 20 })).toBe(false);
  });
});
