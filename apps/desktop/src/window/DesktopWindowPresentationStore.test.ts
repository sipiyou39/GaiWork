import { assert, describe, it } from "@effect/vitest";

import {
  compactWindowBoundsFromPosition,
  compactWindowPositionFromBounds,
  compactWindowWidth,
  constrainCompactWindowWidth,
  defaultCompactWindowBounds,
} from "./DesktopWindowPresentationStore.ts";

describe("desktop window presentation geometry", () => {
  it("adapts the initial width around 720 points", () => {
    assert.equal(compactWindowWidth({ x: 0, y: 24, width: 1_728, height: 1_050 }), 726);
    assert.equal(compactWindowWidth({ x: 0, y: 24, width: 1_440, height: 876 }), 640);
    assert.equal(compactWindowWidth({ x: 0, y: 24, width: 2_560, height: 1_416 }), 760);
    assert.equal(compactWindowWidth({ x: 0, y: 24, width: 600, height: 800 }), 600);
  });

  it("places the window on the edge opposite the companion", () => {
    const workArea = { x: -1_440, y: 24, width: 1_440, height: 876 };
    assert.deepEqual(
      defaultCompactWindowBounds({
        workArea,
        companionBounds: { x: -300, y: 600, width: 192, height: 208 },
      }),
      { x: -1_440, y: 24, width: 640, height: 876 },
    );
    assert.deepEqual(
      defaultCompactWindowBounds({
        workArea,
        companionBounds: { x: -1_400, y: 600, width: 192, height: 208 },
      }),
      { x: -640, y: 24, width: 640, height: 876 },
    );
  });

  it("round-trips a normalized horizontal position on an offset display", () => {
    const workArea = { x: -1_920, y: 24, width: 1_920, height: 1_056 };
    const bounds = { x: -1_100, y: 24, width: 720, height: 1_056 };
    const position = compactWindowPositionFromBounds({ displayId: "42", bounds, workArea });
    assert.deepEqual(compactWindowBoundsFromPosition({ position, workArea }), bounds);
  });

  it("constrains restored widths to the current screen", () => {
    assert.equal(constrainCompactWindowWidth(1_200, 1_440), 900);
    assert.equal(constrainCompactWindowWidth(300, 1_440), 640);
    assert.equal(constrainCompactWindowWidth(720, 600), 600);
  });
});
