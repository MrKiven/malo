/**
 * Storage 基础工具
 *
 * 存储分层：
 *  - sync  → 用户数据（订阅源、元信息、收藏），Chrome 下跨浏览器同步
 *  - local → 文章缓存（数据量大，可重新抓取）
 *
 * 通过平台抽象层适配 Chrome Extension 和 Electron 两种环境
 */

import type { FavoriteDetail } from "../../types";
import { platform } from "../../platform";

export const sync = platform.storage.sync;
export const local = platform.storage.local;

// ── 安全写入 sync（超 quota 回退 local）─────────────

export async function safeSync(data: Record<string, unknown>): Promise<void> {
  try {
    await sync.set(data);
  } catch (e) {
    console.warn("[storage] sync 写入失败，回退 local:", (e as Error).message);
    await local.set(data);
  }
}

// ── 数据迁移（local → sync，首次执行一次）──────────

let migrationDone = false;

async function ensureMigration(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  const { _syncMigrated } = await local.get(["_syncMigrated"]);
  if (_syncMigrated) return;

  // 从 local 读取旧数据
  const old = await local.get(["feeds", "feedMeta", "favorites", "favoriteDetails"]);
  const toSync: Record<string, unknown> = {};

  if (Array.isArray(old.feeds) && old.feeds.length > 0) {
    toSync.feeds = old.feeds;
  }
  if (old.feedMeta && typeof old.feedMeta === "object" && Object.keys(old.feedMeta).length > 0) {
    toSync.feedMeta = old.feedMeta;
  }
  if (Array.isArray(old.favorites) && old.favorites.length > 0) {
    toSync.favorites = old.favorites;
  }
  if (old.favoriteDetails && typeof old.favoriteDetails === "object" && Object.keys(old.favoriteDetails).length > 0) {
    // 迁移时截断 description 以控制大小
    const trimmed: Record<string, FavoriteDetail> = {};
    for (const [k, v] of Object.entries(old.favoriteDetails as Record<string, FavoriteDetail>)) {
      trimmed[k] = { ...v, description: (v.description || "").slice(0, 100) };
    }
    toSync.favoriteDetails = trimmed;
  }

  if (Object.keys(toSync).length > 0) {
    await safeSync(toSync);
    console.log("[storage] 已迁移用户数据到 sync");
  }

  await local.set({ _syncMigrated: true });
}

// ── 读取辅助：优先 sync，补漏 local ─────────────────

export async function getFromSync(keys: string[]): Promise<Record<string, unknown>> {
  await ensureMigration();
  const result = await sync.get(keys) as Record<string, unknown>;
  // 如果 sync 没数据，尝试 local（兼容回退写入的情况）
  const missing = keys.filter((k) => result[k] === undefined);
  if (missing.length > 0) {
    const fallback = await local.get(missing) as Record<string, unknown>;
    Object.assign(result, fallback);
  }
  return result;
}
