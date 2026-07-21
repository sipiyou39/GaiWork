import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const COMPANION_IDS = [
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
const MAX_CPU_PERCENT = 5;
const MAX_RSS_MIB = 350;
const MAX_POST_WARMUP_RSS_GROWTH_MIB = 32;
const DEFAULT_SETTLE_MS = 60_000;
const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 1_000;

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const webDist = NodePath.resolve(desktopDir, "../web/dist");
const companionHtml = NodePath.join(webDist, "companion.html");
if (!NodeFS.existsSync(companionHtml)) {
  throw new Error("Build the desktop app before running the companion performance smoke.");
}

const settleMs = Number(process.env.GAIWORK_COMPANION_PERF_SETTLE_MS ?? DEFAULT_SETTLE_MS);
if (!Number.isFinite(settleMs) || settleMs < 1_000) {
  throw new Error("GAIWORK_COMPANION_PERF_SETTLE_MS must be at least 1000.");
}

const temporaryRoot = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.tmpdir(), "doudou-code-companion-performance-"),
);
const harnessMainPath = NodePath.join(temporaryRoot, "main.cjs");
const harnessPreloadPath = NodePath.join(temporaryRoot, "preload.cjs");

NodeFS.writeFileSync(
  harnessPreloadPath,
  `const { contextBridge, ipcRenderer } = require("electron");
const companionIds = JSON.parse(process.env.GAIWORK_PERF_COMPANION_IDS);
const projection = {
  displayId: "performance-display",
  companionsVisible: true,
  visibilityControl: null,
  companions: companionIds.map((companionId, index) => ({
    companionId,
    signal: "idle",
    baseAnimation: "idle",
    accessibleLabel: companionId + ": Idle",
    x: (index % 5) * 200,
    y: Math.floor(index / 5) * 216,
    width: 192,
    height: 208,
    preview: null,
  })),
};
contextBridge.exposeInMainWorld("companionBridge", {
  getInitialProjection: () => projection,
  onProjection: () => () => undefined,
  notifyReady: () => ipcRenderer.send("doudou-code-performance-ready"),
  setInteractive: async () => undefined,
  sendPointerEvent: async () => undefined,
});
`,
);

NodeFS.writeFileSync(
  harnessMainPath,
  `const { app, BrowserWindow, ipcMain, screen } = require("electron");
const companionIds = JSON.parse(process.env.GAIWORK_PERF_COMPANION_IDS);
const companionUrl = process.env.GAIWORK_PERF_COMPANION_URL;
const preload = process.env.GAIWORK_PERF_PRELOAD;

function createCompanions() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const overlayBounds = {
    x: workArea.x + 16,
    y: workArea.y + 16,
    width: 992,
    height: 424,
  };
  const window = new BrowserWindow({
    ...overlayBounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    type: "panel",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, "screen-saver", 1);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.loadURL(companionUrl).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

ipcMain.on("doudou-code-performance-ready", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.showInactive();
  console.log("GAIWORK_COMPANIONS_READY");
});

app.whenReady().then(() => {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.loadURL("about:blank").then(() => {
    console.log("GAIWORK_BASELINE_READY");
    process.stdin.once("data", createCompanions);
    process.stdin.resume();
  });
});
`,
);

function contentType(pathname) {
  switch (NodePath.extname(pathname)) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".json":
      return "application/json";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

const server = NodeHttp.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const target = NodePath.resolve(webDist, `.${pathname}`);
  if (target !== webDist && !target.startsWith(`${webDist}${NodePath.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  NodeFS.createReadStream(target)
    .on("error", () => response.writeHead(404).end())
    .once("open", () => response.writeHead(200, { "Content-Type": contentType(target) }))
    .pipe(response);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Could not resolve smoke server port.");

const electronCommand = resolveElectronLaunchCommand([harnessMainPath]);
const electronEnvironment = {
  ...process.env,
  GAIWORK_PERF_COMPANION_IDS: JSON.stringify(COMPANION_IDS),
  GAIWORK_PERF_COMPANION_URL: `http://127.0.0.1:${address.port}/companion.html`,
  GAIWORK_PERF_PRELOAD: harnessPreloadPath,
};
delete electronEnvironment.ELECTRON_RUN_AS_NODE;
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: electronEnvironment,
});

