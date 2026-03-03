/**
 * HTML 页面抓取器：从普通博客页面提取文章列表
 * 用于没有 RSS 的网站，通过启发式规则从 HTML 中提取文章链接
 *
 * 在 Service Worker 中运行，无法使用 DOMParser，全部基于正则。
 */

import type { FeedItem } from "../types";
import {
  matchAll,
  stripTags,
  resolveUrl,
  isSameOrigin,
  parseDate,
  extractDateFromUrl,
  extractDateFromText,
} from "../utils/html";

interface ScoredCandidate {
  link: string;
  title: string;
  score: number;
  description: string;
  publishedAt: number;
}

interface ScoredItem extends FeedItem {
  _score: number;
}

/**
 * 从 HTML 文本中提取文章列表
 */
export function scrapeArticles(html: string, pageUrl: string): FeedItem[] {
  const baseUrl = pageUrl;

  // 策略 1：提取 <article> 块中的链接（最高优先级）
  let articles = extractFromArticleTags(html, baseUrl);

  // 策略 2：提取 <main> 或常见内容容器中的链接
  if (articles.length === 0) {
    articles = extractFromMainContent(html, baseUrl);
  }

  // 策略 3：全页面扫描，靠启发式打分筛选
  if (articles.length === 0) {
    articles = extractByScoring(html, baseUrl);
  }

  // 去重
  const seen = new Set<string>();
  const unique: FeedItem[] = [];
  for (const a of articles) {
    if (!a.link || seen.has(a.link)) continue;
    seen.add(a.link);
    unique.push(a);
  }

  return unique.slice(0, 50);
}

// ── 策略 1：<article> 标签 ──────────────────────

function extractFromArticleTags(html: string, baseUrl: string): FeedItem[] {
  const articleBlocks = matchAll(
    html,
    /<article[\s\S]*?>[\s\S]*?<\/article>/gi
  );
  if (articleBlocks.length === 0) return [];

  return articleBlocks.map((block) => parseBlock(block, baseUrl)).filter((item): item is FeedItem => item !== null);
}

// ── 策略 2：<main> / 常见容器 ───────────────────

function extractFromMainContent(html: string, baseUrl: string): FeedItem[] {
  const mainMatch = /<main[\s\S]*?>([\s\S]*?)<\/main>/i.exec(html);
  const content = mainMatch ? mainMatch[1] : "";
  if (!content) return [];

  return extractLinksFromContent(content, baseUrl);
}

// ── 策略 3：启发式打分 ──────────────────────────

