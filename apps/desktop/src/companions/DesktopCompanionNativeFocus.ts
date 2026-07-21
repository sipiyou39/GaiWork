export interface DesktopCompanionNativeApplication {
  readonly focus: (options?: { readonly steal: boolean }) => void;
}

export interface DesktopCompanionNativeApplicationVisibility {
  readonly hide: () => void;
}

export interface DesktopCompanionNativeFocusWindow {
  readonly webContents: {
    readonly focus: () => void;
  };
  readonly isDestroyed: () => boolean;
  readonly isVisible: () => boolean;
  readonly setFocusable: (focusable: boolean) => void;
  readonly show: () => void;
  readonly focus: () => void;
}

export interface DesktopCompanionNativeMainWindow {
  readonly hide: () => void;
  readonly isDestroyed: () => boolean;
  readonly isMinimized: () => boolean;
  readonly isVisible: () => boolean;
}

export interface DesktopCompanionNativePassiveWindow {
  readonly isDestroyed: () => boolean;
  readonly showInactive: () => void;
}

export interface DesktopCompanionDevTools {
  readonly closeDevTools: () => void;
  readonly isDevToolsOpened: () => boolean;
  readonly openDevTools: (options?: { readonly mode: "detach" }) => void;
}

export interface DesktopCompanionNativeFocusOrigin {
  readonly restoreExternalApplication: boolean;
}

export function captureDesktopCompanionNativeFocusOrigin(input: {
  readonly application: { readonly isFocused: () => boolean };
  readonly platform: NodeJS.Platform;
}): DesktopCompanionNativeFocusOrigin {
  return {
    restoreExternalApplication: input.platform === "darwin" && !input.application.isFocused(),
  };
}

/** Keeps the main Doudou Code window out of the foreground while its desktop composer owns focus. */
export function prepareDesktopCompanionPortalFocus(input: {
  readonly mainWindow: Pick<
    DesktopCompanionNativeMainWindow,
    "hide" | "isDestroyed" | "isMinimized" | "isVisible"
  >;
  readonly origin: DesktopCompanionNativeFocusOrigin;
}): void {
  if (
    !input.origin.restoreExternalApplication ||
    input.mainWindow.isDestroyed() ||
    !input.mainWindow.isVisible() ||
    input.mainWindow.isMinimized()
  ) {
    return;
  }
  input.mainWindow.hide();
}

/**
 * Deactivates Doudou Code after a desktop reply and brings back only its passive
 * companion overlays. The main window deliberately stays hidden: revealing it
 * is reserved for an explicit companion or Dock click.
 *
 * Do not call `app.show()` here. On macOS that unhides every application
 * window, including the main window and detached DevTools.
 */
export function restoreDesktopCompanionPortalFocus(input: {
  readonly application: DesktopCompanionNativeApplicationVisibility;
  readonly origin: DesktopCompanionNativeFocusOrigin;
  readonly overlays: readonly DesktopCompanionNativePassiveWindow[];
  readonly platform: NodeJS.Platform;
  readonly schedule: (restore: () => void) => void;
}): boolean {
  if (input.platform !== "darwin" || !input.origin.restoreExternalApplication) return false;

  input.application.hide();
  input.schedule(() => {
    for (const overlay of input.overlays) {
      if (!overlay.isDestroyed()) overlay.showInactive();
    }
  });
  return true;
}

/**
 * Detached DevTools are application windows on macOS. If they stay open while
 * the companion portal owns native focus, AppKit can promote them when that
 * portal closes. Suspend them before activating the portal and restore them
 * only after the real main window receives explicit focus again.
 */
export function suspendDesktopCompanionDevTools(input: {
  readonly devTools: Pick<DesktopCompanionDevTools, "closeDevTools" | "isDevToolsOpened">;
  readonly shouldSuspend: boolean;
}): boolean {
  if (!input.shouldSuspend || !input.devTools.isDevToolsOpened()) return false;
  input.devTools.closeDevTools();
  return true;
}

export function restoreDesktopCompanionDevTools(input: {
  readonly devTools: Pick<DesktopCompanionDevTools, "isDevToolsOpened" | "openDevTools">;
  readonly mainWindowFocused: boolean;
  readonly restorePending: boolean;
}): boolean {
  if (!input.restorePending || !input.mainWindowFocused) return false;
  if (!input.devTools.isDevToolsOpened()) input.devTools.openDevTools({ mode: "detach" });
  return true;
}

/**
 * Makes the companion composer the native macOS Accessibility target.
 *
 * A focusable `NSPanel` can receive regular key events without activating its
 * owning application. That is useful for passive overlays, but dictation tools
 * resolve their destination through `AXFocusedApplication` and would keep using
 * the previously active app. Explicit application activation must therefore
 * happen before focusing the panel and its renderer.
 */
export function focusDesktopCompanionPortalWindow(input: {
  readonly application: DesktopCompanionNativeApplication;
  readonly window: DesktopCompanionNativeFocusWindow;
  readonly platform: NodeJS.Platform;
}): boolean {
  if (input.window.isDestroyed()) return false;

  input.window.setFocusable(true);
  if (!input.window.isVisible()) input.window.show();
  // `BrowserWindow.isFocused()` only reports that the NSPanel is key. A
  // non-activating panel can be key while another process remains the macOS
  // AXFocusedApplication, so activation must never be skipped on that basis.
  if (input.platform === "darwin") {
    input.application.focus({ steal: true });
  }
  input.window.focus();
  input.window.webContents.focus();
  return true;
}
