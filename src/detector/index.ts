/**
 * Content Script：检测当前页面中的 RSS/Atom 订阅源 + 网页文章内容
 * 检测策略：
 *  1. <link rel="alternate" type="application/rss+xml|application/atom+xml"> 标签
 *  2. <a> 标签中常见的 feed 路径模式
 *  3. 页面是否包含文章列表（article 元素、标题链接等）
 *
 * ⚠️ 维护提醒：
 *  本文件作为 Content Script 独立注入网页运行，无法 import 外部模块。
 *  因此下列接口和函数在文件内部重新定义，是 types.ts 中同名接口的副本：
 *    - DetectedFeed      → 对应 types.ts#DetectedFeed
 *    - PageArticlesResult → 对应 types.ts#PageArticlesResult
 *  修改上述类型时需同步更新两处。
 */

(() => {
  /** @sync types.ts#DetectedFeed */
  interface DetectedFeed {
    url: string;
    title: string;
    source: "link" | "anchor";
  }

  /** @sync types.ts#PageArticlesResult */
  interface PageArticlesResult {
    hasArticles: boolean;
    articleCount: number;
    sampleTitles: string[];
  }

  /** 从 <link> 标签中提取 RSS/Atom feeds */
  function detectFromLinkTags(): DetectedFeed[] {
    const types = [
      "application/rss+xml",
      "application/atom+xml",
      "application/xml",
      "text/xml",
    ];
    const links = document.querySelectorAll('link[rel="alternate"]');
    const results: DetectedFeed[] = [];

    for (const link of links) {
      const type = (link.getAttribute("type") || "").toLowerCase();
      const href = link.getAttribute("href");
      if (!href) continue;
      if (!types.some((t) => type.includes(t))) continue;

      const title = link.getAttribute("title") || "";
      const url = resolveUrl(href);
      if (url) {
        results.push({ url, title, source: "link" });
      }
    }
    return results;
  }

  /** 从 <a> 标签中检测常见的 feed 链接 */
  function detectFromAnchors(): DetectedFeed[] {
    const feedPatterns = [
      /\/feed\/?$/i,
      /\/rss\/?$/i,
      /\/atom\/?$/i,
      /\/rss\.xml$/i,
      /\/atom\.xml$/i,
      /\/feed\.xml$/i,
      /\/index\.xml$/i,
      /\/feeds?\//i,
      /[?&]format=rss/i,
      /[?&]format=atom/i,
    ];

    const anchors = document.querySelectorAll("a[href]");
    const results: DetectedFeed[] = [];
    const seen = new Set<string>();

    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href) continue;

      const matched = feedPatterns.some((p) => p.test(href));
      if (!matched) continue;

      const url = resolveUrl(href);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const title = (a.textContent?.trim().slice(0, 80)) || "";
      results.push({ url, title, source: "anchor" });
    }
    return results;
  }

  /**
   * 检测当前页面是否包含文章列表内容
   */
  function detectPageArticles(): PageArticlesResult {
    const seen = new Set<string>();
    const titles: string[] = [];

    function addCandidate(link: string, title: string): void {
      if (!link || !title || title.length < 4 || seen.has(link)) return;
      if (!isSameOrigin(link)) return;
      // 排除非文章链接
      try {
        const path = new URL(link).pathname;
        if (path === "/" || !path) return;
        if (/^\/(about|contact|tag|category|author|page|search|login|signup|register|privacy|terms|faq)\b/i.test(path)) return;
        if (/\.(png|jpg|gif|svg|pdf|zip|css|js)$/i.test(path)) return;
      } catch { return; }
      seen.add(link);
      titles.push(title.slice(0, 80));
    }

    // 策略 1：<article> 元素
    const articles = document.querySelectorAll("article");
    for (const article of articles) {
      const a = article.querySelector("h1 a, h2 a, h3 a, h4 a, a[href]") as HTMLAnchorElement | null;
      if (!a) continue;
      const heading = article.querySelector("h1, h2, h3, h4");
      const title = heading ? (heading.textContent || "").trim() : (a.textContent || "").trim();
      addCandidate(resolveUrl(a.href), title);
    }

    // 策略 2：标题中的链接 h1-h4 > a
    if (titles.length < 3) {
      const headingLinks = document.querySelectorAll("h1 a[href], h2 a[href], h3 a[href], h4 a[href]");
      for (const a of headingLinks) {
        const heading = a.closest("h1, h2, h3, h4");
        const title = heading ? (heading.textContent || "").trim() : (a.textContent || "").trim();
        addCandidate(resolveUrl((a as HTMLAnchorElement).href), title);
      }
    }

    // 策略 3：卡片式链接 a:has(h1-h4)
    if (titles.length < 3) {
      try {
        const cardLinks = document.querySelectorAll(
          "a[href]:has(h1), a[href]:has(h2), a[href]:has(h3), a[href]:has(h4)"
        );
        for (const a of cardLinks) {
          const heading = a.querySelector("h1, h2, h3, h4");
          const title = heading ? (heading.textContent || "").trim() : "";
          addCandidate(resolveUrl((a as HTMLAnchorElement).href), title);
        }
      } catch { /* :has() 可能不被支持 */ }
    }

    // 策略 4：常见容器中的链接
    if (titles.length < 3) {
      const containerSelectors = [
        "main", "[role='main']",
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
        const links = container.querySelectorAll("a[href]");
        for (const a of links) {
          const text = (a.textContent || "").trim();
          if (text.length >= 8 && text.length <= 200) {
            addCandidate(resolveUrl((a as HTMLAnchorElement).href), text);
          }
        }
      }
    }

    // 策略 5：全页面启发式 — 链接文本看起来像文章标题
    if (titles.length < 3) {
      const allLinks = document.querySelectorAll("a[href]");
      for (const a of allLinks) {
        const href = resolveUrl((a as HTMLAnchorElement).href);
        if (!href) continue;
        try {
          const path = new URL(href).pathname;
          // URL 含日期或博客路径
          const looksLikeArticle =
            /\/\d{4}\/\d{1,2}(\/\d{1,2})?/.test(href) ||
            /\d{4}-\d{2}-\d{2}/.test(href) ||
            /\/(blogs?|posts?|articles?|news|stories|writing|journal)(\/|$)/i.test(path);
          if (!looksLikeArticle) continue;
        } catch { continue; }

        const heading = a.querySelector("h1, h2, h3, h4");
        const text = heading ? (heading.textContent || "").trim() : (a.textContent || "").trim();
        if (text.length >= 4 && text.length <= 200) {
          addCandidate(href, text);
        }
      }
    }

    return {
      hasArticles: titles.length >= 2,
      articleCount: titles.length,
      sampleTitles: titles.slice(0, 5),
    };
  }

  /** 将相对路径转为绝对路径 */
  function resolveUrl(href: string): string {
    try {
      return new URL(href, document.location.href).href;
    } catch {
      return "";
    }
  }

  /** 同源检测 */
  function isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  }

  /** 去重合并 */
  function dedup(feeds: DetectedFeed[]): DetectedFeed[] {
    const map = new Map<string, DetectedFeed>();
    for (const f of feeds) {
      if (!map.has(f.url)) {
        map.set(f.url, f);
      } else if (f.title && !map.get(f.url)!.title) {
        map.set(f.url, f);
      }
    }
    return [...map.values()];
  }

  // ── 响应来自 popup 的检测请求 ──────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "detect-feeds") {
      const linkFeeds = detectFromLinkTags();
      const anchorFeeds = detectFromAnchors();
      const all = dedup([...linkFeeds, ...anchorFeeds]);
      const pageArticles = detectPageArticles();
      sendResponse({
        feeds: all,
        pageUrl: location.href,
        pageTitle: document.title,
        pageArticles,
      });
    }
  });
})();