function extractByScoring(html: string, baseUrl: string): FeedItem[] {
  const allLinks = matchAll(
    html,
    /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi
  );
  const candidates: ScoredCandidate[] = [];

  for (const match of allLinks) {
    const fullMatch = match;
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(fullMatch);
    const textMatch = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(fullMatch);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const innerHtml = textMatch ? textMatch[1] : "";

    // 优先从内部 heading 获取标题（处理卡片式链接）
    const headingMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(innerHtml);
    const rawText = headingMatch
      ? stripTags(headingMatch[1]).trim()
      : stripTags(innerHtml).trim();
    const link = resolveUrl(href, baseUrl);

    if (!link || !rawText) continue;
    if (!isSameOrigin(link, baseUrl)) continue;

    // 提取摘要
    let description = "";
    if (headingMatch) {
      const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(innerHtml);
      if (pMatch) description = stripTags(pMatch[1]).trim().slice(0, 300);
    }

    const score = scoreCandidateLink(link, rawText, baseUrl);
    if (score > 0) {
      candidates.push({
        link,
        title: rawText.slice(0, 200),
        score,
        description,
        publishedAt: extractDateFromUrl(link) || extractDateFromText(innerHtml),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, 50).map((c) => ({
    id: c.link,
    title: c.title,
    link: c.link,
    description: c.description,
    publishedAt: c.publishedAt,
  }));
}

// ── 从内容块中提取链接 ──────────────────────────

function extractLinksFromContent(content: string, baseUrl: string): FeedItem[] {
  const results: FeedItem[] = [];

  const headingLinks = matchAll(
    content,
    /<h[1-6][^>]*>[\s\S]*?<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-6]>/gi
  );
  for (const m of headingLinks) {
    const parsed = parseLinkMatch(m, baseUrl);
    if (parsed) results.push(parsed);
  }

  if (results.length < 3) {
    const allLinks = extractScoredLinks(content, baseUrl);
    for (const item of allLinks) {
      if (!results.some((r) => r.link === item.link)) {
        results.push(item);
      }
    }
  }

  return results;
}

function extractScoredLinks(content: string, baseUrl: string): FeedItem[] {
  const allMatches = matchAll(
    content,
    /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi
  );
  const items: ScoredItem[] = [];

  for (const m of allMatches) {
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(m);
    const textMatch = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(m);
    if (!hrefMatch || !textMatch) continue;

    const href = hrefMatch[1];
    const text = stripTags(textMatch[1]).trim();
    const link = resolveUrl(href, baseUrl);

    if (!link || !text) continue;
    if (!isSameOrigin(link, baseUrl)) continue;

    const score = scoreCandidateLink(link, text, baseUrl);
    if (score > 0) {
      items.push({
        id: link,
        title: text.slice(0, 200),
        link,
        description: "",
        publishedAt: extractDateFromUrl(link) || extractDateFromText(m),
        _score: score,
      });
    }
  }

  items.sort((a, b) => b._score - a._score);
  return items.slice(0, 50);
}

// ── 解析单个内容块 ──────────────────────────────

function parseBlock(block: string, baseUrl: string): FeedItem | null {
  const linkMatch =
    /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/i.exec(
      block
    );
  if (!linkMatch) return null;

  const href = linkMatch[1];
  const link = resolveUrl(href, baseUrl);
  if (!link) return null;

  let title = "";
  const headingMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(block);
  if (headingMatch) {
    title = stripTags(headingMatch[1]).trim();
  }
  if (!title) {
    title = stripTags(linkMatch[2]).trim();
  }
  if (!title) return null;

  let description = "";
  const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  if (pMatch) {
    description = stripTags(pMatch[1]).trim().slice(0, 300);
  }

  let publishedAt = 0;
  const timeMatch = /<time[^>]*?datetime\s*=\s*["']([^"']+)["']/i.exec(block);
  if (timeMatch) {
    publishedAt = parseDate(timeMatch[1]);
  }
  if (!publishedAt) {
    publishedAt = extractDateFromUrl(link);
  }
  if (!publishedAt) {
    publishedAt = extractDateFromText(block);
  }

  return {
    id: link,
    title: title.slice(0, 200),
    link,
    description,
    publishedAt,
  };
}

function parseLinkMatch(matchStr: string, baseUrl: string): FeedItem | null {
  const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(matchStr);
  const textMatch = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(matchStr);
  if (!hrefMatch || !textMatch) return null;

  const link = resolveUrl(hrefMatch[1], baseUrl);
  const title = stripTags(textMatch[1]).trim();
  if (!link || !title) return null;

  return {
    id: link,
    title: title.slice(0, 200),
    link,
    description: "",
    publishedAt: extractDateFromUrl(link) || extractDateFromText(matchStr),
  };
}

// ── 打分逻辑 ────────────────────────────────────

function scoreCandidateLink(link: string, text: string, baseUrl: string): number {
  let score = 0;

  if (text.length >= 8 && text.length <= 200) score += 3;
  else if (text.length >= 4 && text.length <= 300) score += 1;
  else return 0;

  if (/\/\d{4}\/\d{1,2}(\/\d{1,2})?/.test(link)) score += 5;
  if (/\d{4}-\d{2}-\d{2}/.test(link)) score += 4;

  const parsed = new URL(link);
  const path = parsed.pathname.toLowerCase();

  if (
    /\/(blogs?|posts?|articles?|news|stories|writing|journal)(\/|$)/i.test(path)
  )
    score += 3;
  if (/\/(p|entry|entries|archive|archives|notes?)(\/|$)/i.test(path))
    score += 2;

  if (
    /^\/(about|contact|tag|category|author|page|search|login|signup|register|privacy|terms|faq)(\b|\/)/i.test(path)
  ) {
    return 0;
  }
  if (path === "/" || path === "") return 0;

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) score += 2;
  if (segments.length >= 3) score += 1;

  if (segments.some((s) => s.length > 15 && /[a-z].*-.*[a-z]/i.test(s)))
    score += 3;

  if (/\.(png|jpg|gif|svg|pdf|zip|css|js)$/i.test(path)) return 0;
  if (link.includes("#") && parsed.pathname === new URL(baseUrl).pathname)
    return 0;

  return score;
}