let output = "";
const markerWaiters = new Set();
function appendOutput(chunk) {
  output += chunk.toString();
  for (const waiter of markerWaiters) waiter();
}
child.stdout.on("data", appendOutput);
child.stderr.on("data", appendOutput);

function waitForMarker(marker, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (!output.includes(marker)) return;
      clearTimeout(timeout);
      markerWaiters.delete(inspect);
      resolve();
    };
    const timeout = setTimeout(() => {
      markerWaiters.delete(inspect);
      reject(new Error(`Timed out waiting for ${marker}.\n${output}`));
    }, timeoutMs);
    markerWaiters.add(inspect);
    inspect();
  });
}

function processTreeMetrics(rootPid) {
  const rows = NodeChildProcess.execFileSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [pid, parentPid, rssKiB, cpuPercent] = line.trim().split(/\s+/).map(Number);
      return [
        {
          pid,
          parentPid,
          rssKiB,
          cpuPercent,
        },
      ];
    });
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.parentPid) || descendants.has(row.pid)) continue;
      descendants.add(row.pid);
      changed = true;
    }
  }
  return rows
    .filter((row) => descendants.has(row.pid))
    .reduce(
      (total, row) => ({
        rssMiB: total.rssMiB + row.rssKiB / 1024,
        cpuPercent: total.cpuPercent + row.cpuPercent,
      }),
      { rssMiB: 0, cpuPercent: 0 },
    );
}

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
async function averagedMetrics() {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(processTreeMetrics(child.pid));
    if (index < SAMPLE_COUNT - 1) await wait(SAMPLE_INTERVAL_MS);
  }
  return {
    rssMiB: Math.max(...samples.map((sample) => sample.rssMiB)),
    cpuPercent: samples.reduce((total, sample) => total + sample.cpuPercent, 0) / samples.length,
  };
}

try {
  await waitForMarker("GAIWORK_BASELINE_READY");
  await wait(2_000);
  const baseline = await averagedMetrics();
  child.stdin.write("start\n");
  await waitForMarker("GAIWORK_COMPANIONS_READY");
  const initial = await averagedMetrics();
  const warmupMs = Math.min(30_000, Math.max(1_000, Math.floor(settleMs / 2)));
  await wait(warmupMs);
  const warm = await averagedMetrics();
  await wait(Math.max(0, settleMs - warmupMs));
  const settled = await averagedMetrics();
  const addedRssMiB = Math.max(0, settled.rssMiB - baseline.rssMiB);
  const addedCpuPercent = Math.max(0, settled.cpuPercent - baseline.cpuPercent);
  const rssGrowthAfterWarmupMiB = settled.rssMiB - warm.rssMiB;

  console.log(
    JSON.stringify(
      {
        companions: COMPANION_IDS.length,
        settleMs,
        baseline,
        initial,
        warm,
        settled,
        added: { rssMiB: addedRssMiB, cpuPercent: addedCpuPercent },
        rssGrowthAfterWarmupMiB,
        limits: {
          rssMiB: MAX_RSS_MIB,
          cpuPercent: MAX_CPU_PERCENT,
          postWarmupRssGrowthMiB: MAX_POST_WARMUP_RSS_GROWTH_MIB,
        },
      },
      null,
      2,
    ),
  );

  if (
    addedRssMiB > MAX_RSS_MIB ||
    addedCpuPercent > MAX_CPU_PERCENT ||
    rssGrowthAfterWarmupMiB > MAX_POST_WARMUP_RSS_GROWTH_MIB
  ) {
    throw new Error("Companion performance budget exceeded.");
  }
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
  NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Companion performance smoke passed.");
