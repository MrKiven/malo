/**
 * Electron 主进程入口
 *
 * 负责窗口管理、macOS 生命周期、后台抓取调度、菜单栏状态
 */

import { app, BrowserWindow, Menu } from "electron";
import path from "path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers, setMainWindow, notifyRenderer, updateBadge } from "./ipc-handlers";
import { startPeriodicFetch, setOnItemsUpdated } from "./fetcher";
import { createTray, destroyTray, updateTrayStatus } from "./tray";

const __electron_filename = fileURLToPath(import.meta.url);
const __electron_dirname = path.dirname(__electron_filename);

let mainWindow: BrowserWindow | null = null;
/** 是否真正退出（区分关闭窗口 vs 退出 app） */
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 628,
    minWidth: 420,
    minHeight: 500,
    maxWidth: 680,
    title: "Malo RSS 订阅助手",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 14 },
    webPreferences: {
      preload: path.join(__electron_dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setMainWindow(mainWindow);

  // 开发模式从 Vite dev server 加载，生产模式从本地文件加载
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL + "src/popup/index.html");
  } else {
    mainWindow.loadFile(path.join(__electron_dirname, "..", "dist", "src", "popup", "index.html"));
  }

  // 关闭窗口时隐藏到菜单栏，而非真正关闭
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── macOS 应用菜单 ──────────────────────────────

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  if (process.env.NODE_ENV === "development") {
    template.push({
      label: "开发",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App 生命周期 ────────────────────────────────

app.on("ready", () => {
  registerIpcHandlers();
  createAppMenu();
  createWindow();

  if (mainWindow) {
    createTray(mainWindow);
  }

  // 设置抓取完成回调：通知渲染进程 + 更新 badge + 更新菜单栏状态
  setOnItemsUpdated(() => {
    notifyRenderer("runtime:message", { type: "items-updated" });
    updateBadge();
    updateTrayStatus();
  });

  startPeriodicFetch();
});

// 窗口全部关闭时不退出，留在菜单栏
app.on("window-all-closed", () => {
  // macOS：不退出，保持菜单栏图标运行
  // 非 macOS：正常退出
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

// 标记真正退出（Cmd+Q 或菜单退出）
app.on("before-quit", () => {
  isQuitting = true;
  destroyTray();
});
