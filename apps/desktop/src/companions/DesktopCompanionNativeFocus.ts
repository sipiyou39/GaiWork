export interface DesktopCompanionNativeApplication {
  readonly focus: (options?: { readonly steal: boolean }) => void;
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
  if (input.platform === "darwin") input.application.focus({ steal: true });
  input.window.focus();
  input.window.webContents.focus();
  return true;
}
