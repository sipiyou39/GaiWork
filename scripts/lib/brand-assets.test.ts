import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { PNG } from "pngjs";
import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  PUBLISH_ICON_OVERRIDES,
  resolveWebAssetBrandForChannel,
  resolveWebIconOverrides,
} from "./brand-assets.ts";
import { readPngDimensions } from "./icon-export.ts";

describe("brand-assets", () => {
  it("maps server publish web assets to production icons", () => {
    expect(PUBLISH_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFavicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFavicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFaviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("maps development web assets to the public splash and favicon files", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFaviconIco,
        targetRelativePath: "apps/web/public/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFavicon16Png,
        targetRelativePath: "apps/web/public/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFavicon32Png,
        targetRelativePath: "apps/web/public/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebAppleTouchIconPng,
        targetRelativePath: "apps/web/public/apple-touch-icon.png",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("maps hosted nightly web assets to the shared Doudou Code icon", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.doudouCodeWebFaviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("keeps platform icon families explicit and shares the Doudou Code macOS artwork", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toBe(
      BRAND_ASSET_PATHS.doudouCodeMacIconPng,
    );
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toBe(BRAND_ASSET_PATHS.doudouCodeMacIconPng);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toBe(BRAND_ASSET_PATHS.doudouCodeMacIconPng);
  });

  effectIt.effect("keeps the shared Doudou Code icon family valid and synchronized", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const read = (relativePath: string) =>
        fileSystem.readFile(relativePath).pipe(Effect.map((contents) => Buffer.from(contents)));
      const contents = yield* read(BRAND_ASSET_PATHS.doudouCodeMacIconPng);
      const icon = PNG.sync.read(contents);
      const alphaAt = (x: number, y: number) => icon.data[(y * icon.width + x) * 4 + 3];

      expect(readPngDimensions(contents)).toEqual({ width: 1024, height: 1024 });
      expect(contents[24]).toBe(8); // PNG IHDR bit depth
      expect(contents[25]).toBe(6); // PNG IHDR RGBA color type
      expect([alphaAt(0, 0), alphaAt(1023, 0), alphaAt(0, 1023), alphaAt(1023, 1023)]).toEqual([
        0, 0, 0, 0,
      ]);
      expect(alphaAt(512, 512)).toBe(255);

      const webPngs = [
        [BRAND_ASSET_PATHS.doudouCodeWebFavicon16Png, 16],
        [BRAND_ASSET_PATHS.doudouCodeWebFavicon32Png, 32],
        [BRAND_ASSET_PATHS.doudouCodeWebAppleTouchIconPng, 180],
      ] as const;
      yield* Effect.forEach(webPngs, ([relativePath, expectedSize]) =>
        Effect.gen(function* () {
          const webContents = yield* read(relativePath);
          const webIcon = PNG.sync.read(webContents);
          expect(readPngDimensions(webContents)).toEqual({
            width: expectedSize,
            height: expectedSize,
          });
          expect(webContents[25]).toBe(6);
          expect(webIcon.data[3]).toBe(0);
          expect(
            webIcon.data[
              Math.floor(expectedSize / 2) * expectedSize * 4 + Math.floor(expectedSize / 2) * 4 + 3
            ],
          ).toBe(255);
        }),
      );

      const webCopies = [
        [BRAND_ASSET_PATHS.doudouCodeWebFaviconIco, "apps/web/public/favicon.ico"],
        [BRAND_ASSET_PATHS.doudouCodeWebFavicon16Png, "apps/web/public/favicon-16x16.png"],
        [BRAND_ASSET_PATHS.doudouCodeWebFavicon32Png, "apps/web/public/favicon-32x32.png"],
        [BRAND_ASSET_PATHS.doudouCodeWebAppleTouchIconPng, "apps/web/public/apple-touch-icon.png"],
      ] as const;
      yield* Effect.forEach(webCopies, ([source, publicCopy]) =>
        Effect.gen(function* () {
          expect(yield* read(publicCopy)).toEqual(yield* read(source));
        }),
      );

      const favicon = yield* read(BRAND_ASSET_PATHS.doudouCodeWebFaviconIco);
      expect([...favicon.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
