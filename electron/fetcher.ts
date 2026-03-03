/**
 * Electron 后台抓取器
 *
 * 在主进程中定时抓取所有订阅源，复用 src/services/ 中的解析逻辑。
 * 桌面版仅支持 rss 和 page 两种模式（不支持 page-js 标签页注入）。
 */

import { syncGet, localGet, localSet, syncSet } from "./storage";
import type { FeedItem, FeedMeta, FeedType } from "../src/types";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT = 3;
const MAX_ITEMS_PER_FEED = 50;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

let isFetching = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let onItemsUpdated: (() => void) | null = null;

export function setOnItemsUpdated(fn: () => void): void {
  onItemsUpdated = fn;
}

export function startPeriodicFetch(): void {
  fetchAllFeeds();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => fetchAllFeeds(), REFRESH_INTERVAL_MS);
}

export function stopPeriodicFetch(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export async function fetchAllFeeds(): Promise<void> {
  if (isFetching) return;
  isFetching = true;

  try {
    const { feeds: rawFeeds = [] } = syncGet(["feeds"]);
    const allFeeds = Array.isArray(rawFeeds) ? rawFeeds as string[] : [];
    if (allFeeds.length === 0) return;

    const { pausedFeeds: rawPaused = [] } = syncGet(["pausedFeeds"]);
    const pausedSet = new Set(Array.isArray(rawPaused) ? rawPaused as string[] : []);
    const feeds = allFeeds.filter((f) => !pausedSet.has(f));

    if (feeds.length === 0) {
      console.log(`[rss] 所有 ${allFeeds.length} 个源均已暂停，跳过抓取`);
      return;
    }

    console.log(`[rss] 开始抓取 ${feeds.length} 个源`);
    await concurrentMap(feeds, fetchOneFeed, MAX_CONCURRENT);
    console.log("[rss] 全部抓取完成");

    onItemsUpdated?.();
  } catch (e) {
    console.warn("[rss] fetchAllFeeds 异常", e);
  } finally {
    isFetching = false;
  }
}

async function fetchOneFeed(feedUrl: string): Promise<void> {
  try {
    const { feedMeta: rawMeta = {} } = syncGet(["feedMeta"]);
    const metaMap = (rawMeta && typeof rawMeta === "object") ? rawMeta as Record<string, FeedMeta> : {};
    const meta = metaMap[feedUrl] || null;
    let items: FeedItem[] = [];
    let type: FeedType | "" = meta?.type || "";

    if (type === "rss") {
      const text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      items = parseRssXml(text);
    } else if (type === "page") {
      const text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      items = scrapeArticles(text, feedUrl);
    } else if (type === "page-js") {
      // 桌面版不支持 page-js，回退到 page 模式
      const text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      items = scrapeArticles(text, feedUrl);
      if (items.length > 0) type = "page";
    } else {
      // 自动检测
      let text = "";
      try {
        text = await fetchWithTimeout(feedUrl, REQUEST_TIMEOUT_MS);
      } catch {
        console.warn(`[rss] fetch 失败: ${feedUrl}`);
        return;
      }

      items = parseRssXml(text);
      if (items.length > 0) {
        type = "rss";
      } else {
        items = scrapeArticles(text, feedUrl);
        if (items.length > 0) {
          type = "page";
        } else {
          type = "unknown";
        }
      }
    }

    items = items.slice(0, MAX_ITEMS_PER_FEED);

    // 保存文章
    const { itemsByFeed: rawItems = {} } = localGet(["itemsByFeed"]);
    const itemsByFeed = (rawItems && typeof rawItems === "object") ? rawItems as Record<string, FeedItem[]> : {};
    itemsByFeed[feedUrl] = items;
    localSet({ itemsByFeed });

    // 更新 meta
    if (type && type !== meta?.type) {
      metaMap[feedUrl] = { ...meta, type };
      syncSet({ feedMeta: metaMap });
    }

    console.log(`[rss] ✓ ${feedUrl} [${type}] (${items.length} 条)`);
  } catch (e) {
    console.warn(`[rss] ✗ ${feedUrl}:`, (e as Error).message || e);
  }
}

// ── 内联的解析函数（避免 ESM/CJS 跨进程导入问题）──────

function parseRssXml(xmlText: string): FeedItem[] {
  const text = String(xmlText || "").trim();
  if (!text) return [];

  if (/<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text)) {
    return parseAtom(text);
  }
  return parseRss2(text);
}

