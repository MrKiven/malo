/**
 * AI 总结核心逻辑
 *
 * 处理文章内容获取和 AI 流式总结
 */

import { summarizeArticle } from "../services/ai";
import { fetchArticleContent, fetchPdfContent, isPdfUrl } from "../services/content";
import { renderMarkdown } from "./markdown";
import { showRequestDetails, appendResponseDetails } from "./ui";
import { resetChat, showChatInput } from "./chat";
import { platform } from "../platform";

// ── 类型 ─────────────────────────────────────────────

export interface ArticleData {
  title: string;
  link: string;
  description: string;
  mode: string;
  tabId: number | null;
}

export interface SummarizeElements {
  placeholderEl: HTMLElement;
  loadingEl: HTMLElement;
  loadingTextEl: HTMLElement;
  resultEl: HTMLElement;
  errorEl: HTMLElement;
  errorTextEl: HTMLElement;
  startBtn: HTMLButtonElement;
  retryBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  panelBodyEl: HTMLElement;
  progressBarEl: HTMLElement | null;
  requestDetailsEl: HTMLDetailsElement | null;
  requestContentEl: HTMLElement | null;
}

export interface SummarizeState {
  abortController: AbortController | null;
  lastAIResponse: string;
  articleContent: string;
  userScrolledUp: boolean;
}

// ── AI 总结 ─────────────────────────────────────────

