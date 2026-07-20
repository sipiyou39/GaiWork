import type {
  DesktopBridge,
  DesktopPreviewPointerEvent,
  DesktopPreviewRecordingFrame,
  DesktopPreviewTabState,
} from "@t3tools/contracts";
import { exposeClerkBridge } from "@clerk/electron/preload";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

exposeClerkBridge({ passkeys: true });

type CompanionNavigateListener = Parameters<
  NonNullable<NonNullable<DesktopBridge["companions"]>["onNavigateThread"]>
>[0];
type CompanionAcknowledgeListener = Parameters<
  NonNullable<NonNullable<DesktopBridge["companions"]>["onAcknowledgeThread"]>
>[0];
type CompanionOpenComposerListener = Parameters<
  NonNullable<NonNullable<DesktopBridge["companions"]>["onOpenComposer"]>
>[0];
type CompanionPortalLayoutListener = Parameters<
  NonNullable<NonNullable<DesktopBridge["companions"]>["onPortalLayout"]>
>[0];
type CompanionCloseComposerListener = Parameters<
  NonNullable<NonNullable<DesktopBridge["companions"]>["onCloseComposer"]>
>[0];

const companionNavigateListeners = new Set<CompanionNavigateListener>();
let pendingCompanionNavigation: Parameters<CompanionNavigateListener>[0] | null = null;
const companionAcknowledgeListeners = new Set<CompanionAcknowledgeListener>();
const pendingCompanionAcknowledgements: Array<Parameters<CompanionAcknowledgeListener>[0]> = [];
const companionOpenComposerListeners = new Set<CompanionOpenComposerListener>();
let pendingCompanionOpenComposer: Parameters<CompanionOpenComposerListener>[0] | null = null;
const companionPortalLayoutListeners = new Set<CompanionPortalLayoutListener>();
let pendingCompanionPortalLayout: Parameters<CompanionPortalLayoutListener>[0] | null = null;
const companionCloseComposerListeners = new Set<CompanionCloseComposerListener>();
const pendingCompanionPortalCloses: Array<Parameters<CompanionCloseComposerListener>[0]> = [];

// Register during preload so navigation sent immediately after a recreated
// renderer finishes loading cannot be lost before React mounts its listener.
ipcRenderer.on(IpcChannels.COMPANION_NAVIGATE_THREAD_CHANNEL, (_event, threadRef: unknown) => {
  if (typeof threadRef !== "object" || threadRef === null) return;
  const target = threadRef as Parameters<CompanionNavigateListener>[0];
  if (companionNavigateListeners.size === 0) {
    pendingCompanionNavigation = target;
    return;
  }
  for (const listener of companionNavigateListeners) listener(target);
});

ipcRenderer.on(IpcChannels.COMPANION_ACKNOWLEDGE_THREAD_CHANNEL, (_event, threadRef: unknown) => {
  if (typeof threadRef !== "object" || threadRef === null) return;
  const target = threadRef as Parameters<CompanionAcknowledgeListener>[0];
  if (companionAcknowledgeListeners.size === 0) {
    pendingCompanionAcknowledgements.push(target);
    return;
  }
  for (const listener of companionAcknowledgeListeners) listener(target);
});

ipcRenderer.on(IpcChannels.COMPANION_OPEN_COMPOSER_CHANNEL, (_event, request: unknown) => {
  if (typeof request !== "object" || request === null) return;
  const target = request as Parameters<CompanionOpenComposerListener>[0];
  if (companionOpenComposerListeners.size === 0) {
    pendingCompanionOpenComposer = target;
    return;
  }
  for (const listener of companionOpenComposerListeners) listener(target);
});

ipcRenderer.on(IpcChannels.COMPANION_PORTAL_LAYOUT_CHANNEL, (_event, layout: unknown) => {
  if (typeof layout !== "object" || layout === null) return;
  const target = layout as Parameters<CompanionPortalLayoutListener>[0];
  if (companionPortalLayoutListeners.size === 0) {
    pendingCompanionPortalLayout = target;
    return;
  }
  for (const listener of companionPortalLayoutListeners) listener(target);
});

