import { assert, describe, it } from "@effect/vitest";

import {
  boundsFromPosition,
  constrainCompanionBounds,
  defaultCompanionBounds,
  positionFromBounds,
} from "./DesktopCompanionPositions.ts";

const workArea = { x: -1920, y: 24, width: 1920, height: 1056 };

describe("desktop companion positions", () => {
  it("round-trips normalized coordinates on an offset display", () => {
    const bounds = { x: -1010, y: 500, width: 192, height: 208 };
    const position = positionFromBounds({ displayId: "42", bounds, workArea });
    assert.deepEqual(boundsFromPosition({ position, workArea, width: 192, height: 208 }), bounds);
  });

  it("constrains companions entirely inside the work area", () => {
    assert.deepEqual(
      constrainCompanionBounds({ x: 100, y: -100, width: 192, height: 208 }, workArea),
      { x: -192, y: 24, width: 192, height: 208 },
    );
  });

  it("places new companions from bottom-right toward the left", () => {
    const first = defaultCompanionBounds({ index: 0, workArea, width: 192, height: 208 });
    const second = defaultCompanionBounds({ index: 1, workArea, width: 192, height: 208 });
    assert.isAbove(first.x, second.x);
    assert.strictEqual(first.y, second.y);
  });
});
