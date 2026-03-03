/**
 * HTML / XML 纯文本解析工具函数
 *
 * 基于正则，不依赖 DOMParser，可在 Service Worker 中安全使用
 * 被 parser.ts、scraper.ts 等模块复用
 *
 * ⚠️ 维护提醒：
 *  services/page-scraper.ts 中 scrapePageDOM 函数体内包含部分工具函数的自包含副本
 *  （parseDateStr, extractDateFromUrl, extractDateFromText, resolveUrl, isSameOrigin）
 *  修改这些函数逻辑时需同步更新 page-scraper.ts 中的对应副本。
 */

/**
 * 匹配所有符合正则的子串
 */
export function matchAll(source: string, regex: RegExp): string[] {
  const results: string[] = [];
  const re = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : regex.flags + "g"
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    results.push(m[0]);
  }
  return results;
}

/**
 * 去除 HTML 标签，返回纯文本
 */
export function stripTags(html: string): string {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 解析相对 URL 为绝对 URL
 */
export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
}

/**
 * 判断两个 URL 是否同源
 */
export function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

// ── 日期提取工具 ───────────────────────────────────
// ⚠️ page-scraper.ts 中有这三个函数的自包含副本（因为它通过 executeScript 注入页面，无法 import）。
//    修改日期提取逻辑时请同步更新 page-scraper.ts 中的 parseDateStr / extractDateFromUrl / extractDateFromText。

/**
 * 解析日期字符串为时间戳
 */
export function parseDate(s: string | undefined | null): number {
  const trimmed = (s || "")
    .trim()
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "");
  if (!trimmed) return 0;
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * 从 URL 中提取日期信息
 * 支持 /2024/01/15 和 2024-01-15 格式
 */
export function extractDateFromUrl(url: string): number {
  const m1 = /\/(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(url);
  if (m1) return parseDate(`${m1[1]}-${m1[2]}-${m1[3]}`);

  const m2 = /(\d{4}-\d{2}-\d{2})/.exec(url);
  if (m2) return parseDate(m2[1]);

  return 0;
}

/**
 * 从文本中提取日期
 */
export function extractDateFromText(html: string): number {
  const text = stripTags(html);
  const patterns: RegExp[] = [
    /(\d{4}-\d{1,2}-\d{1,2})/, // 2024-01-15
    /(\d{4}\/\d{1,2}\/\d{1,2})/, // 2024/01/15
    /(\w{3,9}\s+\d{1,2},?\s+\d{4})/, // Feb 28, 2026 / January 15 2024
    /(\d{1,2}\s+\w{3,9}\s+\d{4})/, // 15 January 2024 / 28 Feb 2026
    /(\w{3}\s+\d{1,2})\b/, // "Feb 04" - 短日期，补当年
    /(\d{4}年\d{1,2}月\d{1,2}日)/, // 2024年1月15日
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      let ts = parseDate(m[1]);
      if (ts > 0) return ts;
      // 短日期补年份 "Feb 04" -> "Feb 04, 2026"
      if (/^\w{3}\s+\d{1,2}$/.test(m[1])) {
        ts = parseDate(m[1] + ", " + new Date().getFullYear());
        if (ts > 0) return ts;
      }
    }
  }
  return 0;
}

/**
 * XML 反转义（处理 CDATA 和常见实体）
 */
export function unescapeXml(text: string): string {
  if (!text) return "";
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/**
 * 提取 XML/HTML 标签内文本：<tag ...>内容</tag>
 */
export function extractTagContent(source: string, tagName: string): string {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<${escaped}[\\s\\S]*?>([\\s\\S]*?)<\\/${escaped}>`,
    "i"
  );
  const m = re.exec(source);
  return (m && m[1]) || "";
}

/**
 * 提取 HTML/XML 标签的属性值
 */
export function extractAttrValue(tagStr: string, attrName: string): string {
  const re = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = re.exec(tagStr);
  return m ? unescapeXml(m[1]) : "";
}