function parseAtom(text: string): FeedItem[] {
  return matchAll(text, /<entry[\s\S]*?>[\s\S]*?<\/entry>/gi).map((xml) => {
    const link = extractAtomLink(xml) || unescapeXml(extractTagContent(xml, "id"));
    return {
      id: unescapeXml(extractTagContent(xml, "id")) || link,
      title: unescapeXml(extractTagContent(xml, "title")) || link || "(无标题)",
      link,
      description: unescapeXml(extractTagContent(xml, "summary")) || unescapeXml(extractTagContent(xml, "content")) || "",
      publishedAt: parseDate(extractTagContent(xml, "updated") || extractTagContent(xml, "published")),
    };
  });
}

function extractAtomLink(xml: string): string {
  const links = matchAll(xml, /<link[^>]*?\/?>/gi);
  for (const l of links) {
    if (/rel\s*=\s*["']alternate["']/i.test(l)) {
      const href = extractAttrValue(l, "href");
      if (href) return href;
    }
  }
  for (const l of links) {
    const href = extractAttrValue(l, "href");
    if (href) return href;
  }
  return "";
}

function parseRss2(text: string): FeedItem[] {
  return matchAll(text, /<item[\s\S]*?>[\s\S]*?<\/item>/gi).map((xml) => {
    const link = unescapeXml(extractTagContent(xml, "link"));
    return {
      id: unescapeXml(extractTagContent(xml, "guid")) || link || unescapeXml(extractTagContent(xml, "title")),
      title: unescapeXml(extractTagContent(xml, "title")) || link || "(无标题)",
      link,
      description: unescapeXml(extractTagContent(xml, "description")) || "",
      publishedAt: parseDate(extractTagContent(xml, "pubDate") || extractTagContent(xml, "dc:date")),
    };
  });
}

function scrapeArticles(html: string, pageUrl: string): FeedItem[] {
  const allLinks = matchAll(html, /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi);
  const seen = new Set<string>();
  const items: FeedItem[] = [];

  for (const match of allLinks) {
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(match);
    const textMatch = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(match);
    if (!hrefMatch || !textMatch) continue;

    const href = hrefMatch[1];
    const rawText = textMatch[1].replace(/<[^>]+>/g, "").trim();
    const link = resolveUrl(href, pageUrl);

    if (!link || !rawText || rawText.length < 4 || rawText.length > 300) continue;
    if (seen.has(link)) continue;

    try {
      const parsed = new URL(link);
      const path = parsed.pathname;
      if (path === "/" || !path) continue;
      if (/^\/(about|contact|tag|category|author|page|search|login)/i.test(path)) continue;
      if (/\.(png|jpg|gif|svg|pdf|zip|css|js)$/i.test(path)) continue;

      const hasDateInUrl = /\/\d{4}\/\d{1,2}/.test(link) || /\d{4}-\d{2}-\d{2}/.test(link);
      const hasArticlePath = /\/(blogs?|posts?|articles?|news)(\/|$)/i.test(path);
      if (!hasDateInUrl && !hasArticlePath && path.split("/").filter(Boolean).length < 2) continue;
    } catch {
      continue;
    }

    seen.add(link);
    items.push({
      id: link,
      title: rawText.slice(0, 200),
      link,
      description: "",
      publishedAt: extractDateFromUrl(link),
    });

    if (items.length >= 50) break;
  }

  return items;
}

// ── 工具函数 ──────────────────────────────────────

function matchAll(text: string, regex: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) results.push(m[0]);
  return results;
}

function extractTagContent(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = re.exec(xml);
  if (!m) return "";
  let content = m[1];
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(content.trim());
  if (cdataMatch) content = cdataMatch[1];
  return content.trim();
}

function extractAttrValue(tag: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = re.exec(tag);
  return m ? m[1] : "";
}

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseDate(dateStr: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr.trim());
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

function extractDateFromUrl(url: string): number {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(url);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; MaloRSS/1.0)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
