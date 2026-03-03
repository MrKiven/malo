/**
 * AI 总结独立窗口 — 入口
 *
 * 从 URL 参数中读取文章信息，协调总结、UI、聊天模块
 * 独立于 popup 运行，不受 popup 关闭影响
 */

import { getTheme } from "../services/storage";
import { makeSummary } from "../utils/format";
import { initChat } from "./chat";
import { doSummarize, type ArticleData, type SummarizeElements, type SummarizeState } from "./summarize";
import { doCopy, doClose } from "./ui";

// ── DOM 引用 ──────────────────────────────────────

const articleTitleEl  = document.getElementById("article-title");
const articleDescEl   = document.getElementById("article-desc");
const articleLinkEl   = document.getElementById("article-link") as HTMLAnchorElement | null;
const articleLinkText = document.getElementById("article-link-text");
const panelBodyEl     = document.getElementById("panel-body")!;
const loadingEl       = document.getElementById("ai-loading")!;
const loadingTextEl   = document.getElementById("ai-loading-text")!;
const resultEl        = document.getElementById("ai-result")!;
const errorEl         = document.getElementById("ai-error")!;
const errorTextEl     = document.getElementById("ai-error-text")!;
const placeholderEl   = document.getElementById("ai-placeholder")!;
const startBtn        = document.getElementById("ai-start") as HTMLButtonElement;
const retryBtn        = document.getElementById("ai-retry") as HTMLButtonElement;
const stopBtn         = document.getElementById("ai-stop") as HTMLButtonElement;
const copyBtn         = document.getElementById("ai-copy") as HTMLButtonElement;
const copyTextEl      = document.getElementById("copy-text");
const progressBarEl   = document.getElementById("ai-progress-bar");
const requestDetailsEl = document.getElementById("request-details") as HTMLDetailsElement | null;
const requestContentEl = document.getElementById("request-content");
const closeBtn         = document.getElementById("ai-close");

// ── 状态 ──────────────────────────────────────────

let articleData: ArticleData | null = null;

const state: SummarizeState = {
  abortController: null,
  lastAIResponse: "",
  articleContent: "",
  userScrolledUp: false,
};

// ── 初始化 ─────────────────────────────────────────

init();

async function init(): Promise<void> {
  // 同步主题
  const theme = await getTheme();
  document.documentElement.setAttribute("data-theme", theme);

  // 从 URL 参数读取文章信息
  const params = new URLSearchParams(window.location.search);
  const title = params.get("title") || params.get("link") || "(无标题)";
  const link = params.get("link") || "";
  const description = params.get("desc") || "";
  const mode = params.get("mode") || "article";
  const tabId = params.get("tabId") ? parseInt(params.get("tabId")!, 10) : null;

  articleData = { title, link, description, mode, tabId };

  // 设置标题
  articleTitleEl!.textContent = title;
  articleTitleEl!.title = title;
  document.title = `AI 解读 - ${title}`;

  // 设置简介（复用文章列表的 makeSummary 保持一致）
  const summary = makeSummary(description || "");
  if (summary && articleDescEl) {
    articleDescEl.textContent = summary;
    articleDescEl.title = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } else if (articleDescEl) {
    articleDescEl.style.display = "none";
  }

  // 设置链接
  if (link) {
    articleLinkEl!.href = link;
    articleLinkText!.textContent = link;
    articleLinkEl!.title = link;
  } else if (articleLinkEl) {
    articleLinkEl.style.display = "none";
  }

  // 绑定按钮事件
  const els = getElements();
  startBtn?.addEventListener("click", () => doSummarize(articleData!, els, state));
  retryBtn?.addEventListener("click", () => doSummarize(articleData!, els, state));
  stopBtn.addEventListener("click", () => {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
  });
  copyBtn.addEventListener("click", () => doCopy(state.lastAIResponse, resultEl, copyBtn, copyTextEl));
  closeBtn?.addEventListener("click", () => doClose(state.abortController));

  // 初始化聊天模块
  initChat({
    panelBodyEl,
    chatInput: document.getElementById("chat-input") as HTMLTextAreaElement | null,
    chatSendBtn: document.getElementById("chat-send") as HTMLButtonElement | null,
    chatStopBtn: document.getElementById("chat-stop") as HTMLButtonElement | null,
    chatInputWrap: document.getElementById("chat-input-wrap"),
    chatQuickChips: document.getElementById("chat-quick-chips"),
    progressBarEl,
    getArticleData: () => articleData,
    getArticleContent: () => state.articleContent,
    getLastAIResponse: () => state.lastAIResponse,
    getUserScrolledUp: () => state.userScrolledUp,
    setUserScrolledUp: (v) => { state.userScrolledUp = v; },
  });

  // 检测用户是否主动上滚（停止自动滚到底部）
  panelBodyEl.addEventListener("scroll", () => {
    if (!document.body.classList.contains("streaming")) return;
    const { scrollTop, scrollHeight, clientHeight } = panelBodyEl;
    // 距底部超过 60px 认为用户主动上滚
    state.userScrolledUp = scrollHeight - scrollTop - clientHeight > 60;
  });
}

function getElements(): SummarizeElements {
  return {
    placeholderEl,
    loadingEl,
    loadingTextEl,
    resultEl,
    errorEl,
    errorTextEl,
    startBtn,
    retryBtn,
    copyBtn,
    stopBtn,
    panelBodyEl,
    progressBarEl,
    requestDetailsEl,
    requestContentEl,
  };
}