export async function doSummarize(
  articleData: ArticleData,
  els: SummarizeElements,
  state: SummarizeState,
): Promise<void> {
  const {
    placeholderEl, loadingEl, loadingTextEl, resultEl, errorEl, errorTextEl,
    startBtn, retryBtn, copyBtn, stopBtn, panelBodyEl, progressBarEl,
    requestDetailsEl, requestContentEl,
  } = els;

  // 重置 UI
  placeholderEl.style.display = "none";
  loadingEl.style.display = "flex";
  resultEl.innerHTML = "";
  resultEl.classList.remove("streaming");
  errorEl.classList.remove("show");
  errorTextEl.textContent = "";
  startBtn.style.display = "none";
  retryBtn.style.display = "none";
  copyBtn.style.display = "none";
  stopBtn.style.display = "inline-flex";
  document.body.classList.remove("streaming");

  // 重置请求详情
  if (requestDetailsEl) {
    requestDetailsEl.style.display = "none";
    requestDetailsEl.removeAttribute("open");
  }

  // 显示进度条
  if (progressBarEl) {
    progressBarEl.classList.remove("done");
    progressBarEl.classList.add("active");
  }

  // 移除旧的字数统计
  const oldWordCount = panelBodyEl.querySelector(".word-count");
  if (oldWordCount) oldWordCount.remove();

  // 中止之前的请求
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  try {
    // 1) 获取文章内容
    const linkUrl = articleData.link || "";
    const isPdf = isPdfUrl(linkUrl);

    loadingTextEl.textContent = isPdf
      ? "正在提取 PDF 内容…"
      : articleData.mode === "page"
        ? "正在提取网页内容…"
        : "正在获取文章内容…";

    let content = "";

    if (isPdf && linkUrl) {
      // PDF 模式：直接 fetch PDF 并用 PDF.js 提取文本
      try {
        content = await fetchPdfContent(linkUrl);
      } catch { /* ignore, will check below */ }
    } else if (articleData.mode === "page" && articleData.tabId) {
      // 网页模式：通过注入脚本提取当前页面正文
      try {
        content = await extractPageContent(articleData.tabId!);
      } catch {
        // 注入失败，回退到 fetch 抓取
        if (linkUrl) {
          try {
            content = await fetchArticleContent(linkUrl);
          } catch { /* ignore */ }
        }
      }
    } else {
      // RSS 文章模式
      if (articleData.description && articleData.description.length > 200) {
        content = articleData.description
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      if (!content || content.length < 100) {
        if (articleData.link) {
          try {
            content = await fetchArticleContent(articleData.link);
          } catch {
            if (!content) {
              content = [articleData.title, articleData.description || ""].join("\n\n")
                .replace(/<[^>]+>/g, " ")
                .replace(/&[a-z]+;/gi, " ")
                .replace(/\s+/g, " ")
                .trim();
            }
          }
        }
      }
    }

    if (!content || content.length < 20) {
      throw new Error("文章内容过少，无法进行有效分析");
    }

    // 保存文章内容供后续问答使用
    state.articleContent = content;
    // 重置聊天历史
    resetChat();

    // 2) 调用 AI 总结
    loadingTextEl.textContent = "AI 正在分析文章…";

    // 开始 streaming
    document.body.classList.add("streaming");
    let totalChars = 0;

    state.lastAIResponse = "";
    state.userScrolledUp = false;
    const fullResponse = await summarizeArticle(content, {
      signal: state.abortController!.signal,
      onRequest: ({ messages, model, url }) => {
        showRequestDetails(messages, model, url, requestContentEl);
      },
      onChunk: (_delta, fullText) => {
        loadingEl.style.display = "none";
        resultEl.classList.add("streaming");
        resultEl.innerHTML = renderMarkdown(fullText);
        totalChars = fullText.length;
        if (!state.userScrolledUp) {
          panelBodyEl.scrollTop = panelBodyEl.scrollHeight;
        }
      },
    });

    // 保存原始回复文本
    state.lastAIResponse = fullResponse;

    // 把模型返回内容追加到请求详情中，并展示详情区域
    appendResponseDetails(fullResponse);
    if (requestDetailsEl) requestDetailsEl.style.display = "block";

    // 完成
    resultEl.classList.remove("streaming");
    document.body.classList.remove("streaming");

    // 隐藏进度条
    if (progressBarEl) {
      progressBarEl.classList.remove("active");
      progressBarEl.classList.add("done");
    }

    // 显示字数统计
    if (totalChars > 0) {
      const wordCountEl = document.createElement("div");
      wordCountEl.className = "word-count";
      wordCountEl.textContent = `共 ${totalChars} 字`;
      resultEl.after(wordCountEl);
    }

    stopBtn.style.display = "none";
    retryBtn.style.display = "inline-flex";
    copyBtn.style.display = "inline-flex";

    // 显示聊天输入框
    showChatInput();
  } catch (e) {
    const err = e as Error;
    loadingEl.style.display = "none";
    stopBtn.style.display = "none";
    resultEl.classList.remove("streaming");
    document.body.classList.remove("streaming");

    // 隐藏进度条
    if (progressBarEl) {
      progressBarEl.classList.remove("active");
      progressBarEl.classList.add("done");
    }

    if (err.name === "AbortError") {
      retryBtn.style.display = "inline-flex";
      if (resultEl.innerHTML) {
        copyBtn.style.display = "inline-flex";
      }
      if (!resultEl.innerHTML) {
        errorTextEl.textContent = "已停止生成";
        errorEl.classList.add("show");
      }
    } else {
      errorTextEl.textContent = err.message || "AI 分析失败";
      errorEl.classList.add("show");
      retryBtn.style.display = "inline-flex";
    }
  } finally {
    state.abortController = null;
  }
}

// ── 提取页面内容（注入脚本） ───────────────────────────

async function extractPageContent(tabId: number): Promise<string> {
  if (platform.isElectron) {
    throw new Error("桌面版暂不支持提取当前页面内容");
  }

  const results = await platform.scripting.executeScript({
    target: { tabId },
    func: () => {
      const removeTags = ["script", "style", "noscript", "nav", "footer", "header", "aside", "iframe"];
      const clone = document.cloneNode(true) as Document;
      removeTags.forEach(tag => {
        clone.querySelectorAll(tag).forEach((el: Element) => el.remove());
      });

      const main = clone.querySelector("article")
        || clone.querySelector("main")
        || clone.querySelector("[role=main]")
        || clone.querySelector(".post-content, .article-content, .entry-content, .content")
        || clone.body;

      const text = (main as HTMLElement || clone.body).innerText || "";
      return text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
    },
  });

  const text = results?.[0]?.result || "";
  if (!text || (typeof text === "string" && text.length < 30)) {
    throw new Error("页面内容提取失败");
  }
  return text as string;
}
