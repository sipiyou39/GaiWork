import {
  DEFAULT_SERVER_SETTINGS,
  type DesktopBridge,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { __resetLocalApiForTests } from "../localApi";
import {
  commitClientSettingsPatch,
  getClientSettings,
  mergeEnvironmentSettings,
} from "./useSettings";

function testWindow(): Window & typeof globalThis {
  if (globalThis.window === undefined) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
  }
  return globalThis.window;
}

async function usePersistenceBridge(input: {
  readonly getClientSettings: () => Promise<typeof DEFAULT_CLIENT_SETTINGS>;
  readonly setClientSettings: (settings: typeof DEFAULT_CLIENT_SETTINGS) => Promise<void>;
}): Promise<void> {
  await __resetLocalApiForTests();
  testWindow().desktopBridge = input as unknown as DesktopBridge;
}

afterEach(async () => {
  Reflect.deleteProperty(testWindow(), "desktopBridge");
  await __resetLocalApiForTests();
});

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });
});

describe("client settings persistence", () => {
  it("hydrates before committing a companion-era settings patch", async () => {
    let resolveHydration!: (settings: typeof DEFAULT_CLIENT_SETTINGS) => void;
    const hydration = new Promise<typeof DEFAULT_CLIENT_SETTINGS>((resolve) => {
      resolveHydration = resolve;
    });
    const setClientSettings = vi.fn().mockResolvedValue(undefined);
    await usePersistenceBridge({
      getClientSettings: () => hydration,
      setClientSettings,
    });

    const commit = commitClientSettingsPatch({ timestampFormat: "12-hour" });
    expect(setClientSettings).not.toHaveBeenCalled();
    resolveHydration({ ...DEFAULT_CLIENT_SETTINGS, sidebarThreadPreviewCount: 9 });
    await commit;

    expect(setClientSettings).toHaveBeenCalledWith({
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarThreadPreviewCount: 9,
      timestampFormat: "12-hour",
    });
  });

  it("serializes writes and restores the last persisted snapshot after a failure", async () => {
    let finishFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    const persistenceError = new Error("disk full");
    const setClientSettings = vi
      .fn()
      .mockImplementationOnce(() => firstWrite)
      .mockRejectedValueOnce(persistenceError);
    await usePersistenceBridge({
      getClientSettings: async () => DEFAULT_CLIENT_SETTINGS,
      setClientSettings,
    });

    const firstCommit = commitClientSettingsPatch({ timestampFormat: "12-hour" });
    await vi.waitFor(() => expect(setClientSettings).toHaveBeenCalledTimes(1));
    const secondCommit = commitClientSettingsPatch({ sidebarThreadPreviewCount: 9 });
    await Promise.resolve();
    expect(setClientSettings).toHaveBeenCalledTimes(1);

    finishFirstWrite();
    await firstCommit;
    await expect(secondCommit).rejects.toBe(persistenceError);
    expect(getClientSettings()).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "12-hour",
    });
  });
});
