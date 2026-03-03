/**
 * 配置同步模块
 *
 * 处理「配置」Tab 中的导出/导入全量配置功能，
 * 用于在 Chrome 插件和 Electron 桌面 App 之间同步数据。
 */

import { getAIConfig } from "../services/storage";
import { $} from "./shared";
import { setAIConfigured, renderFilteredItems } from "./articles";
import { onExportFullConfig, onImportFullConfig } from "./feeds-io";
import { refreshFeeds } from "./feeds";
import { reloadAIForm } from "./ai-settings";

const syncExportBtn = $<HTMLButtonElement>("sync-export");
const syncImportBtn = $<HTMLButtonElement>("sync-import");
const syncImportFile = $<HTMLInputElement>("sync-import-file");
const syncStatusEl = $("sync-status");

/**
 * 初始化配置同步 Tab
 */
export function initSync(): void {
  syncExportBtn?.addEventListener("click", () => onExportFullConfig(syncStatusEl));
  syncImportBtn?.addEventListener("click", () => syncImportFile?.click());
  syncImportFile?.addEventListener("change", (e) =>
    onImportFullConfig(e, syncStatusEl, syncImportFile, {
      refreshFeeds: async () => {
        await refreshFeeds();
      },
      onFeedChanged: async () => {
        renderFilteredItems();
      },
      onAIConfigChanged: async () => {
        // 重新加载 AI 配置到界面
        const config = await getAIConfig();
        setAIConfigured(!!config.apiKey);
        await reloadAIForm();
      },
    })
  );
}
