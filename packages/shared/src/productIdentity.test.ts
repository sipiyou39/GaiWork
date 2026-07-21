import { assert, describe, it } from "@effect/vitest";

import {
  PRODUCT_CODEX_CLIENT_NAME,
  PRODUCT_DESKTOP_APP_ID,
  PRODUCT_DESKTOP_DEVELOPMENT_APP_ID,
  PRODUCT_DESKTOP_LEGACY_DEVELOPMENT_USER_DATA_DIRECTORIES,
  PRODUCT_DESKTOP_LEGACY_USER_DATA_DIRECTORIES,
  PRODUCT_DESKTOP_DEVELOPMENT_SCHEME,
  PRODUCT_DESKTOP_PRODUCTION_SCHEME,
  PRODUCT_DESKTOP_USER_DATA_DIRECTORY,
  PRODUCT_GITHUB_REPOSITORY,
  PRODUCT_HOME_DIRECTORY,
  PRODUCT_LEGACY_HOME_DIRECTORIES,
  PRODUCT_MCP_SERVER_NAME,
  PRODUCT_NAME,
  PRODUCT_SLUG,
} from "./productIdentity.ts";

describe("productIdentity", () => {
  it("keeps the Doudou Code runtime identity separate from T3 Code", () => {
    assert.equal(PRODUCT_NAME, "Doudou Code");
    assert.equal(PRODUCT_SLUG, "doudou-code");
    assert.equal(PRODUCT_DESKTOP_APP_ID, "io.github.sipiyou39.doudoucode");
    assert.equal(PRODUCT_DESKTOP_DEVELOPMENT_APP_ID, "io.github.sipiyou39.doudoucode.dev");
    assert.equal(PRODUCT_DESKTOP_PRODUCTION_SCHEME, "doudou-code");
    assert.equal(PRODUCT_DESKTOP_DEVELOPMENT_SCHEME, "doudou-code-dev");
    assert.equal(PRODUCT_DESKTOP_USER_DATA_DIRECTORY, "doudou-code");
    assert.equal(PRODUCT_HOME_DIRECTORY, ".doudou-code");
    assert.deepEqual(PRODUCT_LEGACY_HOME_DIRECTORIES, [".gaiwork"]);
    assert.deepEqual(PRODUCT_DESKTOP_LEGACY_USER_DATA_DIRECTORIES, ["gaiwork", "GaiWork"]);
    assert.deepEqual(PRODUCT_DESKTOP_LEGACY_DEVELOPMENT_USER_DATA_DIRECTORIES, [
      "gaiwork-dev",
      "GaiWork (Dev)",
    ]);
    assert.equal(PRODUCT_MCP_SERVER_NAME, "doudou-code");
    assert.equal(PRODUCT_CODEX_CLIENT_NAME, "doudou_code_desktop");
    assert.equal(PRODUCT_GITHUB_REPOSITORY, "sipiyou39/GaiWork");
  });
});
