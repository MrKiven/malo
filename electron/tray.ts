/**
 * macOS 菜单栏状态图标
 *
 * 功能：
 * - 使用 Template Image 自动适配深色/浅色模式
 * - 菜单栏标题显示未读数
 * - 右键菜单展示最新未读文章（最多 8 条）
 * - 点击图标切换窗口显示/隐藏
 * - 支持动态刷新菜单内容
 */

import { Tray, Menu, nativeImage, app, BrowserWindow, shell } from "electron";
import { fetchAllFeeds } from "./fetcher";
import { localGet, syncGet } from "./storage";
import path from "path";
import { fileURLToPath } from "node:url";

const __electron_filename = fileURLToPath(import.meta.url);
const __electron_dirname = path.dirname(__electron_filename);

const MAX_MENU_ITEMS = 8;

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

/** 读取未读计数和最新文章 */
function getUnreadInfo(): { count: number; articles: { title: string; link: string }[] } {
  try {
    const { itemsByFeed: rawItems = {} } = localGet(["itemsByFeed"]);
    const { readItems: rawRead = [] } = localGet(["readItems"]);
    const { pausedFeeds: rawPaused = [] } = syncGet(["pausedFeeds"]);

    const itemsByFeed =
      rawItems && typeof rawItems === "object"
        ? (rawItems as Record<string, { link?: string; title?: string; publishedAt?: number }[]>)
        : {};
    const readSet = new Set(Array.isArray(rawRead) ? (rawRead as string[]) : []);
    const pausedSet = new Set(Array.isArray(rawPaused) ? (rawPaused as string[]) : []);

    let count = 0;
    const unread: { title: string; link: string; publishedAt: number }[] = [];

    for (const [feedUrl, items] of Object.entries(itemsByFeed)) {
      if (pausedSet.has(feedUrl)) continue;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (it.link && !readSet.has(it.link)) {
          count++;
          unread.push({
            title: it.title || "(无标题)",
            link: it.link,
            publishedAt: it.publishedAt || 0,
          });
        }
      }
    }

    // 按时间倒序，取最新的几条
    unread.sort((a, b) => b.publishedAt - a.publishedAt);
    const articles = unread.slice(0, MAX_MENU_ITEMS).map(({ title, link }) => ({
      title: title.length > 40 ? title.slice(0, 38) + "…" : title,
      link,
    }));

    return { count, articles };
  } catch {
    return { count: 0, articles: [] };
  }
}

/** 构建右键菜单 */
function buildContextMenu(): Menu {
  const { count, articles } = getUnreadInfo();
  const template: Electron.MenuItemConstructorOptions[] = [];

  // ── 未读概况 ──
  template.push({
    label: count > 0 ? `${count} 条未读文章` : "暂无未读文章",
    enabled: false,
  });

  template.push({ type: "separator" });

  // ── 最新文章列表 ──
  if (articles.length > 0) {
    for (const article of articles) {
      template.push({
        label: article.title,
        click: () => {
          shell.openExternal(article.link);
        },
      });
    }
    template.push({ type: "separator" });
  }

  // ── 操作按钮 ──
  template.push({
    label: "显示窗口",
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
  });

  template.push({
    label: "立即刷新",
    click: () => {
      fetchAllFeeds();
    },
  });

  template.push({ type: "separator" });

  template.push({
    label: "退出 Malo RSS",
    click: () => {
      app.quit();
    },
  });

  return Menu.buildFromTemplate(template);
}

/** 创建菜单栏图标 */
export function createTray(win: BrowserWindow): Tray {
  mainWindow = win;

  // 使用 Template Image，macOS 自动适配深色/浅色模式
  const iconPath = path.join(__electron_dirname, "..", "assets", "icons", "app", "trayTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("Malo RSS 订阅助手");

  // 初始菜单
  tray.setContextMenu(buildContextMenu());

  // 左键点击切换窗口显示/隐藏
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 初始刷新 title
  updateTrayStatus();

  return tray;
}

/** 更新 Tray 状态（未读数标题 + 菜单） */
export function updateTrayStatus(): void {
  if (!tray || tray.isDestroyed()) return;

  const { count } = getUnreadInfo();

  // 菜单栏标题：有未读时显示数字
  tray.setTitle(count > 0 ? ` ${count > 99 ? "99+" : count}` : "");

  // 刷新右键菜单
  tray.setContextMenu(buildContextMenu());
}

/** 销毁 Tray */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  mainWindow = null;
}
