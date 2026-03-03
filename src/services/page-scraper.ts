/**
 * 页面级 DOM 抓取器
 * 通过 chrome.scripting.executeScript 注入到目标页面中运行
 * 此时页面 JS 已执行完毕，可以访问完整的 DOM 树
 *
 * 导出一个自包含函数 scrapePageDOM，供 background/index.ts 注入使用
 *
 * ⚠️ 维护提醒：
 *  scrapePageDOM 函数通过 chrome.scripting.executeScript 注入页面运行，
 *  函数体内无法引用任何外部模块/变量，必须完全自包含。
 *  因此内部重复定义了以下工具函数，它们是 utils/html.ts 中同名函数的副本：
 *    - parseDateStr     → 对应 utils/html.ts#parseDateStr
 *    - extractDateFromUrl → 对应 utils/html.ts#extractDateFromUrl
 *    - extractDateFromText → 对应 utils/html.ts#extractDateFromText
 *    - resolveLink      → 对应 utils/html.ts#resolveUrl（页面版，使用 DOM API）
 *    - isSameOrigin     → 对应 utils/html.ts#isSameOrigin
 *  修改上述工具函数逻辑时需同步更新两处。
 */

import type { FeedItem } from "../types";

/**
 * 在页面上下文中执行，提取文章列表
 * 返回 Array<{id, title, link, description, publishedAt}>
 *
 * ⚠️ 此函数通过 chrome.scripting.executeScript 注入页面运行
 *    不能引用任何外部模块/变量，必须完全自包含
 */
