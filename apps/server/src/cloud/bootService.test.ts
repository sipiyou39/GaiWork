// @effect-diagnostics nodeBuiltinImport:off - Tests stage fixture directories on the real filesystem.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";

const isUnsupportedError = Schema.is(BootService.BootServiceUnsupportedError);
const isCommandError = Schema.is(BootService.BootServiceCommandError);

interface RecordedCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const makeRecordingRunnerLayer = (
  commands: Array<RecordedCommand>,
  options?: { readonly failCommand?: string },
) =>
  Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.sync(() => {
          commands.push({ command: input.command, args: input.args });
          const failed = input.command === options?.failCommand;
          return {
            stdout: "",
            stderr: failed ? `${input.command} exploded` : "",
            code: ChildProcessSpawner.ExitCode(failed ? 1 : 0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }),
    }),
  );

const makeHost = (entry: string): BootService.BootServiceHost => ({
  execPath: "/usr/local/bin/node",
  cliEntryPath: entry,
  cliVersion: "0.0.27",
});

const provideHostRefs = (home: string, platform: NodeJS.Platform = "linux") =>
  Effect.provide(
    Layer.mergeAll(
      Layer.succeed(HostProcessPlatform, platform),
      Layer.succeed(HostProcessEnvironment, { HOME: home, USER: "theo" }),
    ),
  );

const makeTestDirs = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-boot-service-test-"));
  return {
    home: root,
    baseDir: NodePath.join(root, ".t3"),
    logsDir: NodePath.join(root, ".t3", "userdata", "logs"),
  };
};

it("renders a systemd unit with absolute paths and append-mode logging", () => {
  const unit = BootService.renderBootServiceUnit({
    nodePath: "/usr/local/bin/node",
    t3EntryPath: "/home/theo/.t3/runtime/versions/0.0.27/node_modules/t3/dist/bin.mjs",
    baseDir: "/home/theo/.t3",
    logPath: "/home/theo/.t3/userdata/logs/boot-service.log",
    unitPath: "/home/theo/.config/systemd/user/t3code.service",
  });

  assert.equal(
    unit,
    [
      "[Unit]",
      "Description=T3 Code server (T3 Connect)",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "Environment=T3CODE_HOME=/home/theo/.t3",
      "ExecStart=/usr/local/bin/node /home/theo/.t3/runtime/versions/0.0.27/node_modules/t3/dist/bin.mjs serve",
      "Restart=always",
      "RestartSec=5",
      "StandardOutput=append:/home/theo/.t3/userdata/logs/boot-service.log",
      "StandardError=append:/home/theo/.t3/userdata/logs/boot-service.log",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  );
});

it("flags npx cache entry points as ephemeral", () => {
  assert.isTrue(
    BootService.isEphemeralNpxEntry("/home/theo/.npm/_npx/abc123/node_modules/t3/dist/bin.mjs"),
  );
  assert.isTrue(
    BootService.isEphemeralNpxEntry("C:\\Users\\theo\\AppData\\npm-cache\\_npx\\abc\\bin.mjs"),
  );
  assert.isFalse(BootService.isEphemeralNpxEntry("/usr/local/lib/node_modules/t3/dist/bin.mjs"));
  assert.isFalse(
    BootService.isEphemeralNpxEntry(
      "/home/theo/.t3/runtime/versions/0.0.27/node_modules/t3/dist/bin.mjs",
    ),
  );
});

it.layer(NodeServices.layer)("BootService", (it) => {
  it.effect("installs the unit, enables the service, and enables linger", () =>
    Effect.gen(function* () {
      const dirs = makeTestDirs();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/usr/local/lib/node_modules/t3/dist/bin.mjs"),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

      const plan = yield* service.install;

      // A stable entry point is reused directly — no npm install.
      assert.equal(plan.t3EntryPath, "/usr/local/lib/node_modules/t3/dist/bin.mjs");
      assert.deepEqual(
        commands.map((entry) => [entry.command, ...entry.args].join(" ")),
        [
          "systemctl --user daemon-reload",
          "systemctl --user enable --now t3code.service",
          "loginctl enable-linger theo",
        ],
      );

      const unitPath = NodePath.join(dirs.home, ".config", "systemd", "user", "t3code.service");
      const unit = NodeFS.readFileSync(unitPath, "utf8");
      assert.include(
        unit,
        "ExecStart=/usr/local/bin/node /usr/local/lib/node_modules/t3/dist/bin.mjs serve",
      );
      assert.include(unit, `Environment=T3CODE_HOME=${dirs.baseDir}`);

      const status = yield* service.status;
      assert.isTrue(status.installed);

      yield* service.uninstall;
      assert.isFalse(NodeFS.existsSync(unitPath));
      const statusAfter = yield* service.status;
      assert.isFalse(statusAfter.installed);
    }),
  );

  it.effect("pins a runtime via npm install when running from the npx cache", () =>
    Effect.gen(function* () {
      const dirs = makeTestDirs();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/home/theo/.npm/_npx/abc/node_modules/t3/dist/bin.mjs"),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

      const plan = yield* service.install;

      const runtimeDir = NodePath.join(dirs.baseDir, "runtime", "versions", "0.0.27");
      assert.equal(
        plan.t3EntryPath,
        NodePath.join(runtimeDir, "node_modules", "t3", "dist", "bin.mjs"),
      );
      assert.deepEqual(commands[0], {
        command: "npm",
        args: ["install", "--prefix", runtimeDir, "--no-fund", "--no-audit", "t3@0.0.27"],
      });
    }),
  );

  it.effect("fails on non-Linux platforms without touching the filesystem", () =>
    Effect.gen(function* () {
      const dirs = makeTestDirs();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/usr/local/lib/node_modules/t3/dist/bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands)),
        provideHostRefs(dirs.home, "darwin"),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isUnsupportedError(error));
      assert.lengthOf(commands, 0);
      assert.isFalse(
        NodeFS.existsSync(NodePath.join(dirs.home, ".config", "systemd", "user", "t3code.service")),
      );
    }),
  );

  it.effect("appends failed steps to the boot-service log", () =>
    Effect.gen(function* () {
      const dirs = makeTestDirs();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/usr/local/lib/node_modules/t3/dist/bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands, { failCommand: "systemctl" })),
        provideHostRefs(dirs.home),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isCommandError(error));
      assert.include(error.message, "systemctl exploded");

      const logPath = NodePath.join(dirs.logsDir, "boot-service.log");
      assert.isTrue(NodeFS.existsSync(logPath));
      assert.include(NodeFS.readFileSync(logPath, "utf8"), "systemctl exploded");
    }),
  );
});
