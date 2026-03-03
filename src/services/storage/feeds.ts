/**
 * 订阅源管理存储
 *
 * Feeds、FeedMeta、PausedFeeds、导入导出
 */

import type { FeedMeta, AddFeedResult, ImportResult } from "../../types";
import { safeSync, getFromSync, local } from "./helpers";
import { getItemsMap } from "./items";

// ── Feeds ──────────────────────────────────────────

export async function getAllFeeds(): Promise<string[]> {
  const { feeds = [] } = await getFromSync(["feeds"]);
  return Array.isArray(feeds) ? feeds as string[] : [];
}

export async function addFeed(url: string): Promise<AddFeedResult> {
  const normalized = String(url || "").trim();
  if (!normalized) return { ok: false, reason: "empty" };

  try {
    new URL(normalized); // 校验 URL 格式
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  const feeds = await getAllFeeds();
  if (feeds.includes(normalized)) return { ok: true, reason: "exists" };

  feeds.push(normalized);
  await safeSync({ feeds });
  return { ok: true, reason: "added" };
}

/**
 * 保存订阅源顺序（用于拖拽排序后持久化）
 */
export async function saveFeedOrder(orderedFeeds: string[]): Promise<void> {
  await safeSync({ feeds: orderedFeeds });
}

export async function removeFeed(url: string): Promise<void> {
  const feeds = await getAllFeeds();
  const updated = feeds.filter((f) => f !== url);
  await safeSync({ feeds: updated });

  // 清理 sync 中的 feedMeta
  const feedMeta = await getFeedMetaMap();
  if (url in feedMeta) {
    delete feedMeta[url];
    await safeSync({ feedMeta });
  }

  // 清理 sync 中的暂停状态
  const paused = await getPausedFeeds();
  if (paused.has(url)) {
    paused.delete(url);
    await safeSync({ pausedFeeds: [...paused] });
  }

  // 清理 local 中的条目缓存
  const itemsByFeed = await getItemsMap();
  if (url in itemsByFeed) {
    delete itemsByFeed[url];
    await local.set({ itemsByFeed });
  }
}

/**
 * 批量导入订阅源
 */
export async function importFeeds(
  feeds: string[],
  feedMeta: Record<string, FeedMeta> = {}
): Promise<ImportResult> {
  const existing = await getAllFeeds();
  const existingSet = new Set(existing);
  const metaMap = await getFeedMetaMap();

  let added = 0;
  let skipped = 0;
  let failed = 0;

  const toAdd: string[] = [];

  for (const url of feeds) {
    const normalized = String(url || "").trim();
    if (!normalized) {
      failed++;
      continue;
    }
    try {
      new URL(normalized);
    } catch {
      failed++;
      continue;
    }
    if (existingSet.has(normalized)) {
      skipped++;
      continue;
    }
    toAdd.push(normalized);
    existingSet.add(normalized);
    added++;
  }

  if (toAdd.length > 0) {
    const merged = [...existing, ...toAdd];
    await safeSync({ feeds: merged });
  }

  // 合并 feedMeta（导入的 meta 覆盖已有）
  const toMerge = Object.entries(feedMeta || {}).filter(([url]) => toAdd.includes(url) || existing.includes(url));
  if (toMerge.length > 0) {
    for (const [url, meta] of toMerge) {
      if (meta && typeof meta === "object") {
        metaMap[url] = { ...(metaMap[url] || {}), ...meta };
      }
    }
    await safeSync({ feedMeta: metaMap });
  }

  return { added, skipped, failed };
}

// ── Paused Feeds（暂停抓取的订阅源）──────────────────

/**
 * 获取已暂停的订阅源 URL 集合
 */
export async function getPausedFeeds(): Promise<Set<string>> {
  const { pausedFeeds = [] } = await getFromSync(["pausedFeeds"]);
  return new Set(Array.isArray(pausedFeeds) ? pausedFeeds as string[] : []);
}

/**
 * 暂停某个订阅源的自动抓取
 */
export async function pauseFeed(feedUrl: string): Promise<void> {
  if (!feedUrl) return;
  const paused = await getPausedFeeds();
  if (paused.has(feedUrl)) return;
  paused.add(feedUrl);
  await safeSync({ pausedFeeds: [...paused] });
}

/**
 * 恢复某个订阅源的自动抓取
 */
export async function resumeFeed(feedUrl: string): Promise<void> {
  if (!feedUrl) return;
  const paused = await getPausedFeeds();
  if (!paused.has(feedUrl)) return;
  paused.delete(feedUrl);
  await safeSync({ pausedFeeds: [...paused] });
}

// ── Feed Meta（源类型等元信息）─────────────────────

export async function getFeedMetaMap(): Promise<Record<string, FeedMeta>> {
  const { feedMeta = {} } = await getFromSync(["feedMeta"]);
  return (feedMeta && typeof feedMeta === "object") ? feedMeta as Record<string, FeedMeta> : {};
}

export async function getFeedMeta(feedUrl: string): Promise<FeedMeta | null> {
  const map = await getFeedMetaMap();
  return map[feedUrl] || null;
}

export async function setFeedMeta(feedUrl: string, meta: FeedMeta): Promise<void> {
  const map = await getFeedMetaMap();
  map[feedUrl] = meta;
  await safeSync({ feedMeta: map });
}
