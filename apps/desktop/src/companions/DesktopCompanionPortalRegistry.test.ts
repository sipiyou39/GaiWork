import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Electron from "electron";

import {
  attachDesktopCompanionPortalWindow,
  authorizeDesktopCompanionPortalWindow,
  cancelDesktopCompanionPortal,
  registerDesktopCompanionPortal,
  resetDesktopCompanionPortalRegistry,
} from "./DesktopCompanionPortalRegistry.ts";

const portalUrl = "gaiwork://app/companion-portal.html?token=portal-token";
const frameName = "gaiwork-companion-blue-portal-token";
const fakeWindow = {} as Electron.BrowserWindow;

afterEach(() => resetDesktopCompanionPortalRegistry());

describe("desktop companion portal authorization", () => {
  it("allows only the exact one-time URL and frame name", () => {
    const onCreated = vi.fn();
    registerDesktopCompanionPortal({
      token: "portal-token",
      url: portalUrl,
      frameName,
      bounds: { x: 0, y: 0, width: 1_440, height: 900 },
      title: "GaiWork — Companion composer",
      onCreated,
    });

    expect(
      authorizeDesktopCompanionPortalWindow({
        url: "gaiwork://app/companion-portal.html?token=attacker",
        frameName,
      }),
    ).toBeNull();
    const authorization = authorizeDesktopCompanionPortalWindow({ url: portalUrl, frameName });
    expect(authorization?.token).toBe("portal-token");
    expect(authorizeDesktopCompanionPortalWindow({ url: portalUrl, frameName })).toBeNull();
    expect(authorization?.onCreated).toBe(onCreated);

    expect(
      attachDesktopCompanionPortalWindow({
        url: "gaiwork://app/companion-portal.html?token=portal-token",
        window: fakeWindow,
      }),
    ).toBe(true);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(attachDesktopCompanionPortalWindow({ url: portalUrl, window: fakeWindow })).toBe(false);
  });

  it("invalidates pending portal grants by their unguessable token", () => {
    registerDesktopCompanionPortal({
      token: "portal-token",
      url: portalUrl,
      frameName,
      bounds: { x: 0, y: 0, width: 1_440, height: 900 },
      title: "GaiWork — Companion composer",
      onCreated: vi.fn(),
    });

    cancelDesktopCompanionPortal("portal-token");

    expect(authorizeDesktopCompanionPortalWindow({ url: portalUrl, frameName })).toBeNull();
  });
});
