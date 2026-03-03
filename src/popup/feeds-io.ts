/**
 * 订阅源导入 / 导出 & 全量配置同步
 */

import type { AIConfig, FeedMeta } from "../types";
import {
  getAllFeeds,
  getFeedMetaMap,
  getPausedFeeds,
  importFeeds,
  pauseFeed,
  getAIConfig,
  setAIConfig,
  getFavorites,
  getReadItems,
  getTheme,
  setTheme,
} from "../services/storage";
import { safeSync, getFromSync, local } from "../services/storage/helpers";
import { showToast, setStatus, triggerFetch } from "./shared";

// ── 导出 ────────────────────────────────────

export async function onExportFeeds(statusEl: HTMLElement | null): Promise<void> {
  try {
    const [feeds, feedMeta, pausedSet] = await Promise.all([
      getAllFeeds(),
      getFeedMetaMap(),
      getPausedFeeds(),
    ]);
    if (feeds.length === 0) {
      showToast("没有订阅源可以导出");
      return;
    }
    const pausedFeeds = [...pausedSet];
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      feeds,
      feedMeta,
      ...(pausedFeeds.length > 0 ? { pausedFeeds } : {}),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rss-feeds-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ 已导出 ${feeds.length} 个订阅源`);
  } catch (e) {
    setStatus(statusEl, "导出失败：" + (e as Error).message, "error");
  }
}

// ── 导入 ────────────────────────────────────

export async function onImportFileChange(
  e: Event,
  statusEl: HTMLElement | null,
  importFileInput: HTMLInputElement | null,
  refreshFeeds: () => Promise<void>,
  onFeedChanged: () => Promise<void>,
): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (importFileInput) importFileInput.value = "";

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const feeds: string[] = Array.isArray(data.feeds) ? data.feeds : [];
    const feedMeta: Record<string, FeedMeta> =
      data.feedMeta && typeof data.feedMeta === "object" ? data.feedMeta : {};
    const importPaused: string[] = Array.isArray(data.pausedFeeds) ? data.pausedFeeds : [];

    if (feeds.length === 0) {
      setStatus(statusEl, "文件格式无效或为空", "error");
      return;
    }

    const { added, skipped, failed } = await importFeeds(feeds, feedMeta);

    // 导入暂停状态
    if (importPaused.length > 0) {
      for (const url of importPaused) {
        if (feeds.includes(url)) {
          await pauseFeed(url);
        }
      }
    }
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} 个已添加`);
    if (skipped > 0) parts.push(`${skipped} 个已存在`);
    if (failed > 0) parts.push(`${failed} 个无效`);
    const msg = parts.length ? parts.join("，") : "导入完成";
    setStatus(statusEl, msg, added > 0 ? "success" : "");
    showToast("✓ " + msg);
    await refreshFeeds();
    await onFeedChanged();
    triggerFetch();
  } catch (err) {
    setStatus(statusEl, "导入失败：" + (err as Error).message, "error");
  }
}

// ── 全量配置导出（订阅源 + AI 配置 + 收藏 + 主题）────────

export interface FullExportData {
  version: 2;
  exportedAt: string;
  feeds: string[];
  feedMeta: Record<string, FeedMeta>;
  pausedFeeds: string[];
  aiConfig: AIConfig;
  favorites: string[];
  favoriteDetails: Record<string, unknown>;
  readItems: string[];
  theme: "light" | "dark";
}

export async function onExportFullConfig(statusEl: HTMLElement | null): Promise<void> {
  try {
    const [feeds, feedMeta, pausedSet, aiConfig, favorites, readItems, theme] = await Promise.all([
      getAllFeeds(),
      getFeedMetaMap(),
      getPausedFeeds(),
      getAIConfig(),
      getFavorites(),
      getReadItems(),
      getTheme(),
    ]);
    const { favoriteDetails = {} } = await getFromSync(["favoriteDetails"]);

    const data: FullExportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      feeds,
      feedMeta,
      pausedFeeds: [...pausedSet],
      aiConfig,
      favorites: [...favorites],
      favoriteDetails: (favoriteDetails && typeof favoriteDetails === "object")
        ? favoriteDetails as Record<string, unknown>
        : {},
      readItems: [...readItems],
      theme,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rss-full-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const parts: string[] = [];
    if (feeds.length > 0) parts.push(`${feeds.length} 个订阅源`);
    if (aiConfig.apiKey) parts.push("AI 配置");
    if (favorites.size > 0) parts.push(`${favorites.size} 个收藏`);
    showToast(`✓ 已导出全部配置${parts.length ? "（" + parts.join("、") + "）" : ""}`);
  } catch (e) {
    setStatus(statusEl, "导出失败：" + (e as Error).message, "error");
  }
}

