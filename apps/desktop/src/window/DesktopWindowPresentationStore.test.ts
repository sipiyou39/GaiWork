import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

import {
  compactWindowBoundsFromPosition,
  compactWindowPositionFromBounds,
  compactWindowWidth,
  constrainCompactWindowWidth,
  defaultCompactWindowBounds,
} from "./DesktopWindowPresentationStore.ts";
import * as DesktopWindowPresentationStore from "./DesktopWindowPresentationStore.ts";

const decodePersistedPresentation = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      mode: Schema.String,
      compact: Schema.Unknown,
    }),
  ),
);

function makeStoreLayer(baseDir: string) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  return DesktopWindowPresentationStore.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(NodeServices.layer),
  );
}

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

  it.effect("defaults legacy files to workspace and persists the retained mode atomically", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "gaiwork-window-presentation-test-",
      });
      const presentationPath = `${baseDir}/userdata/window-presentation.json`;
      yield* fileSystem.makeDirectory(`${baseDir}/userdata`, { recursive: true });
      yield* fileSystem.writeFileString(
        presentationPath,
        '{"version":1,"compact":{"displayId":"42","normalizedX":0.75,"width":720}}\n',
      );

      yield* Effect.gen(function* () {
        const store = yield* DesktopWindowPresentationStore.DesktopWindowPresentationStore;
        assert.equal(yield* store.getPresentationMode, "workspace");
        assert.deepEqual(yield* store.getCompactPosition, {
          displayId: "42",
          normalizedX: 0.75,
          width: 720,
        });
        yield* store.setPresentationMode("conversation-focus");
      }).pipe(Effect.provide(makeStoreLayer(baseDir)));

      const persisted = yield* decodePersistedPresentation(
        yield* fileSystem.readFileString(presentationPath),
      );
      assert.equal(persisted.mode, "conversation-focus");
      assert.deepEqual(persisted.compact, {
        displayId: "42",
        normalizedX: 0.75,
        width: 720,
      });

      yield* Effect.gen(function* () {
        const store = yield* DesktopWindowPresentationStore.DesktopWindowPresentationStore;
        assert.equal(yield* store.getPresentationMode, "conversation-focus");
      }).pipe(Effect.provide(makeStoreLayer(baseDir)));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
