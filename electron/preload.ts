/**
 * Electron Preload 脚本
 *
 * 通过 contextBridge 安全地暴露 IPC 桥接 API 到渲染进程
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  storage: {
    syncGet: (keys: string[]) => ipcRenderer.invoke("storage:sync-get", keys),
    syncSet: (data: Record<string, unknown>) => ipcRenderer.invoke("storage:sync-set", data),
    localGet: (keys: string[]) => ipcRenderer.invoke("storage:local-get", keys),
    localSet: (data: Record<string, unknown>) => ipcRenderer.invoke("storage:local-set", data),
  },

  sendMessage: (msg: unknown) => ipcRenderer.send("runtime:send-message", msg),

  onMessage: (handler: (msg: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: unknown) => handler(msg);
    ipcRenderer.on("runtime:message", listener);
    return () => {
      ipcRenderer.removeListener("runtime:message", listener);
    };
  },

  openExternal: (url: string) => ipcRenderer.send("open-external", url),

  openAIPanel: (url: string) => ipcRenderer.send("open-ai-panel", url),
});
