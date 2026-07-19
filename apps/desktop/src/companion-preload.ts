import type { DesktopCompanionWindowBridge } from "@t3tools/contracts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

contextBridge.exposeInMainWorld("companionBridge", {
  getInitialProjection: () => {
    const projection = ipcRenderer.sendSync(IpcChannels.COMPANION_GET_PROJECTION_CHANNEL);
    return typeof projection === "object" && projection !== null
      ? (projection as ReturnType<DesktopCompanionWindowBridge["getInitialProjection"]>)
      : null;
  },
  onProjection: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, projection: unknown) => {
      if (typeof projection !== "object" || projection === null) return;
      listener(projection as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.COMPANION_PROJECTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.COMPANION_PROJECTION_CHANNEL, wrappedListener);
    };
  },
  notifyReady: () => ipcRenderer.send(IpcChannels.COMPANION_READY_CHANNEL),
  setInteractive: (interactive) =>
    ipcRenderer.invoke(IpcChannels.COMPANION_SET_INTERACTIVE_CHANNEL, interactive),
  sendPointerEvent: (event) =>
    ipcRenderer.invoke(IpcChannels.COMPANION_POINTER_EVENT_CHANNEL, event),
} satisfies DesktopCompanionWindowBridge);
