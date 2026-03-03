/**
 * RSS / Atom XML 解析器（纯正则，无需 DOMParser）
 * 支持 RSS 2.0、Atom 1.0
 */

import type { FeedItem } from "../types";
import {
  matchAll,
  unescapeXml,
  extractTagContent,
  extractAttrValue,
  parseDate,
} from "../utils/html";

export function parseRssXml(xmlText: string): FeedItem[] {
  const text = String(xmlText || "").trim();
  if (!text) return [];

  // Atom 检测：含 <feed> 且含 <entry>
  if (/<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text)) {
    return parseAtom(text);
  }

  // RSS 2.0
  return parseRss2(text);
}

// ── Atom ─────────────────────────────────────────

function parseAtom(text: string): FeedItem[] {
  return matchAll(text, /<entry[\s\S]*?>[\s\S]*?<\/entry>/gi).map((xml) => {
    const link =
      extractAtomLink(xml) || unescapeXml(extractTagContent(xml, "id"));

    return {
      id: unescapeXml(extractTagContent(xml, "id")) || link,
      title:
        unescapeXml(extractTagContent(xml, "title")) || link || "(无标题)",
      link,
      description:
        unescapeXml(extractTagContent(xml, "summary")) ||
        unescapeXml(extractTagContent(xml, "content")) ||
        "",
      publishedAt: parseDate(
        extractTagContent(xml, "updated") ||
          extractTagContent(xml, "published")
      ),
    };
  });
}

/**
 * Atom 的 <link> 标签是自闭合属性形式，需要特殊处理
 * 优先取 rel="alternate" 的 href，否则取第一个 href
 */
function extractAtomLink(xml: string): string {
  const links = matchAll(xml, /<link[^>]*?\/?>/gi);
  // 优先 rel="alternate"
  for (const l of links) {
    if (/rel\s*=\s*["']alternate["']/i.test(l)) {
      const href = extractAttrValue(l, "href");
      if (href) return href;
    }
  }
  // 否则取第一个有 href 的
  for (const l of links) {
    const href = extractAttrValue(l, "href");
    if (href) return href;
  }
  return "";
}

// ── RSS 2.0 ──────────────────────────────────────

function parseRss2(text: string): FeedItem[] {
  return matchAll(text, /<item[\s\S]*?>[\s\S]*?<\/item>/gi).map((xml) => {
    const link = unescapeXml(extractTagContent(xml, "link"));
    return {
      id:
        unescapeXml(extractTagContent(xml, "guid")) ||
        link ||
        unescapeXml(extractTagContent(xml, "title")),
      title:
        unescapeXml(extractTagContent(xml, "title")) || link || "(无标题)",
      link,
      description:
        unescapeXml(extractTagContent(xml, "description")) || "",
      publishedAt: parseDate(
        extractTagContent(xml, "pubDate") ||
          extractTagContent(xml, "dc:date")
      ),
    };
  });
}