// ── 全量配置导入 ────────────────────────────────

export async function onImportFullConfig(
  e: Event,
  statusEl: HTMLElement | null,
  fileInput: HTMLInputElement | null,
  callbacks?: {
    refreshFeeds?: () => Promise<void>;
    onFeedChanged?: () => Promise<void>;
    onAIConfigChanged?: () => Promise<void>;
  },
): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (fileInput) fileInput.value = "";

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const results: string[] = [];

    // 1. 导入订阅源
    const feeds: string[] = Array.isArray(data.feeds) ? data.feeds : [];
    const feedMeta: Record<string, FeedMeta> =
      data.feedMeta && typeof data.feedMeta === "object" ? data.feedMeta : {};
    const importPaused: string[] = Array.isArray(data.pausedFeeds) ? data.pausedFeeds : [];

    if (feeds.length > 0) {
      const { added, skipped } = await importFeeds(feeds, feedMeta);
      if (importPaused.length > 0) {
        for (const url of importPaused) {
          if (feeds.includes(url)) await pauseFeed(url);
        }
      }
      results.push(`订阅源：${added} 新增，${skipped} 已存在`);
    }

    // 2. 导入 AI 配置
    if (data.aiConfig && typeof data.aiConfig === "object") {
      const aiConfig = data.aiConfig as Partial<AIConfig>;
      // 只导入非空字段
      const toSet: Partial<AIConfig> = {};
      if (aiConfig.baseUrl) toSet.baseUrl = aiConfig.baseUrl;
      if (aiConfig.apiKey) toSet.apiKey = aiConfig.apiKey;
      if (aiConfig.model) toSet.model = aiConfig.model;
      if (aiConfig.prompt !== undefined) toSet.prompt = aiConfig.prompt;
      if (aiConfig.temperature != null) toSet.temperature = aiConfig.temperature;
      if (aiConfig.maxTokens != null) toSet.maxTokens = aiConfig.maxTokens;
      if (aiConfig.maxContentLength != null) toSet.maxContentLength = aiConfig.maxContentLength;
      if (Object.keys(toSet).length > 0) {
        await setAIConfig(toSet);
        results.push("AI 配置已更新");
      }
    }

    // 3. 导入收藏
    if (Array.isArray(data.favorites) && data.favorites.length > 0) {
      const existingFavs = await getFavorites();
      const newFavLinks = data.favorites.filter((l: string) => !existingFavs.has(l));
      if (newFavLinks.length > 0 || data.favoriteDetails) {
        const { favorites: existingList = [], favoriteDetails: existingDetails = {} } =
          await getFromSync(["favorites", "favoriteDetails"]);
        const mergedLinks = [...new Set([
          ...(Array.isArray(existingList) ? existingList as string[] : []),
          ...data.favorites,
        ])];
        const mergedDetails = {
          ...((existingDetails && typeof existingDetails === "object") ? existingDetails : {}),
          ...(data.favoriteDetails && typeof data.favoriteDetails === "object" ? data.favoriteDetails : {}),
        };
        await safeSync({ favorites: mergedLinks, favoriteDetails: mergedDetails });
        results.push(`收藏：${newFavLinks.length} 新增`);
      }
    }

    // 4. 导入已读状态
    if (Array.isArray(data.readItems) && data.readItems.length > 0) {
      const existingRead = await getReadItems();
      const merged = [...new Set([...existingRead, ...data.readItems])];
      await local.set({ readItems: merged });
      const newCount = merged.length - existingRead.size;
      if (newCount > 0) results.push(`已读：${newCount} 条合并`);
    }

    // 5. 导入主题
    if (data.theme === "light" || data.theme === "dark") {
      await setTheme(data.theme);
    }

    // 回调
    if (callbacks?.refreshFeeds) await callbacks.refreshFeeds();
    if (callbacks?.onFeedChanged) await callbacks.onFeedChanged();
    if (callbacks?.onAIConfigChanged) await callbacks.onAIConfigChanged();
    if (feeds.length > 0) triggerFetch();

    const msg = results.length > 0 ? results.join("；") : "导入完成";
    setStatus(statusEl, "✓ " + msg, "success");
    showToast("✓ 配置同步导入完成");
  } catch (err) {
    setStatus(statusEl, "导入失败：" + (err as Error).message, "error");
  }
}
