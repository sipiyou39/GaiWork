import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as ProcessRunner from "../processRunner.ts";

/**
 * Installs T3 Code as a per-user boot service so a connected machine stays
 * reachable through T3 Connect after the SSH session ends. Linux-only for
 * now: systemd user unit + loginctl enable-linger. The service runs a pinned
 * runtime installed under <baseDir>/runtime — never `npx t3`, whose cache is
 * ephemeral and whose registry fetch at boot would make startup depend on
 * the network.
 */

export const BOOT_SERVICE_NAME = "t3code";
export const BOOT_RUNTIME_DIR = "runtime";

const BOOT_SERVICE_UNIT_FILE = `${BOOT_SERVICE_NAME}.service`;

/**
 * `npx t3` runs out of npm's ephemeral cache, which can be evicted at any
 * time — a boot service must never point there. Global installs, repo
 * checkouts, and the pinned runtime below are all stable.
 */
export function isEphemeralNpxEntry(entryPath: string): boolean {
  return entryPath.includes("/_npx/") || entryPath.includes("\\_npx\\");
}

export interface BootServicePlan {
  /** Absolute path of the node binary running this CLI. */
  readonly nodePath: string;
  /** Absolute path of the pinned t3 entry point the unit will run. */
  readonly t3EntryPath: string;
  readonly baseDir: string;
  readonly logPath: string;
  readonly unitPath: string;
}

/**
 * Pure so it is testable byte-for-byte. systemd user units run with a
 * minimal environment: every path must be absolute, and the service must
 * not rely on PATH, nvm shims, or shell profiles. Failures land in
 * `logPath` because `systemctl --user` failures are otherwise invisible.
 */
export function renderBootServiceUnit(plan: BootServicePlan): string {
  return [
    "[Unit]",
    "Description=T3 Code server (T3 Connect)",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `Environment=T3CODE_HOME=${plan.baseDir}`,
    `ExecStart=${plan.nodePath} ${plan.t3EntryPath} serve`,
    "Restart=always",
    "RestartSec=5",
    `StandardOutput=append:${plan.logPath}`,
    `StandardError=append:${plan.logPath}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export class BootServiceUnsupportedError extends Schema.TaggedErrorClass<BootServiceUnsupportedError>()(
  "BootServiceUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `Background setup currently supports Linux with systemd; this machine reports '${this.platform}'.`;
  }
}

export class BootServiceCommandError extends Schema.TaggedErrorClass<BootServiceCommandError>()(
  "BootServiceCommandError",
  {
    step: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Background setup failed while ${this.step}: ${this.detail}`;
  }
}

export class BootServiceInstallError extends Schema.TaggedErrorClass<BootServiceInstallError>()(
  "BootServiceInstallError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not set up the T3 Code background service.";
  }
}

export type BootServiceError =
  | BootServiceUnsupportedError
  | BootServiceCommandError
  | BootServiceInstallError;

export interface BootServiceStatus {
  readonly installed: boolean;
  readonly unitPath: string;
  readonly logPath: string;
}

export class BootService extends Context.Service<
  BootService,
  {
    /** Installs the pinned runtime + unit, enables linger, starts the service. */
    readonly install: Effect.Effect<BootServicePlan, BootServiceError>;
    /** Stops and removes the unit; leaves the pinned runtime for reuse. */
    readonly uninstall: Effect.Effect<void, BootServiceError>;
    readonly status: Effect.Effect<BootServiceStatus, BootServiceError>;
  }
>()("t3/cloud/bootService") {}

export interface BootServiceHost {
  readonly execPath: string;
  readonly cliEntryPath: string;
  readonly cliVersion: string;
}

const defaultHost = (cliVersion: string): BootServiceHost => ({
  execPath: process.execPath,
  // When running the packed CLI this is dist/bin.mjs; when stable (global
  // install, repo checkout) the boot service runs this same artifact.
  cliEntryPath: process.argv[1] ?? "",
  cliVersion,
});

