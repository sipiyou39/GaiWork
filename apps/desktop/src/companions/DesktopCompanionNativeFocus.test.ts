import { assert, describe, it } from "@effect/vitest";

import {
  captureDesktopCompanionNativeFocusOrigin,
  focusDesktopCompanionPortalWindow,
  prepareDesktopCompanionPortalFocus,
  restoreDesktopCompanionDevTools,
  restoreDesktopCompanionPortalFocus,
  suspendDesktopCompanionDevTools,
} from "./DesktopCompanionNativeFocus.ts";

function nativeFocusFixture(input?: { readonly destroyed?: boolean; readonly visible?: boolean }) {
  const calls: string[] = [];
  const application = {
    focus: (options?: { readonly steal: boolean }) => {
      calls.push(`application:${String(options?.steal)}`);
    },
    hide: () => calls.push("application-hide"),
    isFocused: () => false,
    show: () => calls.push("application-show"),
  };
  const window = {
    webContents: {
      focus: () => calls.push("web-contents"),
    },
    isDestroyed: () => input?.destroyed ?? false,
    isVisible: () => input?.visible ?? false,
    setFocusable: (focusable: boolean) => calls.push(`focusable:${String(focusable)}`),
    show: () => calls.push("show"),
    focus: () => calls.push("window"),
  };
  return { application, calls, window };
}

function mainWindowFixture(input?: {
  readonly destroyed?: boolean;
  readonly minimized?: boolean;
  readonly visible?: boolean;
}) {
  const calls: string[] = [];
  const window = {
    hide: () => calls.push("main-hide"),
    isDestroyed: () => input?.destroyed ?? false,
    isMinimized: () => input?.minimized ?? false,
    isVisible: () => input?.visible ?? true,
    minimize: () => calls.push("main-minimize"),
    showInactive: () => calls.push("main-show-inactive"),
  };
  return { calls, window };
}

describe("desktop companion native focus", () => {
  it("activates the macOS application before focusing the composer", () => {
    const fixture = nativeFocusFixture();

    assert.isTrue(
      focusDesktopCompanionPortalWindow({
        ...fixture,
        platform: "darwin",
      }),
    );
    assert.deepEqual(fixture.calls, [
      "focusable:true",
      "show",
      "application:true",
      "window",
      "web-contents",
    ]);
  });

  it("does not reactivate the application on other platforms", () => {
    const fixture = nativeFocusFixture({ visible: true });

    assert.isTrue(
      focusDesktopCompanionPortalWindow({
        ...fixture,
        platform: "win32",
      }),
    );
    assert.deepEqual(fixture.calls, ["focusable:true", "window", "web-contents"]);
  });

  it("ignores a portal window that has already been destroyed", () => {
    const fixture = nativeFocusFixture({ destroyed: true });

    assert.isFalse(
      focusDesktopCompanionPortalWindow({
        ...fixture,
        platform: "darwin",
      }),
    );
    assert.deepEqual(fixture.calls, []);
  });

  it("reasserts macOS application activation on every native portal focus request", () => {
    const fixture = nativeFocusFixture({ visible: true });

    assert.isTrue(
      focusDesktopCompanionPortalWindow({
        ...fixture,
        platform: "darwin",
      }),
    );
    assert.isTrue(
      focusDesktopCompanionPortalWindow({
        ...fixture,
        platform: "darwin",
      }),
    );
    assert.deepEqual(fixture.calls, [
      "focusable:true",
      "application:true",
      "window",
      "web-contents",
      "focusable:true",
      "application:true",
      "window",
      "web-contents",
    ]);
  });

  it("captures and temporarily hides a background main window on macOS", () => {
    const fixture = nativeFocusFixture();
    const main = mainWindowFixture();
    const origin = captureDesktopCompanionNativeFocusOrigin({
      application: fixture.application,
      platform: "darwin",
    });

    assert.deepEqual(origin, { restoreExternalApplication: true });
    prepareDesktopCompanionPortalFocus({ mainWindow: main.window, origin });
    assert.deepEqual(main.calls, ["main-hide"]);
  });

  it("does not hide the main window when Doudou Code already owns focus", () => {
    const main = mainWindowFixture();
    const origin = captureDesktopCompanionNativeFocusOrigin({
      application: { isFocused: () => true },
      platform: "darwin",
    });

    prepareDesktopCompanionPortalFocus({ mainWindow: main.window, origin });
    assert.isFalse(origin.restoreExternalApplication);
    assert.deepEqual(main.calls, []);
  });

  it("restores the external app and only re-shows passive companion overlays", () => {
    const fixture = nativeFocusFixture();
    const overlayCalls: string[] = [];
    const scheduled: Array<() => void> = [];
    const restored = restoreDesktopCompanionPortalFocus({
      application: fixture.application,
      origin: { restoreExternalApplication: true },
      overlays: [
        {
          isDestroyed: () => false,
          showInactive: () => overlayCalls.push("overlay-show-inactive"),
        },
      ],
      platform: "darwin",
      schedule: (restore) => scheduled.push(restore),
    });

    assert.isTrue(restored);
    assert.deepEqual(fixture.calls, ["application-hide"]);
    assert.lengthOf(scheduled, 1);
    scheduled[0]?.();
    assert.deepEqual(fixture.calls, ["application-hide"]);
    assert.deepEqual(overlayCalls, ["overlay-show-inactive"]);
  });

  it("does not reveal a Doudou Code window when there are no companion overlays", () => {
    const fixture = nativeFocusFixture();
    const scheduled: Array<() => void> = [];
    restoreDesktopCompanionPortalFocus({
      application: fixture.application,
      origin: { restoreExternalApplication: true },
      overlays: [],
      platform: "darwin",
      schedule: (restore) => scheduled.push(restore),
    });

    scheduled[0]?.();
    assert.deepEqual(fixture.calls, ["application-hide"]);
  });

  it("suspends detached DevTools before a background companion portal takes focus", () => {
    const calls: string[] = [];
    const suspended = suspendDesktopCompanionDevTools({
      devTools: {
        closeDevTools: () => calls.push("close"),
        isDevToolsOpened: () => true,
      },
      shouldSuspend: true,
    });

    assert.isTrue(suspended);
    assert.deepEqual(calls, ["close"]);
  });

  it("does not suspend DevTools when the companion does not take application focus", () => {
    const calls: string[] = [];
    const suspended = suspendDesktopCompanionDevTools({
      devTools: {
        closeDevTools: () => calls.push("close"),
        isDevToolsOpened: () => true,
      },
      shouldSuspend: false,
    });

    assert.isFalse(suspended);
    assert.deepEqual(calls, []);
  });

  it("restores suspended DevTools only after the real main window receives focus", () => {
    const calls: string[] = [];
    const devTools = {
      isDevToolsOpened: () => false,
      openDevTools: (options?: { readonly mode: "detach" }) =>
        calls.push(`open:${String(options?.mode)}`),
    };

    assert.isFalse(
      restoreDesktopCompanionDevTools({
        devTools,
        mainWindowFocused: false,
        restorePending: true,
      }),
    );
    assert.deepEqual(calls, []);

    assert.isTrue(
      restoreDesktopCompanionDevTools({
        devTools,
        mainWindowFocused: true,
        restorePending: true,
      }),
    );
    assert.deepEqual(calls, ["open:detach"]);
  });
});
