/**
 * AI 面板 UI 操作
 *
 * 复制内容、关闭窗口、确认弹窗、请求详情展示等
 */

import type { ChatMessage } from "../types";
import { escapeHtml } from "./markdown";

// ── 复制内容 ────────────────────────────────────────────

export async function doCopy(
  lastAIResponse: string,
  resultEl: HTMLElement,
  copyBtn: HTMLButtonElement | null,
  copyTextEl: HTMLElement | null,
): Promise<void> {
  // 复制 AI 返回的原始文本
  const text = lastAIResponse || resultEl.innerText || resultEl.textContent || "";
  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  if (copyTextEl) copyTextEl.textContent = "已复制 ✓";
  copyBtn?.classList.add("copied");
  setTimeout(() => {
    if (copyTextEl) copyTextEl.textContent = "复制内容";
    copyBtn?.classList.remove("copied");
  }, 2000);
}

// ── 关闭窗口 ────────────────────────────────────────────

export function doClose(abortController: AbortController | null): void {
  const isStreaming = document.body.classList.contains("streaming");
  if (isStreaming) {
    showConfirm("AI 正在生成内容，确定要关闭窗口吗？").then((ok) => {
      if (!ok) return;
      if (abortController) {
        abortController.abort();
      }
      window.close();
    });
  } else {
    window.close();
  }
}

// ── 自定义确认弹窗（非阻塞）─────────────────────────────

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay   = document.getElementById("confirm-overlay");
    const msgEl     = document.getElementById("confirm-message");
    const okBtn     = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    if (!overlay) { resolve(confirm(message)); return; }

    msgEl!.textContent = message;
    overlay.classList.add("show");

    function cleanup(result: boolean): void {
      overlay!.classList.remove("show");
      okBtn?.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn?.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
  });
}

// ── 展示发送给模型的内容 ─────────────────────────────────

export function showRequestDetails(
  messages: ChatMessage[],
  model: string,
  url: string,
  requestContentEl: HTMLElement | null,
): void {
  if (!requestContentEl) return;

  let html = "";
  html += `<div class="request-meta">`;
  html += `<span class="request-meta-label">模型</span><span class="request-meta-value">${escapeHtml(model)}</span>`;
  html += `<span class="request-meta-label">接口</span><span class="request-meta-value">${escapeHtml(url)}</span>`;
  html += `</div>`;

  for (const msg of messages) {
    const roleLabel = msg.role === "system" ? "System Prompt" : "User Message";
    const roleClass = msg.role === "system" ? "system" : "user";
    html += `<details class="request-message request-message--${roleClass}">`;
    html += `<summary class="request-message-role"><span class="request-message-role-text">${roleLabel}</span><span class="request-message-arrow"></span></summary>`;
    html += `<pre class="request-message-content">${escapeHtml(msg.content)}</pre>`;
    html += `</details>`;
  }

  // 预留模型返回区域（流式完成后填充）
  html += `<details class="request-message request-message--assistant" id="response-message" style="display:none;">`;
  html += `<summary class="request-message-role"><span class="request-message-role-text">Assistant Response</span><span class="request-message-arrow"></span></summary>`;
  html += `<pre class="request-message-content" id="response-message-content"></pre>`;
  html += `</details>`;

  requestContentEl.innerHTML = html;
  // 先不显示，等解读完成后再展示
}

export function appendResponseDetails(fullText: string): void {
  const responseEl = document.getElementById("response-message");
  const responseContentEl = document.getElementById("response-message-content");
  if (!responseEl || !responseContentEl || !fullText) return;

  responseContentEl.textContent = fullText;
  responseEl.style.display = "block";
}