export const make = Effect.fnUntraced(function* (input: {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly cliVersion: string;
  readonly host?: BootServiceHost;
}) {
  const host = input.host ?? defaultHost(input.cliVersion);
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;

  const homeDir = env.HOME ?? "";
  const unitDir = path.join(homeDir, ".config", "systemd", "user");
  const unitPath = path.join(unitDir, BOOT_SERVICE_UNIT_FILE);
  const logPath = path.join(input.logsDir, "boot-service.log");
  const runtimeVersionDir = path.join(input.baseDir, BOOT_RUNTIME_DIR, "versions", host.cliVersion);
  const runtimeEntryPath = path.join(runtimeVersionDir, "node_modules", "t3", "dist", "bin.mjs");

  const requireSystemdLinux = Effect.gen(function* () {
    if (platform !== "linux" || homeDir === "") {
      return yield* new BootServiceUnsupportedError({ platform });
    }
  });

  const runStep = (step: string, command: string, args: ReadonlyArray<string>) =>
    runner.run({ command, args, env: { ...env } }).pipe(
      Effect.mapError(
        (cause) => new BootServiceCommandError({ step, detail: String(cause.message) }),
      ),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new BootServiceCommandError({
            step,
            detail: result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`,
          }),
      ),
      Effect.tapError((error) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            fs.writeFileString(logPath, `${DateTime.formatIso(now)} ${error.message}\n`, {
              flag: "a",
            }),
          ),
          Effect.ignore,
        ),
      ),
    );

  /**
   * Resolves the entry point the unit should run. A stable install (global
   * bin, repo checkout, previously pinned runtime) is used as-is; an npx
   * cache entry is replaced by `npm install --prefix`-ing the exact running
   * version into <baseDir>/runtime/versions/<v>. A real install (not a copy
   * of bin.mjs) because t3 ships native deps like node-pty.
   */
  const resolveStableEntry = Effect.gen(function* () {
    if (!isEphemeralNpxEntry(host.cliEntryPath)) {
      return host.cliEntryPath;
    }
    const alreadyPinned = yield* fs
      .exists(runtimeEntryPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    if (alreadyPinned) {
      return runtimeEntryPath;
    }
    yield* fs
      .makeDirectory(runtimeVersionDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* runStep("installing the pinned t3 runtime (this can take a minute)", "npm", [
      "install",
      "--prefix",
      runtimeVersionDir,
      "--no-fund",
      "--no-audit",
      `t3@${host.cliVersion}`,
    ]);
    return runtimeEntryPath;
  });

  const install: BootService["Service"]["install"] = Effect.gen(function* () {
    yield* requireSystemdLinux;
    yield* fs
      .makeDirectory(input.logsDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));

    const plan: BootServicePlan = {
      nodePath: host.execPath,
      t3EntryPath: yield* resolveStableEntry,
      baseDir: input.baseDir,
      logPath,
      unitPath,
    };

    yield* fs.makeDirectory(unitDir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(unitPath, renderBootServiceUnit(plan))),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );

    yield* runStep("reloading systemd user units", "systemctl", ["--user", "daemon-reload"]);
    yield* runStep("enabling the service", "systemctl", [
      "--user",
      "enable",
      "--now",
      BOOT_SERVICE_UNIT_FILE,
    ]);
    // Linger keeps the user manager (and this service) running without an
    // open session — the whole point on a box reached over SSH.
    yield* runStep("enabling lingering for this user", "loginctl", [
      "enable-linger",
      env.USER ?? "",
    ]);

    return plan;
  }).pipe(Effect.withSpan("cloud.boot_service.install"));

  const uninstall: BootService["Service"]["uninstall"] = Effect.gen(function* () {
    yield* requireSystemdLinux;
    const exists = yield* fs
      .exists(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    if (!exists) {
      return;
    }
    yield* runStep("stopping the service", "systemctl", [
      "--user",
      "disable",
      "--now",
      BOOT_SERVICE_UNIT_FILE,
    ]).pipe(Effect.ignore({ log: true }));
    yield* fs
      .remove(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* runStep("reloading systemd user units", "systemctl", ["--user", "daemon-reload"]);
  }).pipe(Effect.withSpan("cloud.boot_service.uninstall"));

  const status: BootService["Service"]["status"] = Effect.gen(function* () {
    if (platform !== "linux" || homeDir === "") {
      return { installed: false, unitPath, logPath };
    }
    const installed = yield* fs
      .exists(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    return { installed, unitPath, logPath };
  }).pipe(Effect.withSpan("cloud.boot_service.status"));

  return BootService.of({ install, uninstall, status });
});

export const layer = (input: {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly cliVersion: string;
  readonly host?: BootServiceHost;
}) => Layer.effect(BootService, make(input)).pipe(Layer.provide(ProcessRunner.layer));
