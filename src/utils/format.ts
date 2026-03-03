/**
 * 格式化工具函数
 *
 * 提供时间格式化、URL 美化、HTML 摘要提取等通用格式化功能
 */

import type { FeedType } from "../types";

/**
 * 相对时间：刚刚 / N分钟前 / N小时前 / N天前 / 具体日期
 */
export function relativeTime(ts: number): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "刚刚";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatFullDate(t);
}

/**
 * 格式化为完整日期：YYYY-MM-DD
 */
export function formatFullDate(ts: number): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 格式化为时间（含秒，仅秒不为 0 时显示）
 */
export function formatTimeWithSeconds(ts: number): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = d.getSeconds();
  if (s > 0) {
    return `${h}:${m}:${String(s).padStart(2, "0")}`;
  }
  return `${h}:${m}`;
}

/**
 * 格式化为完整日期时间：YYYY-MM-DD HH:MM
 */
export function formatFullDateTime(ts: number): string {
  const date = formatFullDate(ts);
  if (!date) return "";
  const t = Number(ts);
  const d = new Date(t);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const time = `${h}:${m}`;
  return `${date} ${time}`;
}

/**
 * 提取 URL 的主机名（去除 www 前缀）
 */
export function extractHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 美化 URL 显示（主机名 + 路径）
 */
export function prettifyUrl(u: string): string {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname === "/" ? "" : url.pathname;
    return host + path;
  } catch {
    return u;
  }
}

/**
 * 源类型的显示标签映射
 */
export const FEED_TYPE_LABELS: Record<string, string> = {
  rss: "RSS",
  page: "网页",
  "page-js": "JS网页",
  unknown: "?",
};

/**
 * 获取源类型的中文标签
 */
export function feedTypeLabel(type: FeedType | string): string {
  return FEED_TYPE_LABELS[type] || "";
}

/**
 * 从 HTML 中提取纯文本摘要
 */
export function makeSummary(html: string, maxLength = 120): string {
  const text = String(html || "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length <= 3) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}
