/**
 * 共享类型定义
 */

/** RSS 文章条目 */
export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  publishedAt: number;
  feedUrl?: string;
}

/** 收藏文章详情 */
export interface FavoriteDetail {
  link: string;
  title: string;
  description: string;
  feedUrl: string;
  publishedAt: number;
  favoritedAt: number;
}

/** 订阅源元信息 */
export interface FeedMeta {
  type?: FeedType;
  [key: string]: unknown;
}

/** 订阅源类型 */
export type FeedType = "rss" | "page" | "page-js" | "unknown" | "";

/** 订阅源添加结果 */
export interface AddFeedResult {
  ok: boolean;
  reason: "empty" | "invalid_url" | "exists" | "added";
}

/** 导入结果 */
export interface ImportResult {
  added: number;
  skipped: number;
  failed: number;
}

/** AI 配置 */
export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  /** 总结时的 temperature（0-2，默认 0.7） */
  temperature: number;
  /** 最大输出 token 数（默认 8192） */
  maxTokens: number;
  /** 发送给模型的最大内容字符数（默认 80000） */
  maxContentLength: number;
}

/** 检测到的 RSS 源  @sync detector/index.ts 内有同名副本 */
export interface DetectedFeed {
  url: string;
  title: string;
  source: "link" | "anchor";
}

/** 页面文章检测结果  @sync detector/index.ts 内有同名副本 */
export interface PageArticlesResult {
  hasArticles: boolean;
  articleCount: number;
  sampleTitles: string[];
}

/** Content Script 检测响应 */
export interface DetectResponse {
  feeds: DetectedFeed[];
  pageUrl: string;
  pageTitle: string;
  pageArticles: PageArticlesResult;
}

/** AI 总结选项 */
export interface SummarizeOptions {
  signal?: AbortSignal;
  onChunk?: (delta: string, fullText: string) => void;
  onRequest?: (info: { messages: ChatMessage[]; model: string; url: string }) => void;
}

/** AI 对话选项 */
export interface ChatOptions {
  signal?: AbortSignal;
  onChunk?: (delta: string, fullText: string) => void;
}

/** 对话消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
