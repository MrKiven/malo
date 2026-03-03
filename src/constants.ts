/**
 * 全局共享常量与默认配置
 */

import type { AIConfig } from "./types";

// ── Background 抓取相关 ─────────────────────────────
export const ALARM_NAME = "rss-refresh";
export const REFRESH_MINUTES = 15;
export const REQUEST_TIMEOUT_MS = 15_000;
export const TAB_SCRAPE_TIMEOUT_MS = 20_000;
export const MAX_CONCURRENT = 3;
export const MAX_ITEMS_PER_FEED = 50;

// ── Popup 文章列表 ──────────────────────────────────
export const PAGE_SIZE = 30;

// ── AI 默认配置 ─────────────────────────────────────
export const DEFAULT_AI_CONFIG: AIConfig = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  prompt: "",
  temperature: 0.7,
  maxTokens: 8192,
  maxContentLength: 80000,
};

// ── Badge 颜色 ──────────────────────────────────────
export const BADGE_COLOR = "#4f6ef7";