ipcRenderer.on(IpcChannels.COMPANION_CLOSE_COMPOSER_CHANNEL, (_event, input: unknown) => {
  if (typeof input !== "object" || input === null) return;
  const target = input as Parameters<CompanionCloseComposerListener>[0];
  if (companionCloseComposerListeners.size === 0) {
    pendingCompanionPortalCloses.push(target);
    return;
  }
  for (const listener of companionCloseComposerListeners) listener(target);
});

function unwrapEnsureSshEnvironmentResult(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    result.type === IpcChannels.SSH_PASSWORD_PROMPT_CANCELLED_RESULT
  ) {
    const message =
      "message" in result && typeof result.message === "string"
        ? result.message
        : "SSH authentication cancelled.";
    throw new Error(message);
  }
  return result as Awaited<ReturnType<DesktopBridge["ensureSshEnvironment"]>>;
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getLocalEnvironmentBootstraps: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
    if (!Array.isArray(result)) {
      return [];
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstraps"]>;
  },
  getLocalEnvironmentBearerToken: () =>
    ipcRenderer.invoke(IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),
  getConnectionCatalog: () => ipcRenderer.invoke(IpcChannels.GET_CONNECTION_CATALOG_CHANNEL),
  setConnectionCatalog: (catalog) =>
    ipcRenderer.invoke(IpcChannels.SET_CONNECTION_CATALOG_CHANNEL, catalog),
  clearConnectionCatalog: () => ipcRenderer.invoke(IpcChannels.CLEAR_CONNECTION_CATALOG_CHANNEL),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL),
  ensureSshEnvironment: async (target, options) =>
    unwrapEnsureSshEnvironmentResult(
      await ipcRenderer.invoke(IpcChannels.ENSURE_SSH_ENVIRONMENT_CHANNEL, {
        target,
        ...(options === undefined ? {} : { options }),
      }),
    ),
  disconnectSshEnvironment: (target) =>
    ipcRenderer.invoke(IpcChannels.DISCONNECT_SSH_ENVIRONMENT_CHANNEL, target),
  fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL, { httpBaseUrl }),
  bootstrapSshBearerSession: (httpBaseUrl, credential) =>
    ipcRenderer.invoke(IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL, {
      httpBaseUrl,
      credential,
    }),
  fetchSshSessionState: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL, { httpBaseUrl, bearerToken }),
  issueSshWebSocketTicket: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL, { httpBaseUrl, bearerToken }),
  onSshPasswordPrompt: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (typeof request !== "object" || request === null) return;
      listener(request as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    };
  },
  resolveSshPasswordPrompt: (requestId, password) =>
    ipcRenderer.invoke(IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, { requestId, password }),
  getServerExposureState: () => ipcRenderer.invoke(IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  setTailscaleServeEnabled: (input) =>
    ipcRenderer.invoke(IpcChannels.SET_TAILSCALE_SERVE_ENABLED_CHANNEL, input),
  getAdvertisedEndpoints: () => ipcRenderer.invoke(IpcChannels.GET_ADVERTISED_ENDPOINTS_CHANNEL),
  getWslState: () => ipcRenderer.invoke(IpcChannels.GET_WSL_STATE_CHANNEL),
  setWslBackendEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannels.SET_WSL_BACKEND_ENABLED_CHANNEL, enabled),
  setWslDistro: (distro) => ipcRenderer.invoke(IpcChannels.SET_WSL_DISTRO_CHANNEL, distro),
  setWslOnly: (enabled) => ipcRenderer.invoke(IpcChannels.SET_WSL_ONLY_CHANNEL, enabled),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(IpcChannels.CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getWindowFullscreenState: () =>
    ipcRenderer.sendSync(IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL) === true,
  onWindowFullscreenStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => {
      if (typeof fullscreen !== "boolean") return;
      listener(fullscreen);
    };

    ipcRenderer.on(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    };
  },
  getMainWindowAttentionState: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_MAIN_WINDOW_ATTENTION_STATE_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return { visible: true, focused: true, minimized: false };
    }
    return result as ReturnType<NonNullable<DesktopBridge["getMainWindowAttentionState"]>>;
  },
  onMainWindowAttentionStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.MAIN_WINDOW_ATTENTION_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MAIN_WINDOW_ATTENTION_STATE_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  companions: {
    syncProjection: (snapshot) =>
      ipcRenderer.invoke(IpcChannels.COMPANION_SYNC_PROJECTION_CHANNEL, snapshot),
    resetPositions: () => ipcRenderer.invoke(IpcChannels.COMPANION_RESET_POSITIONS_CHANNEL),
    onNavigateThread: (listener) => {
      companionNavigateListeners.add(listener);
      const pending = pendingCompanionNavigation;
      pendingCompanionNavigation = null;
      if (pending) {
        queueMicrotask(() => {
          if (companionNavigateListeners.has(listener)) listener(pending);
        });
      }
      return () => {
        companionNavigateListeners.delete(listener);
      };
    },
    onAcknowledgeThread: (listener) => {
      companionAcknowledgeListeners.add(listener);
      const pending = pendingCompanionAcknowledgements.splice(0);
      if (pending.length > 0) {
        queueMicrotask(() => {
          if (!companionAcknowledgeListeners.has(listener)) return;
          for (const threadRef of pending) listener(threadRef);
        });
      }
      return () => {
        companionAcknowledgeListeners.delete(listener);
      };
    },
    onOpenComposer: (listener) => {
      companionOpenComposerListeners.add(listener);
      if (pendingCompanionOpenComposer !== null) {
        const pending = pendingCompanionOpenComposer;
        pendingCompanionOpenComposer = null;
        listener(pending);
      }
      return () => {
        companionOpenComposerListeners.delete(listener);
      };
    },
    onPortalLayout: (listener) => {
      companionPortalLayoutListeners.add(listener);
      if (pendingCompanionPortalLayout !== null) {
        const pending = pendingCompanionPortalLayout;
        pendingCompanionPortalLayout = null;
        listener(pending);
      }
      return () => {
        companionPortalLayoutListeners.delete(listener);
      };
    },
    onCloseComposer: (listener) => {
      companionCloseComposerListeners.add(listener);
      for (const pending of pendingCompanionPortalCloses.splice(0)) listener(pending);
      return () => {
        companionCloseComposerListeners.delete(listener);
      };
    },
    portalReady: (input) => ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_READY_CHANNEL, input),
    portalClosing: (input) =>
      ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_CLOSING_CHANNEL, input),
    reportCardMetrics: (input) =>
      ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_METRICS_CHANNEL, input),
    setPortalInteractive: (input) =>
      ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_INTERACTIVE_CHANNEL, input),
    focusPortal: (input) => ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_FOCUS_CHANNEL, input),
    closeComposer: (input) => ipcRenderer.invoke(IpcChannels.COMPANION_PORTAL_CLOSE_CHANNEL, input),
  },
  preview: {
    createTab: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_CREATE_TAB_CHANNEL, { tabId }),
    closeTab: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_CLOSE_TAB_CHANNEL, { tabId }),
    registerWebview: (tabId, webContentsId) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_REGISTER_WEBVIEW_CHANNEL, { tabId, webContentsId }),
    navigate: (tabId, url) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_NAVIGATE_CHANNEL, { tabId, url }),
    goBack: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_GO_BACK_CHANNEL, { tabId }),
    goForward: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_GO_FORWARD_CHANNEL, { tabId }),
    refresh: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_REFRESH_CHANNEL, { tabId }),
    zoomIn: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_ZOOM_IN_CHANNEL, { tabId }),
    zoomOut: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_ZOOM_OUT_CHANNEL, { tabId }),
    resetZoom: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_RESET_ZOOM_CHANNEL, { tabId }),
    hardReload: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_HARD_RELOAD_CHANNEL, { tabId }),
    openDevTools: (tabId) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_OPEN_DEVTOOLS_CHANNEL, { tabId }),
    clearCookies: () => ipcRenderer.invoke(IpcChannels.PREVIEW_CLEAR_COOKIES_CHANNEL),
    clearCache: () => ipcRenderer.invoke(IpcChannels.PREVIEW_CLEAR_CACHE_CHANNEL),
    getPreviewConfig: (environmentId) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_GET_CONFIG_CHANNEL, { environmentId }),
    setAnnotationTheme: (theme) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_SET_ANNOTATION_THEME_CHANNEL, { theme }),
    pickElement: (tabId) => ipcRenderer.invoke(IpcChannels.PREVIEW_PICK_ELEMENT_CHANNEL, { tabId }),
    cancelPickElement: (tabId) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_CANCEL_PICK_ELEMENT_CHANNEL, { tabId }),
    captureScreenshot: (tabId) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_CAPTURE_SCREENSHOT_CHANNEL, { tabId }),
    revealArtifact: (path) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_REVEAL_ARTIFACT_CHANNEL, { path }),
    copyArtifactToClipboard: (path) =>
      ipcRenderer.invoke(IpcChannels.PREVIEW_COPY_ARTIFACT_CHANNEL, { path }),
    recording: {
      startScreencast: (tabId) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_RECORDING_START_CHANNEL, { tabId }),
      stopScreencast: (tabId) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_RECORDING_STOP_CHANNEL, { tabId }),
      save: (tabId, mimeType, data) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_RECORDING_SAVE_CHANNEL, {
          tabId,
          mimeType,
          data,
        }),
      onFrame: (listener) => {
        const wrappedListener = (_event: Electron.IpcRendererEvent, frame: unknown) => {
          if (typeof frame !== "object" || frame === null) return;
          listener(frame as DesktopPreviewRecordingFrame);
        };
        ipcRenderer.on(IpcChannels.PREVIEW_RECORDING_FRAME_CHANNEL, wrappedListener);
        return () =>
          ipcRenderer.removeListener(IpcChannels.PREVIEW_RECORDING_FRAME_CHANNEL, wrappedListener);
      },
    },
    automation: {
      status: (tabId) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_STATUS_CHANNEL, { tabId }),
      snapshot: (tabId) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_SNAPSHOT_CHANNEL, { tabId }),
      click: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_CLICK_CHANNEL, { tabId, input }),
      type: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_TYPE_CHANNEL, { tabId, input }),
      press: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_PRESS_CHANNEL, { tabId, input }),
      scroll: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_SCROLL_CHANNEL, { tabId, input }),
      evaluate: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_EVALUATE_CHANNEL, { tabId, input }),
      waitFor: (tabId, input) =>
        ipcRenderer.invoke(IpcChannels.PREVIEW_AUTOMATION_WAIT_FOR_CHANNEL, { tabId, input }),
    },
    onStateChange: (listener) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        tabId: unknown,
        state: unknown,
      ) => {
        if (typeof tabId !== "string" || typeof state !== "object" || state === null) return;
        listener(tabId, state as DesktopPreviewTabState);
      };
      ipcRenderer.on(IpcChannels.PREVIEW_STATE_CHANGE_CHANNEL, wrappedListener);
      return () =>
        ipcRenderer.removeListener(IpcChannels.PREVIEW_STATE_CHANGE_CHANNEL, wrappedListener);
    },
    onPointerEvent: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, pointerEvent: unknown) => {
        if (typeof pointerEvent !== "object" || pointerEvent === null) return;
        listener(pointerEvent as DesktopPreviewPointerEvent);
      };
      ipcRenderer.on(IpcChannels.PREVIEW_POINTER_EVENT_CHANNEL, wrappedListener);
      return () =>
        ipcRenderer.removeListener(IpcChannels.PREVIEW_POINTER_EVENT_CHANNEL, wrappedListener);
    },
  },
} satisfies DesktopBridge);
