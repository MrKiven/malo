/**
 * AI 面板 — 聊天问答模块
 *
 * 处理 AI 总结后的多轮对话交互
 */

import { chatWithAI } from "../services/ai";
import { getAIConfig } from "../services/storage";
import type { ChatMessage } from "../types";
import { renderMarkdown, escapeHtml } from "./markdown";

// ── 外部依赖（由 init 注入）─────────────────────────

interface ChatDeps {
  panelBodyEl: HTMLElement;
  chatInput: HTMLTextAreaElement | null;
  chatSendBtn: HTMLButtonElement | null;
  chatStopBtn: HTMLButtonElement | null;
  chatInputWrap: HTMLElement | null;
  chatQuickChips: HTMLElement | null;
  progressBarEl: HTMLElement | null;
  getArticleData: () => { title: string } | null;
  getArticleContent: () => string;
  getLastAIResponse: () => string;
  getUserScrolledUp: () => boolean;
  setUserScrolledUp: (v: boolean) => void;
}

let deps: ChatDeps;

/** 聊天消息历史 */
let chatMessages: ChatMessage[] = [];
/** 聊天中止控制器 */
let chatAbortController: AbortController | null = null;

// ── 初始化 ──────────────────────────────────────────

/**
 * 初始化聊天模块（注入 DOM 引用和状态访问器）
 */
export function initChat(d: ChatDeps): void {
  deps = d;

  // 输入法合成状态
  let isComposing = false;
  deps.chatInput?.addEventListener("compositionstart", () => { isComposing = true; });
  deps.chatInput?.addEventListener("compositionend", () => { isComposing = false; });
  deps.chatInput?.addEventListener("input", () => {
    if (deps.chatSendBtn) deps.chatSendBtn.disabled = !deps.chatInput!.value.trim();
    autoResizeTextarea();
  });
  deps.chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      if (deps.chatInput!.value.trim()) doChat();
    }
  });
  deps.chatSendBtn?.addEventListener("click", () => doChat());
  deps.chatStopBtn?.addEventListener("click", () => {
    if (chatAbortController) {
      chatAbortController.abort();
      chatAbortController = null;
    }
  });

  // 快捷提问 chips
  deps.chatQuickChips?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest(".chip") as HTMLElement | null;
    if (!chip || deps.chatInput?.disabled) return;
    const question = chip.dataset.q;
    if (question && deps.chatInput) {
      deps.chatInput.value = question;
      doChat();
    }
  });
}

// ── 对外接口 ──────────────────────────────────────────

/**
 * 重置聊天状态（新一轮总结时调用）
 */
export function resetChat(): void {
  chatMessages = [];
  deps.panelBodyEl.querySelectorAll(".chat-bubble-wrap, .chat-divider").forEach((el) => el.remove());
  if (deps.chatInputWrap) deps.chatInputWrap.style.display = "none";
}

/**
 * 显示聊天输入区域（总结完成后调用）
 */
export function showChatInput(): void {
  if (!deps.chatInputWrap) return;
  deps.chatInputWrap.style.display = "flex";
  if (deps.chatInput) deps.chatInput.value = "";
  if (deps.chatSendBtn) deps.chatSendBtn.disabled = true;
  autoResizeTextarea();
  // 显示快捷 chips
  if (deps.chatQuickChips) deps.chatQuickChips.style.display = "flex";
  // 添加分隔线标记
  if (!deps.panelBodyEl.querySelector(".chat-divider")) {
    const divider = document.createElement("div");
    divider.className = "chat-divider";
    divider.innerHTML = '<span class="chat-divider-line"></span><span class="chat-divider-text">继续提问</span><span class="chat-divider-line"></span>';
    deps.panelBodyEl.appendChild(divider);
  }
  // 自动聚焦
  setTimeout(() => deps.chatInput?.focus(), 100);
}

// ── 内部逻辑 ──────────────────────────────────────────

function autoResizeTextarea(): void {
  if (!deps.chatInput) return;
  deps.chatInput.style.height = "auto";
  deps.chatInput.style.height = Math.min(deps.chatInput.scrollHeight, 120) + "px";
}

