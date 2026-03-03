/**
 * Electron IPC 消息处理
 *
 * 注册所有主进程 IPC handler，处理渲染进程的 storage / fetch / window 请求
 */

import { ipcMain, shell, BrowserWindow, app } from "electron";
import { syncGet, syncSet, localGet, localSet } from "./storage";
import { fetchAllFeeds } from "./fetcher";
import { updateTrayStatus } from "./tray";
import path from "path";
import { fileURLToPath } from "node:url";

const __electron_filename = fileURLToPath(import.meta.url);
const __electron_dirname = path.dirname(__electron_filename);

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function registerIpcHandlers(): void {
  // ── Storage ──────────────────────────────────────
  ipcMain.handle("storage:sync-get", (_event, keys: string[]) => {
    return syncGet(keys);
  });

  ipcMain.handle("storage:sync-set", (_event, data: Record<string, unknown>) => {
    syncSet(data);
  });

  ipcMain.handle("storage:local-get", (_event, keys: string[]) => {
    return localGet(keys);
  });

  ipcMain.handle("storage:local-set", (_event, data: Record<string, unknown>) => {
    localSet(data);
  });

  // ── Runtime messages ─────────────────────────────
  ipcMain.on("runtime:send-message", (_event, msg: unknown) => {
    if (msg && typeof msg === "object" && "type" in msg) {
      const m = msg as { type: string; link?: string };
      if (m.type === "fetch-now") {
        fetchAllFeeds();
      }
      if (m.type === "mark-read" && m.link) {
        const { readItems: rawRead = [] } = localGet(["readItems"]);
        const readSet = new Set(Array.isArray(rawRead) ? rawRead as string[] : []);
        readSet.add(m.link);
        localSet({ readItems: [...readSet] });
        updateBadge();
        updateTrayStatus();
      }
      if (m.type === "mark-all-read" || m.type === "update-badge") {
        updateBadge();
        updateTrayStatus();
      }
    }
  });

  // ── Open external URL ────────────────────────────
  ipcMain.on("open-external", (_event, url: string) => {
    if (url && typeof url === "string") {
      shell.openExternal(url);
    }
  });

  // ── Open AI Panel window ─────────────────────────
  ipcMain.on("open-ai-panel", (_event, url: string) => {
    const aiWin = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "AI 解读",
      webPreferences: {
        preload: path.join(__electron_dirname, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    aiWin.loadURL(url);
  });
}

// ── 通知渲染进程 ──────────────────────────────────

export function notifyRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Badge 更新 ────────────────────────────────────

export function updateBadge(): void {
  try {
    const { itemsByFeed: rawItems = {} } = localGet(["itemsByFeed"]);
    const { readItems: rawRead = [] } = localGet(["readItems"]);
    const { pausedFeeds: rawPaused = [] } = syncGet(["pausedFeeds"]);

    const itemsByFeed = (rawItems && typeof rawItems === "object") ? rawItems as Record<string, { link?: string; feedUrl?: string }[]> : {};
    const readSet = new Set(Array.isArray(rawRead) ? rawRead as string[] : []);
    const pausedSet = new Set(Array.isArray(rawPaused) ? rawPaused as string[] : []);

    let count = 0;
    for (const [feedUrl, items] of Object.entries(itemsByFeed)) {
      if (pausedSet.has(feedUrl)) continue;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (it.link && !readSet.has(it.link)) count++;
      }
    }

    if (process.platform === "darwin" && app.dock) {
      app.dock.setBadge(count > 0 ? (count > 99 ? "99+" : String(count)) : "");
    }
  } catch {
    // badge API 可能不可用
  }
}
