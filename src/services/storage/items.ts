/**
 * 文章条目与已读状态存储
 *
 * 文章缓存使用 chrome.storage.local（数据量大，可重新抓取）
 */

import type { FeedItem } from "../../types";
import { local } from "./helpers";

// ── Items（文章缓存 → 仅 local）──────────────────

export async function getItemsMap(): Promise<Record<string, FeedItem[]>> {
  const { itemsByFeed = {} } = await local.get(["itemsByFeed"]);
  return (itemsByFeed && typeof itemsByFeed === "object") ? itemsByFeed as Record<string, FeedItem[]> : {};
}

export async function setItemsForFeed(feedUrl: string, items: FeedItem[]): Promise<void> {
  const itemsByFeed = await getItemsMap();
  itemsByFeed[feedUrl] = Array.isArray(items) ? items : [];
  await local.set({ itemsByFeed });
}

/**
 * 获取单个源的条目，按发布时间降序排序
 */
export async function getItemsForFeed(feedUrl: string): Promise<FeedItem[]> {
  const itemsByFeed = await getItemsMap();
  const items = Array.isArray(itemsByFeed[feedUrl]) ? itemsByFeed[feedUrl] : [];
  return items
    .map((it) => ({ ...it, feedUrl }))
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

/**
 * 获取所有源的合并条目，按发布时间降序排序
 */
export async function getAllItems(limit?: number): Promise<FeedItem[]> {
  const itemsByFeed = await getItemsMap();
  const merged: FeedItem[] = Object.entries(itemsByFeed).flatMap(([feedUrl, items]) =>
    (Array.isArray(items) ? items : []).map((it) => ({ ...it, feedUrl }))
  );
  merged.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return limit ? merged.slice(0, limit) : merged;
}

/**
 * 获取所有条目总数（用于角标计数等）
 */
export async function getTotalItemCount(): Promise<number> {
  const itemsByFeed = await getItemsMap();
  return Object.values(itemsByFeed).reduce(
    (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
    0
  );
}

// ── 已读状态（local）──────────────────────────────

/**
 * 获取已读文章链接集合
 */
export async function getReadItems(): Promise<Set<string>> {
  const { readItems = [] } = await local.get(["readItems"]);
  return new Set(Array.isArray(readItems) ? readItems as string[] : []);
}

/**
 * 标记单篇文章为已读
 */
export async function markAsRead(link: string): Promise<void> {
  if (!link) return;
  const readSet = await getReadItems();
  if (readSet.has(link)) return;
  readSet.add(link);
  await local.set({ readItems: [...readSet] });
}

/**
 * 标记所有文章为已读
 */
export async function markAllAsRead(): Promise<void> {
  const itemsByFeed = await getItemsMap();
  const allLinks = Object.values(itemsByFeed).flatMap((items) =>
    (Array.isArray(items) ? items : [])
      .map((it) => it.link)
      .filter(Boolean)
  );
  const readSet = await getReadItems();
  for (const link of allLinks) {
    readSet.add(link);
  }
  await local.set({ readItems: [...readSet] });
}

/**
 * 获取未读文章数量
 */
export async function getUnreadCount(): Promise<number> {
  const itemsByFeed = await getItemsMap();
  const readSet = await getReadItems();
  let count = 0;
  for (const items of Object.values(itemsByFeed)) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (it.link && !readSet.has(it.link)) count++;
    }
  }
  return count;
}