/** 创建聊天气泡并追加到面板 */
function appendChatBubble(role: "user" | "assistant", text: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `chat-bubble-wrap chat-bubble--${role}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  const label = document.createElement("div");
  label.className = "chat-bubble-label";
  label.textContent = role === "user" ? "你" : "AI";

  const content = document.createElement("div");
  content.className = "chat-bubble-content";
  if (role === "user") {
    content.textContent = text;
  } else {
    content.innerHTML = text ? renderMarkdown(text) : "";
  }

  bubble.append(label, content);
  wrap.appendChild(bubble);
  deps.panelBodyEl.appendChild(wrap);

  // 自动滚到底部
  deps.panelBodyEl.scrollTop = deps.panelBodyEl.scrollHeight;

  return content;
}

async function doChat(): Promise<void> {
  const question = deps.chatInput?.value.trim() || "";
  if (!question) return;

  // 清空输入框
  if (deps.chatInput) deps.chatInput.value = "";
  if (deps.chatSendBtn) deps.chatSendBtn.disabled = true;
  autoResizeTextarea();

  // 隐藏快捷 chips（提问后不再需要）
  if (deps.chatQuickChips) deps.chatQuickChips.style.display = "none";

  // 显示用户消息气泡
  appendChatBubble("user", question);

  // 创建 AI 回复气泡
  const aiContent = appendChatBubble("assistant", "");
  aiContent.classList.add("streaming");

  // 切换按钮状态
  if (deps.chatSendBtn) deps.chatSendBtn.style.display = "none";
  if (deps.chatStopBtn) deps.chatStopBtn.style.display = "inline-flex";
  if (deps.chatInput) deps.chatInput.disabled = true;

  // 进度条
  if (deps.progressBarEl) {
    deps.progressBarEl.classList.remove("done");
    deps.progressBarEl.classList.add("active");
  }

  chatAbortController = new AbortController();

  try {
    // 构建上下文消息
    const articleContent = deps.getArticleContent();
    const lastAIResponse = deps.getLastAIResponse();
    const articleData = deps.getArticleData();

    const aiConfig = await getAIConfig();
    const maxLen = aiConfig.maxContentLength || 80000;
    const truncatedContent = articleContent.length > maxLen
      ? articleContent.slice(0, maxLen) + "\n\n[内容已截断...]"
      : articleContent;

    const systemMsg: ChatMessage = {
      role: "system",
      content: `你是一位简洁高效的阅读助手。基于下方文章回答用户问题。

要求：直接回答问题，不要寒暄、不要重复问题、不要总结性开头（如"根据文章…"）。言简意赅，每句话都要有信息量。需要时引用文章中的具体数据或案例。中文回答，专有名词保留原文。超出文章范围的内容简短标注即可。

文章标题：${articleData?.title || "未知"}
${lastAIResponse ? `\nAI 解读摘要：\n${lastAIResponse}\n` : ""}
文章原文：
${truncatedContent}`,
    };

    // 拼接历史消息
    const messages: ChatMessage[] = [systemMsg, ...chatMessages, { role: "user", content: question }];

    deps.setUserScrolledUp(false);
    let fullResponse = "";

    fullResponse = await chatWithAI(messages, {
      signal: chatAbortController.signal,
      onChunk: (_delta, fullText) => {
        aiContent.innerHTML = renderMarkdown(fullText);
        if (!deps.getUserScrolledUp()) {
          deps.panelBodyEl.scrollTop = deps.panelBodyEl.scrollHeight;
        }
      },
    });

    // 保存到历史
    chatMessages.push({ role: "user", content: question });
    chatMessages.push({ role: "assistant", content: fullResponse });

    // 限制历史长度（保留最近 10 轮对话 = 20 条消息）
    if (chatMessages.length > 20) {
      chatMessages = chatMessages.slice(-20);
    }

    aiContent.classList.remove("streaming");
  } catch (e) {
    aiContent.classList.remove("streaming");
    if ((e as Error).name === "AbortError") {
      if (!aiContent.innerHTML) {
        aiContent.innerHTML = '<span class="chat-stopped">已停止生成</span>';
      }
    } else {
      aiContent.innerHTML = `<span class="chat-error">出错了：${escapeHtml((e as Error).message)}</span>`;
    }
  } finally {
    chatAbortController = null;
    if (deps.chatStopBtn) deps.chatStopBtn.style.display = "none";
    if (deps.chatSendBtn) deps.chatSendBtn.style.display = "inline-flex";
    if (deps.chatInput) {
      deps.chatInput.disabled = false;
      deps.chatInput.focus();
    }

    // 隐藏进度条
    if (deps.progressBarEl) {
      deps.progressBarEl.classList.remove("active");
      deps.progressBarEl.classList.add("done");
    }
  }
}
