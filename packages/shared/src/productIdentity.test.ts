import { assert, describe, it } from "@effect/vitest";

import {
  PRODUCT_CODEX_CLIENT_NAME,
  PRODUCT_DESKTOP_APP_ID,
  PRODUCT_DESKTOP_DEVELOPMENT_APP_ID,
  PRODUCT_DESKTOP_DEVELOPMENT_SCHEME,
  PRODUCT_DESKTOP_PRODUCTION_SCHEME,
  PRODUCT_DESKTOP_USER_DATA_DIRECTORY,
  PRODUCT_GITHUB_REPOSITORY,
  PRODUCT_HOME_DIRECTORY,
  PRODUCT_MCP_SERVER_NAME,
  PRODUCT_NAME,
} from "./productIdentity.ts";

describe("productIdentity", () => {
  it("keeps the GaiWork runtime identity separate from T3 Code", () => {
    assert.equal(PRODUCT_NAME, "GaiWork");
    assert.equal(PRODUCT_DESKTOP_APP_ID, "io.github.sipiyou39.gaiwork");
    assert.equal(PRODUCT_DESKTOP_DEVELOPMENT_APP_ID, "io.github.sipiyou39.gaiwork.dev");
    assert.equal(PRODUCT_DESKTOP_PRODUCTION_SCHEME, "gaiwork");
    assert.equal(PRODUCT_DESKTOP_DEVELOPMENT_SCHEME, "gaiwork-dev");
    assert.equal(PRODUCT_DESKTOP_USER_DATA_DIRECTORY, "gaiwork");
    assert.equal(PRODUCT_HOME_DIRECTORY, ".gaiwork");
    assert.equal(PRODUCT_MCP_SERVER_NAME, "gaiwork");
    assert.equal(PRODUCT_CODEX_CLIENT_NAME, "gaiwork_desktop");
    assert.equal(PRODUCT_GITHUB_REPOSITORY, "sipiyou39/GaiWork");
  });
});
