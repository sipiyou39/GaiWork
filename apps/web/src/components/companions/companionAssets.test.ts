// @effect-diagnostics nodeBuiltinImport:off
import { COMPANION_ANIMATIONS, COMPANION_ATLAS } from "@t3tools/client-runtime/companions";
import {
  COMPANION_ANIMATION_STATES,
  COMPANION_IDS,
  type CompanionAnimationState,
} from "@t3tools/contracts";
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import aurore from "../../../public/companions/aurore/manifest.json";
import black from "../../../public/companions/black/manifest.json";
import blue from "../../../public/companions/blue/manifest.json";
import gray from "../../../public/companions/gray/manifest.json";
import orange from "../../../public/companions/orange/manifest.json";
import purple from "../../../public/companions/purple/manifest.json";
import red from "../../../public/companions/red/manifest.json";
import white from "../../../public/companions/white/manifest.json";
import yellow from "../../../public/companions/yellow/manifest.json";

const manifests = { aurore, black, blue, gray, orange, purple, red, white, yellow };

describe("companion assets", () => {
  it("contains one valid 8 x 9 manifest for every catalog identity", () => {
    expect(Object.keys(manifests).sort()).toEqual([...COMPANION_IDS].sort());
    for (const companionId of COMPANION_IDS) {
      const manifest = manifests[companionId];
      expect(manifest.id).toBe(companionId);
      expect(manifest.atlas).toMatchObject(COMPANION_ATLAS);
      expect(Object.keys(manifest.states).sort()).toEqual([...COMPANION_ANIMATION_STATES].sort());
      for (const animation of COMPANION_ANIMATION_STATES) {
        const state = manifest.states[animation as CompanionAnimationState];
        const expected = COMPANION_ANIMATIONS[animation];
        expect(state.row).toBe(expected.row);
        expect(state.frameCount).toBe(expected.frameCount);
        expect(state.durationsMs).toEqual(expected.durationsMs);
        expect(state.durationsMs).toHaveLength(state.frameCount);
        expect(state.loop).toBe(expected.loop);
      }
    }
  });

  it("ships every lossless WebP at the declared atlas dimensions", () => {
    for (const companionId of COMPANION_IDS) {
      const bytes = NodeFS.readFileSync(
        new URL(`../../../public/companions/${companionId}/spritesheet.webp`, import.meta.url),
      );
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
      expect(bytes.toString("ascii", 12, 16)).toBe("VP8L");
      expect(bytes[20]).toBe(0x2f);
      const dimensions = bytes.readUInt32LE(21);
      expect((dimensions & 0x3fff) + 1).toBe(COMPANION_ATLAS.width);
      expect(((dimensions >>> 14) & 0x3fff) + 1).toBe(COMPANION_ATLAS.height);
    }
  });

  it("ships the custom completion notification sound", () => {
    const bytes = NodeFS.readFileSync(
      new URL("../../../public/companions/sounds/completion.mp3", import.meta.url),
    );
    expect(bytes.byteLength).toBeGreaterThan(64_000);
    expect(bytes.toString("ascii", 0, 3)).toBe("ID3");
  });
});
