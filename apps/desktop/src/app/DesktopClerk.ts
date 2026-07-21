import { createClerkBridge, type ClerkBridge, type TokenStorage } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

declare const __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;
declare const __T3CODE_BUILD_IS_DEVELOPMENT__: boolean | undefined;

export interface PreReadyDesktopClerkBridge {
  readonly bridge: ClerkBridge;
  readonly isDevelopment: boolean;
  readonly setStorage: (storage: TokenStorage) => void;
}

export class DesktopClerkPreReadyInitializationError extends Schema.TaggedErrorClass<DesktopClerkPreReadyInitializationError>()(
  "DesktopClerkPreReadyInitializationError",
  {
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge before Electron became ready (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeInitializationError extends Schema.TaggedErrorClass<DesktopClerkBridgeInitializationError>()(
  "DesktopClerkBridgeInitializationError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeCleanupError extends Schema.TaggedErrorClass<DesktopClerkBridgeCleanupError>()(
  "DesktopClerkBridgeCleanupError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean up the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}

export function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    return clerkFrontendApiHostnameFromPublishableKey(normalizedKey);
  } catch {
    return undefined;
  }
}

export const desktopClerkFrontendApiHostname = resolveDesktopClerkFrontendApiHostname(
  typeof __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? undefined
    : __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__,
);

export const desktopClerkBuildIsDevelopment =
  typeof __T3CODE_BUILD_IS_DEVELOPMENT__ === "undefined" ? false : __T3CODE_BUILD_IS_DEVELOPMENT__;

function makeDeferredTokenStorage(): {
  readonly adapter: TokenStorage;
  readonly setStorage: (storage: TokenStorage) => void;
} {
  let currentStorage: TokenStorage | undefined;
  let resolveStorage: ((storage: TokenStorage) => void) | undefined;
  const storageReady = new Promise<TokenStorage>((resolve) => {
    resolveStorage = resolve;
  });
  const getStorage = (): TokenStorage | Promise<TokenStorage> => currentStorage ?? storageReady;

  return {
    adapter: {
      getItem: async (key) => (await getStorage()).getItem(key),
      setItem: async (key, value) => (await getStorage()).setItem(key, value),
      removeItem: async (key) => (await getStorage()).removeItem(key),
    },
    setStorage: (nextStorage) => {
      if (currentStorage !== undefined) {
        throw new Error("Desktop Clerk token storage has already been initialized.");
      }
      currentStorage = nextStorage;
      resolveStorage?.(nextStorage);
      resolveStorage = undefined;
    },
  };
}

export function initializeDesktopClerkBridgeBeforeReady(
  isDevelopment: boolean,
): PreReadyDesktopClerkBridge {
  const deferredStorage = makeDeferredTokenStorage();

  try {
    return {
      bridge: createClerkBridge({
        storage: deferredStorage.adapter,
        passkeys: true,
        renderer: {
          scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
          host: ElectronProtocol.DESKTOP_HOST,
        },
      }),
      isDevelopment,
      setStorage: deferredStorage.setStorage,
    };
  } catch (cause) {
    throw new DesktopClerkPreReadyInitializationError({ isDevelopment, cause });
  }
}

export const make = (preReadyBridge: PreReadyDesktopClerkBridge) =>
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    yield* Effect.acquireRelease(Effect.succeed(preReadyBridge.bridge), (bridge) =>
      Effect.try({
        try: () => bridge.cleanup(),
        catch: (cause) =>
          new DesktopClerkBridgeCleanupError({
            stateDir: environment.stateDir,
            isDevelopment: environment.isDevelopment,
            cause,
          }),
      }).pipe(Effect.orDie),
    );

    yield* Effect.try({
      try: () => {
        if (preReadyBridge.isDevelopment !== environment.isDevelopment) {
          throw new Error(
            `Desktop Clerk build mode (${preReadyBridge.isDevelopment}) does not match the runtime mode (${environment.isDevelopment}).`,
          );
        }
        preReadyBridge.setStorage(storage({ path: environment.stateDir }));
      },
      catch: (cause) =>
        new DesktopClerkBridgeInitializationError({
          stateDir: environment.stateDir,
          isDevelopment: environment.isDevelopment,
          cause,
        }),
    });

    return DesktopClerk.of({
      configure: Effect.gen(function* () {
        const electronApp = yield* ElectronApp.ElectronApp;
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
        const runPromise = Effect.runPromiseWith(context);

        if (!(yield* electronApp.requestSingleInstanceLock)) {
          yield* electronApp.quit;
          return yield* Effect.interrupt;
        }

        yield* electronApp.on("second-instance", () => {
          void runPromise(
            Effect.gen(function* () {
              const mainWindow = yield* electronWindow.currentMainOrFirst;
              if (Option.isSome(mainWindow)) {
                yield* electronWindow.reveal(mainWindow.value);
              }
            }),
          );
        });
      }).pipe(Effect.withSpan("desktop.clerk.configure")),
    });
  });

export const layer = (preReadyBridge: PreReadyDesktopClerkBridge) =>
  Layer.effect(DesktopClerk, make(preReadyBridge));
