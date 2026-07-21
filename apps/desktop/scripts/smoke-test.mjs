import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");
const repoRoot = NodePath.resolve(desktopDir, "../..");
const companionRuntimeRoots = [
  NodePath.resolve(repoRoot, "apps/web/dist"),
  NodePath.resolve(repoRoot, "apps/server/dist/client"),
];
const companionIds = [
  "aurore",
  "blue",
  "purple",
  "black",
  "yellow",
  "orange",
  "red",
  "gray",
  "white",
];

for (const requiredPath of [
  NodePath.resolve(desktopDir, "dist-electron/companion-preload.cjs"),
  ...companionRuntimeRoots.flatMap((runtimeRoot) => [
    NodePath.resolve(runtimeRoot, "companion.html"),
    NodePath.resolve(runtimeRoot, "companions/sounds/completion.mp3"),
    ...companionIds.flatMap((companionId) => [
      NodePath.resolve(runtimeRoot, `companions/${companionId}/manifest.json`),
      NodePath.resolve(runtimeRoot, `companions/${companionId}/spritesheet.webp`),
    ]),
  ]),
]) {
  if (!NodeFS.existsSync(requiredPath)) {
    console.error(`Desktop smoke test failed: missing companion runtime asset ${requiredPath}`);
    process.exit(1);
  }
}

console.log("\nLaunching Electron smoke test...");

const electronCommand = resolveElectronLaunchCommand([mainJs]);
const electronEnvironment = {
  ...process.env,
  VITE_DEV_SERVER_URL: "",
  ELECTRON_ENABLE_LOGGING: "1",
};
delete electronEnvironment.ELECTRON_RUN_AS_NODE;
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: electronEnvironment,
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, 8_000);

child.on("exit", () => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
