/**
 * Storage 统一导出
 *
 * 外部模块通过 `from "../services/storage"` 或 `from "@/services/storage"` 导入
 */

import type { AIConfig } from "../../types";
import { DEFAULT_AI_CONFIG } from "../../constants";
import { safeSync, getFromSync } from "./helpers";

// ── Re-export 子模块 ─────────────────────────────────

export {
  // feeds
  getAllFeeds,
  addFeed,
  saveFeedOrder,
  removeFeed,
  importFeeds,
  getPausedFeeds,
  pauseFeed,
  resumeFeed,
  getFeedMetaMap,
  getFeedMeta,
  setFeedMeta,
} from "./feeds";

export {
  // items & read
  getItemsMap,
  setItemsForFeed,
  getItemsForFeed,
  getAllItems,
  getTotalItemCount,
  getReadItems,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
} from "./items";

export {
  // favorites
  getFavorites,
  addFavorite,
  removeFavorite,
  getFavoriteDetails,
} from "./favorites";

// ── Theme（主题偏好 → sync）──────────────────────────

/**
 * 获取主题设置
 */
export async function getTheme(): Promise<"light" | "dark"> {
  const { theme } = await getFromSync(["theme"]);
  return theme === "dark" ? "dark" : "light";
}

/**
 * 设置主题
 */
export async function setTheme(theme: "light" | "dark"): Promise<void> {
  await safeSync({ theme });
}

// ── AI 配置（→ sync）──────────────────────────────────

/**
 * 获取 AI 配置
 */
export async function getAIConfig(): Promise<AIConfig> {
  const { aiConfig } = await getFromSync(["aiConfig"]);
  return { ...DEFAULT_AI_CONFIG, ...(aiConfig as Partial<AIConfig> || {}) };
}

/**
 * 设置 AI 配置
 */
export async function setAIConfig(config: Partial<AIConfig>): Promise<void> {
  const current = await getAIConfig();
  const merged = { ...current, ...config };
  await safeSync({ aiConfig: merged });
}