export function scrapePageDOM(): FeedItem[] {
  const pageUrl = location.href;
  const results: FeedItem[] = [];
  const seen = new Set<string>();

  function addResult(item: FeedItem): void {
    if (!item.link || seen.has(item.link)) return;
    seen.add(item.link);
    results.push(item);
  }

  // ── 策略 1：<article> 元素 ──────────────────────

  const articles = document.querySelectorAll("article");
  for (const article of articles) {
    const item = parseElement(article);
    if (item) addResult(item);
  }

  // ── 策略 2：常见博客容器内的链接 ────────────────

  if (results.length === 0) {
    // 常见的内容容器选择器
    const containerSelectors = [
      "main",
      "[role='main']",
      ".posts", ".post-list", ".blog-posts", ".articles", ".article-list",
      ".entries", ".content-list", ".feed", ".blog-feed",
      "#posts", "#articles", "#content",
    ];

    let container: Element | null = null;
    for (const sel of containerSelectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (container) {
      // 在容器内找链接
      const links = container.querySelectorAll("a[href]");
      for (const a of links) {
        const item = scoredLinkToItem(a as HTMLAnchorElement);
        if (item) addResult(item);
      }
    }
  }

  // ── 策略 3：带结构化数据的链接 ──────────────────

  if (results.length === 0) {
    // 3a) 标题内的链接：<h3><a href="...">标题</a></h3>
    const headingLinks = document.querySelectorAll(
      "h1 a[href], h2 a[href], h3 a[href], h4 a[href]"
    );
    for (const a of headingLinks) {
      const item = scoredLinkToItem(a as HTMLAnchorElement);
      if (item) addResult(item);
    }

    // 3b) 链接包裹标题（现代卡片式布局）：<a href="..."><h3>标题</h3></a>
    if (results.length === 0) {
      const cardLinks = document.querySelectorAll(
        "a[href]:has(h1), a[href]:has(h2), a[href]:has(h3), a[href]:has(h4)"
      );
      for (const a of cardLinks) {
        const item = cardLinkToItem(a as HTMLAnchorElement);
        if (item) addResult(item);
      }
    }
  }

  // ── 策略 4：全页面启发式 ────────────────────────

  if (results.length === 0) {
    const allLinks = document.querySelectorAll("a[href]");
    const candidates: { el: HTMLAnchorElement; score: number }[] = [];

    for (const a of allLinks) {
      const score = scoreLink(a as HTMLAnchorElement);
      if (score > 2) {
        candidates.push({ el: a as HTMLAnchorElement, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates.slice(0, 50)) {
      const item = linkToItem(c.el);
      if (item) addResult(item);
    }
  }

  // ── 策略 5：JSON-LD 结构化数据 ─────────────────

  if (results.length === 0) {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        const items = extractFromJsonLd(data);
        for (const item of items) addResult(item);
      } catch { /* ignore */ }
    }
  }

  return results.slice(0, 50);

  // ── 辅助函数 ──────────────────────────────────

  function parseElement(el: Element): FeedItem | null {
    // 找第一个有意义的链接
    const a = el.querySelector("h1 a, h2 a, h3 a, h4 a, a[href]") as HTMLAnchorElement | null;
    if (!a) return null;

    const link = resolveLink(a.href);
    if (!link || !isSameOrigin(link)) return null;

    // 标题：优先从 heading 取
    let title = "";
    const heading = el.querySelector("h1, h2, h3, h4");
    if (heading) title = (heading.textContent || "").trim();
    if (!title) title = (a.textContent || "").trim();
    if (!title || title.length < 2) return null;

    // 摘要
    let description = "";
    const p = el.querySelector("p");
    if (p) description = (p.textContent || "").trim().slice(0, 300);

    // 时间
    let publishedAt = 0;
    const time = el.querySelector("time[datetime]") as HTMLTimeElement | null;
    if (time) {
      publishedAt = parseDateStr(time.getAttribute("datetime") || "");
    }
    if (!publishedAt) {
      const timeEl = el.querySelector("time");
      if (timeEl) publishedAt = parseDateStr(timeEl.textContent || "");
    }
    if (!publishedAt) {
      publishedAt = extractDateFromUrl(link) || extractDateFromText(el.textContent || "");
    }

    return {
      id: link,
      title: title.slice(0, 200),
      link,
      description,
      publishedAt,
    };
  }

  function scoredLinkToItem(a: HTMLAnchorElement): FeedItem | null {
    const score = scoreLink(a);
    if (score <= 2) return null;
    return linkToItem(a);
  }

  /**
   * 从卡片式链接中提取文章（链接包裹标题的模式）
   * 标题从内部 heading 元素获取，而非整个链接的 textContent
   */
  function cardLinkToItem(a: HTMLAnchorElement): FeedItem | null {
    const link = resolveLink(a.href);
    if (!link || !isSameOrigin(link)) return null;

    // 从内部 heading 获取标题
    const heading = a.querySelector("h1, h2, h3, h4");
    const title = heading ? (heading.textContent || "").trim() : "";
    if (!title || title.length < 4) return null;

    // 摘要：从 <p> 标签获取
    let description = "";
    const p = a.querySelector("p");
    if (p) description = (p.textContent || "").trim().slice(0, 300);

    // 时间
    let publishedAt = 0;
    const time = a.querySelector("time[datetime]") as HTMLTimeElement | null;
    if (time) publishedAt = parseDateStr(time.getAttribute("datetime") || "");
    if (!publishedAt) {
      const timeEl = a.querySelector("time");
      if (timeEl) publishedAt = parseDateStr(timeEl.textContent || "");
    }
    if (!publishedAt) {
      publishedAt = extractDateFromUrl(link) || extractDateFromText(a.textContent || "");
    }

    return {
      id: link,
      title: title.slice(0, 200),
      link,
      description,
      publishedAt,
    };
  }

  function linkToItem(a: HTMLAnchorElement): FeedItem | null {
    const link = resolveLink(a.href);
    if (!link || !isSameOrigin(link)) return null;

    // 优先从内部 heading 获取标题（处理卡片式链接）
    const heading = a.querySelector("h1, h2, h3, h4");
    const title = heading ? (heading.textContent || "").trim() : (a.textContent || "").trim();
    if (!title || title.length < 4) return null;

    // 寻找相邻的描述文本
    let description = "";
    const parent = a.closest("li, div, section, article");
    if (parent) {
      const p = parent.querySelector("p");
      if (p && p !== (a as unknown as HTMLParagraphElement)) description = (p.textContent || "").trim().slice(0, 300);
    }

    // 寻找相邻的时间
    let publishedAt = 0;
    if (parent) {
      const time = parent.querySelector("time[datetime]") as HTMLTimeElement | null;
      if (time) publishedAt = parseDateStr(time.getAttribute("datetime") || "");
      if (!publishedAt) {
        const timeEl = parent.querySelector("time");
        if (timeEl) publishedAt = parseDateStr(timeEl.textContent || "");
      }
    }
    if (!publishedAt) {
      publishedAt = extractDateFromUrl(link) || extractDateFromText(parent?.textContent || "");
    }

    return {
      id: link,
      title: title.slice(0, 200),
      link,
      description,
      publishedAt,
    };
  }

  function scoreLink(a: HTMLAnchorElement): number {
    const href = a.href;
    // 智能获取文本：优先取内部 heading 文本，否则用链接整体文本
    const heading = a.querySelector("h1, h2, h3, h4");
    const text = heading ? (heading.textContent || "").trim() : (a.textContent || "").trim();
    let score = 0;

    // 文本长度合理
    if (text.length >= 8 && text.length <= 200) score += 3;
    else if (text.length >= 4 && text.length <= 300) score += 1;
    else return 0;

    let path: string;
    try { path = new URL(href).pathname; } catch { return 0; }

    // 排除非文章链接
    if (/^\/(about|contact|tag|category|author|page|search|login|signup|register|privacy|terms|faq)\b/i.test(path)) return 0;
    if (path === "/" || !path) return 0;
    if (/\.(png|jpg|gif|svg|pdf|zip|css|js)$/i.test(path)) return 0;

    // URL 含日期
    if (/\/\d{4}\/\d{1,2}(\/\d{1,2})?/.test(href)) score += 5;
    if (/\d{4}-\d{2}-\d{2}/.test(href)) score += 4;

    // 博客路径（支持复数形式如 /posts/, /articles/）
    if (/\/(blogs?|posts?|articles?|news|stories|writing|journal)(\/|$)/i.test(path)) score += 3;
    if (/\/(p|entry|entries|archive|archives|notes?)(\/|$)/i.test(path)) score += 2;

    // URL 路径深度
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 2) score += 1;

    // slug 模式
    if (segments.some((s) => s.length > 15 && /[a-z].*-.*[a-z]/i.test(s))) score += 3;

    // 在标题容器中（标题包含链接）
    if (a.closest("h1, h2, h3, h4")) score += 4;

    // 链接包含标题（卡片模式）
    if (heading) score += 4;

    // 在列表项中
    if (a.closest("li, article")) score += 2;

    // 非同源
    if (!isSameOrigin(href)) return 0;

    return score;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractFromJsonLd(data: any): FeedItem[] {
    const items: FeedItem[] = [];
    const list = Array.isArray(data) ? data : [data];

    for (const entry of list) {
      if (entry["@type"] === "BlogPosting" || entry["@type"] === "Article" || entry["@type"] === "NewsArticle") {
        items.push({
          id: entry.url || entry.mainEntityOfPage || "",
          title: entry.headline || entry.name || "",
          link: entry.url || entry.mainEntityOfPage || "",
          description: (entry.description || "").slice(0, 300),
          publishedAt: parseDateStr(entry.datePublished || entry.dateModified || ""),
        });
      }
      // 列表页可能有 itemListElement
      if (entry.itemListElement && Array.isArray(entry.itemListElement)) {
        for (const li of entry.itemListElement) {
          if (li.url) {
            items.push({
              id: li.url,
              title: li.name || "",
              link: li.url,
              description: "",
              publishedAt: 0,
            });
          }
        }
      }
    }
    return items;
  }

  function resolveLink(href: string): string {
    try { return new URL(href, pageUrl).href; }
    catch { return ""; }
  }

  function isSameOrigin(url: string): boolean {
    try { return new URL(url).origin === location.origin; }
    catch { return false; }
  }

  // ── 日期提取工具（自包含副本）──────────────────
  // ⚠️ 以下三个函数与 utils/dom-utils.ts 中的 parseDate / extractDateFromUrl / extractDateFromText 保持同步
  //    page-scraper 通过 executeScript 注入页面运行，无法 import 外部模块，因此需要本地副本。
  //    修改日期提取逻辑时请同步更新两处。

  function parseDateStr(s: string): number {
    if (!s) return 0;
    const trimmed = s.trim().replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "");
    const ts = Date.parse(trimmed);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  }

  function extractDateFromUrl(url: string): number {
    const m1 = /\/(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(url);
    if (m1) return parseDateStr(`${m1[1]}-${m1[2]}-${m1[3]}`);
    const m2 = /(\d{4}-\d{2}-\d{2})/.exec(url);
    if (m2) return parseDateStr(m2[1]);
    return 0;
  }

  function extractDateFromText(text: string): number {
    if (!text) return 0;
    const patterns: RegExp[] = [
      /(\d{4}-\d{1,2}-\d{1,2})/,                // 2024-01-15
      /(\d{4}\/\d{1,2}\/\d{1,2})/,              // 2024/01/15
      /(\w{3,9}\s+\d{1,2},?\s+\d{4})/,           // "Feb 28, 2026" / "February 28 2026"
      /(\d{1,2}\s+\w{3,9}\s+\d{4})/,              // "28 Feb 2026" / "15 January 2024"
      /(\w{3}\s+\d{1,2})\b/,                      // "Feb 04" - 短日期，补当年
      /(\d{4}年\d{1,2}月\d{1,2}日)/,               // 2024年1月15日
    ];
    for (const p of patterns) {
      const m = p.exec(text);
      if (m) {
        let ts = parseDateStr(m[1]);
        if (ts > 0) return ts;
        // 短日期补年份 "Feb 04" -> "Feb 04, 2026"
        if (/^\w{3}\s+\d{1,2}$/.test(m[1])) {
          ts = parseDateStr(m[1] + ", " + new Date().getFullYear());
          if (ts > 0) return ts;
        }
      }
    }
    return 0;
  }
}
