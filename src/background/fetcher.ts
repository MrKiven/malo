/**
 * 订阅源抓取核心逻辑
 *
 * 负责抓取所有订阅源的文章内容，支持 RSS、静态 HTML、JS 渲染页面
 */

import type { FeedItem, FeedType } from "../types";
import {
  getAllFeeds,
  setItemsForFeed,
  getFeedMeta,
  setFeedMeta,
  getPausedFeeds,
} from "../services/storage";
import { parseRssXml } from "../services/parser";
import { scrapeArticles } from "../services/scraper";
import { scrapePageDOM } from "../services/page-scraper";
import { FEED_TYPE_LABELS } from "../utils/format";
import {
  REQUEST_TIMEOUT_MS,
  TAB_SCRAPE_TIMEOUT_MS,
  MAX_CONCURRENT,
  MAX_ITEMS_PER_FEED,
} from "../constants";
import { sleep, fetchWithTimeout, concurrentMap, updateBadge } from "./utils";

// ── 抓取逻辑 ─────────────────────────────────────

let isFetching = false;

export async function fetchAllFeeds(): Promise<void> {
  if (isFetching) return;
  isFetching = true;

  try {
    const allFeeds = await getAllFeeds();
    if (allFeeds.length === 0) return;

    // 过滤掉已暂停的订阅源
    const pausedSet = await getPausedFeeds();
    const feeds = allFeeds.filter((f) => !pausedSet.has(f));

    if (feeds.length === 0) {
      console.log(`[rss] 所有 ${allFeeds.length} 个源均已暂停，跳过抓取`);
      return;
    }

    const pausedCount = allFeeds.length - feeds.length;
    console.log(`[rss] 开始抓取 ${feeds.length} 个源${pausedCount > 0 ? `（${pausedCount} 个已暂停）` : ""}`);
    await concurrentMap(feeds, fetchOneFeed, MAX_CONCURRENT);
    console.log("[rss] 全部抓取完成");

    chrome.runtime.sendMessage({ type: "items-updated" }, () => {
      void chrome.runtime.lastError;
    });

    await updateBadge();
  } catch (e) {
    console.warn("[rss] fetchAllFeeds 异常", e);
  } finally {
    isFetching = false;
  }
}

/**
 * 抓取单个源：自动检测类型
 *
 * 类型优先级：
 *  1. rss       → RSS/Atom 解析
 *  2. page      → 正则 HTML 抓取（静态页面）
 *  3. page-js   → 标签页注入 DOM 抓取（JS 渲染页面）
 *
 * 首次添加时自动检测，结果缓存到 feedMeta
 */
async function fetchOneFeed(feedUrl: string): Promise<void> {
  try {
    const meta = await getFeedMeta(feedUrl);
    let items: FeedItem[] = [];
    let type: FeedType | "" = meta?.type || "";

    // ── 已知类型，按类型抓取 ───────────────────
    if (type === "rss") {
      const text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      items = parseRssXml(text);
    } else if (type === "page") {
      const text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      items = scrapeArticles(text, feedUrl);
    } else if (type === "page-js") {
      items = await scrapeViaTab(feedUrl);
    } else {
      // ── 自动检测 ────────────────────────────
      let text = "";
      try {
        text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      } catch (fetchErr) {
        console.log(`[rss] fetch 失败 (${(fetchErr as Error).message})，尝试标签页抓取: ${feedUrl}`);
        items = await scrapeViaTab(feedUrl);
        type = items.length > 0 ? "page-js" : "unknown";
      }

      if (!type) {
        // 1) 尝试 RSS
        items = parseRssXml(text);
        if (items.length > 0) {
          type = "rss";
        } else {
          // 2) 尝试正则 HTML 抓取
          items = scrapeArticles(text, feedUrl);
          if (items.length > 0) {
            type = "page";
          } else {
            // 3) 回退到标签页 DOM 抓取
            console.log(`[rss] 正则无结果，尝试标签页抓取: ${feedUrl}`);
            items = await scrapeViaTab(feedUrl);
            type = items.length > 0 ? "page-js" : "unknown";
          }
        }
      }
    }

    items = items.slice(0, MAX_ITEMS_PER_FEED);
    await setItemsForFeed(feedUrl, items);

    if (type && type !== meta?.type) {
      await setFeedMeta(feedUrl, { ...meta, type });
    }

    console.log(`[rss] ✓ ${feedUrl} [${FEED_TYPE_LABELS[type] || type}] (${items.length} 条)`);
  } catch (e) {
    console.warn(`[rss] ✗ ${feedUrl}:`, (e as Error).message || e);
  }
}

// ── 标签页注入抓取（处理 JS 渲染页面）──────────

async function scrapeViaTab(url: string): Promise<FeedItem[]> {
  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoad(tab.id!, TAB_SCRAPE_TIMEOUT_MS);
    await sleep(3000);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: scrapePageDOM,
    });

    return (results?.[0]?.result as FeedItem[]) || [];
  } catch (e) {
    console.warn(`[rss] 标签页抓取失败 ${url}:`, (e as Error).message || e);
    return [];
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* tab 可能已关闭 */ }
    }
  }
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("标签页加载超时"));
    }, timeoutMs);

    function listener(id: number, info: chrome.tabs.TabChangeInfo): void {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (t) => {
      if (t?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}
