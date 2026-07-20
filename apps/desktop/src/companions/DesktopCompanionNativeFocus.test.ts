import { assert, describe, it } from "@effect/vitest";

import { focusDesktopCompanionPortalWindow } from "./DesktopCompanionNativeFocus.ts";

function nativeFocusFixture(input?: { readonly destroyed?: boolean; readonly visible?: boolean }) {
  const calls: string[] = [];
  const application = {
    focus: (options?: { readonly steal: boolean }) => {
      calls.push(`application:${String(options?.steal)}`);
    },
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
});
