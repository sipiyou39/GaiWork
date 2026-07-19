import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveBaseDir } from "./os-jank.ts";

it.layer(NodeServices.layer)("server base directory identity", (it) => {
  it.effect("defaults standalone server state to ~/.gaiwork", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(yield* resolveBaseDir(undefined), path.join(NodeOS.homedir(), ".gaiwork"));
      assert.equal(yield* resolveBaseDir("  "), path.join(NodeOS.homedir(), ".gaiwork"));
    }),
  );
});
