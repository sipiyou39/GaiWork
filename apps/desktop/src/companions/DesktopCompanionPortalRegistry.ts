import type * as Electron from "electron";

export interface DesktopCompanionPortalAuthorization {
  readonly token: string;
  readonly url: string;
  readonly frameName: string;
  readonly bounds: Electron.Rectangle;
  readonly title: string;
  readonly onCreated: (window: Electron.BrowserWindow) => void;
}

const pendingByFrameName = new Map<string, DesktopCompanionPortalAuthorization>();
const authorizedByToken = new Map<string, DesktopCompanionPortalAuthorization>();

function portalTokenFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("token");
  } catch {
    return null;
  }
}

export function registerDesktopCompanionPortal(
  authorization: DesktopCompanionPortalAuthorization,
): void {
  pendingByFrameName.set(authorization.frameName, authorization);
}

export function authorizeDesktopCompanionPortalWindow(input: {
  readonly url: string;
  readonly frameName: string;
}): DesktopCompanionPortalAuthorization | null {
  const authorization = pendingByFrameName.get(input.frameName);
  if (!authorization || authorization.url !== input.url) return null;
  pendingByFrameName.delete(input.frameName);
  authorizedByToken.set(authorization.token, authorization);
  return authorization;
}

/**
 * Attach the native child created by Electron after its exact one-time grant
 * was consumed in `setWindowOpenHandler`.
 *
 * Electron has already validated both the URL and frame name at this point.
 * On macOS, however, `did-create-window` can report an empty or rewritten
 * frame name. The unguessable token embedded in the already-authorized URL is
 * therefore the stable correlation key for this second event.
 */
export function attachDesktopCompanionPortalWindow(input: {
  readonly url: string;
  readonly window: Electron.BrowserWindow;
}): boolean {
  const token = portalTokenFromUrl(input.url);
  if (!token) return false;
  const authorization = authorizedByToken.get(token);
  if (!authorization || portalTokenFromUrl(authorization.url) !== token) return false;
  authorizedByToken.delete(token);
  authorization.onCreated(input.window);
  return true;
}

export function cancelDesktopCompanionPortal(token: string): void {
  for (const [frameName, authorization] of pendingByFrameName) {
    if (authorization.token === token) pendingByFrameName.delete(frameName);
  }
  authorizedByToken.delete(token);
}

export function resetDesktopCompanionPortalRegistry(): void {
  pendingByFrameName.clear();
  authorizedByToken.clear();
}
