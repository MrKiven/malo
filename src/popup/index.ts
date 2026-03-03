/**
 * Popup 入口文件
 *
 * 负责初始化各 UI 模块并协调它们之间的交互
 */

import { initTheme } from "./theme";
import { initTabs, onTabActivate } from "./tabs";
import { initFeeds, refreshFeeds, onFeedChanged as setFeedChangedCallback } from "./feeds";
import { initArticles, refreshItems, isRefreshing } from "./articles";
import { initAISettings } from "./ai-settings";
import { initSync } from "./sync";
import { detectCurrentPage, initDiscover, onFeedChanged as setDetectFeedChangedCallback } from "./detect";
import { platform } from "../platform";

// ── 初始化 ────────────────────────────────────────

init();

function init(): void {
  if (platform.isElectron) {
    document.documentElement.setAttribute("data-platform", "electron");
  }

  // 初始化各 UI 模块
  initTabs();
  initFeeds();
  initArticles();
  initTheme();
  initAISettings();
  initSync();
  initDiscover();

  // 设置模块间回调：订阅源变更时刷新文章列表
  const onFeedChanged = () => refreshItems();
  setFeedChangedCallback(onFeedChanged);
  setDetectFeedChangedCallback(onFeedChanged);

  // Tab 切换回调：切到「发现」时检测当前页面（仅 Chrome 扩展环境）
  if (!platform.isElectron) {
    onTabActivate("discover", () => detectCurrentPage());
  }

  // 加载数据
  refreshFeeds();
  refreshItems();

  // 发现功能仅在 Chrome 扩展环境下可用
  if (!platform.isElectron) {
    detectCurrentPage();
  }
}

// ── 消息监听 ─────────────────────────────────────

platform.runtime.onMessage((msg) => {
  if (msg && typeof msg === "object" && "type" in msg) {
    const m = msg as { type: string };
    if (m.type === "items-updated" && !isRefreshing()) {
      refreshItems();
    }
  }
});
