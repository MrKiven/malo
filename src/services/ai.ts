/**
 * AI 服务模块
 *
 * 支持 OpenAI 兼容的 API（OpenAI、DeepSeek、Moonshot 等）
 * 提供文章总结与解读功能
 */

import type { SummarizeOptions, ChatOptions, ChatMessage } from "../types";
import { getAIConfig } from "./storage";

// ── SSE 流式解析（通用）──────────────────────────────

type OnChunk = (delta: string, fullText: string) => void;

/**
 * 发起 OpenAI 兼容的流式请求并解析 SSE
 */
async function streamChatRequest(options: {
  apiKey: string;
  baseUrl: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  onChunk?: OnChunk;
}): Promise<string> {
  const { apiKey, baseUrl, body, signal, onChunk } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    let errorMsg = `AI 请求失败 (HTTP ${res.status})`;
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.error?.message) {
        errorMsg = errorJson.error.message;
      }
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  return readSSEStream(res, onChunk);
}

/**
 * 从 SSE 响应流中逐块读取内容
 */
async function readSSEStream(
  res: Response,
  onChunk?: OnChunk
): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") break;

      try {
        const json = JSON.parse(data);
        const delta: string | undefined = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk?.(delta, fullText);
        }
      } catch { /* skip malformed JSON */ }
    }
  }

  return fullText;
}

// ── 文章总结 ──────────────────────────────────────────

/**
 * 调用 AI API 进行文章总结（SSE 流式）
 */
export async function summarizeArticle(
  content: string,
  options: SummarizeOptions = {}
): Promise<string> {
  const config = await getAIConfig();

  if (!config.apiKey) {
    throw new Error("请先在设置中配置 AI API Key");
  }

  const { signal, onChunk, onRequest } = options;

  const defaultPrompt = `你是一位具备深度分析能力的阅读助手。你的任务不是简单复述文章，而是帮读者真正理解文章在说什么、为什么这么说、有什么意义。每句话都必须有实质信息，杜绝套话和水分。

输出结构：

> 一句话点明文章最核心的主张或发现（必须具体，包含关键数据/结论，不要泛泛而谈）

### 📝 这篇文章讲了什么
用 3-5 句话还原文章的完整逻辑链：作者发现了什么问题/现象 → 用什么证据或论证 → 得出什么结论 → 这件事为什么重要。重点保留文中的具体数据、案例、实验结果和关键引用。

### 🔍 深度解读
逐一分析文章中最有价值的 2-4 个核心论点或发现：
- **论点/发现** — 展开解释这个观点的具体内容、支撑它的证据是什么、它的推理逻辑是否成立。如果涉及技术方案/方法论，说明其原理和实际效果。保留原文中的关键数据、对比、因果关系。

### 🤔 批判性思考
- 文章的论证有哪些强项和弱项？是否有未充分论证的跳跃？
- 作者的立场和潜在偏见是什么？有没有被忽略的反面观点？
- 这个结论在什么条件下成立，什么条件下可能不成立？
（2-3 条即可，没有值得质疑的点就不写这一节）

### 💡 启发与关联
- 这篇文章对读者有什么实际启示？能指导什么决策或行动？
- 与当前行业/领域的哪些趋势或争论相关？
（1-3 条，言之有物即可）

要求：
- 中文输出，专有名词保留原文。
- 严格基于原文内容分析，不编造信息。可以做合理推断但需标注。
- 避免"本文介绍了…""作者认为…"等机械化开头，直接切入内容。
- 如果文章内容过少或质量太低，直接说明，不强行分析。`;

  const systemPrompt = config.prompt || defaultPrompt;

  const maxLen = config.maxContentLength || 80000;
  const truncated = content.length > maxLen ? content.slice(0, maxLen) + "\n\n[内容已截断...]" : content;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `请深度解读以下文章。重点分析其核心论点的逻辑链条、关键证据与数据，并给出你的批判性思考：\n\n${truncated}` },
  ];

  const model = config.model || "gpt-4o-mini";
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";

  // 通知调用方发送的请求内容
  onRequest?.({ messages, model, url: `${baseUrl.replace(/\/+$/, "")}/chat/completions` });

  return streamChatRequest({
    apiKey: config.apiKey,
    baseUrl,
    body: {
      model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 8192,
    },
    signal,
    onChunk,
  });
}

// ── 多轮对话 ──────────────────────────────────────────

/**
 * 调用 AI API 进行多轮对话（SSE 流式）
 */
export async function chatWithAI(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const config = await getAIConfig();

  if (!config.apiKey) {
    throw new Error("请先在设置中配置 AI API Key");
  }

  return streamChatRequest({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || "https://api.openai.com/v1",
    body: {
      model: config.model || "gpt-4o-mini",
      messages,
      temperature: Math.max(0, (config.temperature ?? 0.7) - 0.4),
      max_tokens: config.maxTokens || 8192,
    },
    signal: options.signal,
    onChunk: options.onChunk,
  });
}

// ── 文章内容抓取（已抽离到 content.ts）───────────────
export { fetchArticleContent, extractMainContent } from "./content";
