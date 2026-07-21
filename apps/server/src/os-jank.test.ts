import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveBaseDir } from "./os-jank.ts";

it.layer(NodeServices.layer)("server base directory identity", (it) => {
  it.effect("defaults standalone server state to the Doudou Code home", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "doudou-code-server-home-",
      });
      assert.equal(
        yield* resolveBaseDir(undefined, homeDirectory),
        path.join(homeDirectory, ".doudou-code"),
      );
      assert.equal(
        yield* resolveBaseDir("  ", homeDirectory),
        path.join(homeDirectory, ".doudou-code"),
      );
    }),
  );

  it.effect("reuses an existing GaiWork home during the identity migration", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "doudou-code-server-legacy-home-",
      });
      const legacyHome = path.join(homeDirectory, ".gaiwork");
      yield* fileSystem.makeDirectory(legacyHome);

      assert.equal(yield* resolveBaseDir(undefined, homeDirectory), legacyHome);
    }),
  );
});
