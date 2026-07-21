export const PRODUCT_NAME = "Doudou Code";
export const PRODUCT_SLUG = "doudou-code";

export const PRODUCT_DESKTOP_APP_ID = "io.github.sipiyou39.doudoucode";
export const PRODUCT_DESKTOP_DEVELOPMENT_APP_ID = `${PRODUCT_DESKTOP_APP_ID}.dev`;
export const PRODUCT_DESKTOP_PRODUCTION_SCHEME = PRODUCT_SLUG;
export const PRODUCT_DESKTOP_DEVELOPMENT_SCHEME = `${PRODUCT_SLUG}-dev`;
export const PRODUCT_DESKTOP_USER_DATA_DIRECTORY = PRODUCT_SLUG;
export const PRODUCT_DESKTOP_DEVELOPMENT_USER_DATA_DIRECTORY = `${PRODUCT_SLUG}-dev`;
export const PRODUCT_HOME_DIRECTORY = `.${PRODUCT_SLUG}`;

// Read-only compatibility aliases. New installations never create data under
// these names, while existing GaiWork installations keep their local state.
export const PRODUCT_LEGACY_HOME_DIRECTORIES = [".gaiwork"] as const;
export const PRODUCT_DESKTOP_LEGACY_USER_DATA_DIRECTORIES = ["gaiwork", "GaiWork"] as const;
export const PRODUCT_DESKTOP_LEGACY_DEVELOPMENT_USER_DATA_DIRECTORIES = [
  "gaiwork-dev",
  "GaiWork (Dev)",
] as const;

// The repository is an external publishing endpoint and keeps its current
// GitHub name until that repository is explicitly renamed.
export const PRODUCT_GITHUB_REPOSITORY = "sipiyou39/GaiWork";
export const PRODUCT_MCP_SERVER_NAME = PRODUCT_SLUG;
export const PRODUCT_CODEX_CLIENT_NAME = "doudou_code_desktop";
