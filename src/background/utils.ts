/**
 * Background 工具函数
 *
 * 通用的异步工具、网络请求、Badge 更新等
 */

import { getAllItems, getReadItems, getPausedFeeds } from "../services/storage";
import { BADGE_COLOR } from "../constants";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; RSSHelper/1.0)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i]);
      } catch (e) {
        results[i] = e as Error;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

export async function updateBadge(): Promise<void> {
  try {
    const [items, readSet, pausedSet] = await Promise.all([getAllItems(), getReadItems(), getPausedFeeds()]);
    // 排除已暂停订阅源的文章
    const count = items.filter((it) => it.link && !readSet.has(it.link) && !pausedSet.has(it.feedUrl || "")).length;
    const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch {
    // badge API 在某些环境不可用
  }
}
