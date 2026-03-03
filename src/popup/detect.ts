/**
 * 页面 RSS 源发现 & 网页订阅检测模块
 */

import type { DetectedFeed, PageArticlesResult } from "../types";
import { getAllFeeds, addFeed, removeFeed } from "../services/storage";
import { prettifyUrl } from "../utils/format";
import { $, showToast, triggerFetch } from "./shared";
import { refreshFeeds } from "./feeds";
import { platform } from "../platform";

const detectedSection = $("detected-section");
const detectedListEl = $("detected-list");
const detectedCountEl = $("detected-count");
const discoverDotEl = $("discover-dot");
const noDetectedEl = $("no-detected");
const pageSubSection = $("page-subscribe-section");
const pageTitleEl = $("page-title");
const pageUrlEl = $("page-url");
const pageHintEl = $("page-hint");
const pageSamplesEl = $("page-samples");
const pageSubBtn = $<HTMLButtonElement>("page-subscribe-btn");
const discoverRefreshBtn = $<HTMLButtonElement>("discover-refresh");

// ── 对外回调 ──────────────────────────────────────

let _onFeedChanged: () => Promise<void> = async () => {};

/**
 * 设置订阅变更后的回调
 */
export function onFeedChanged(fn: () => Promise<void>): void {
  _onFeedChanged = fn;
}

// ── 主动发现按钮 ──────────────────────────────────

export function initDiscover(): void {
  if (!discoverRefreshBtn) return;
  discoverRefreshBtn.addEventListener("click", async () => {
    if (discoverRefreshBtn.classList.contains("discovering")) return;
    discoverRefreshBtn.classList.add("discovering");
    discoverRefreshBtn.disabled = true;
    try {
      await detectCurrentPage();
      showToast("✓ 发现完成");
    } catch {
      showToast("检测失败，请稍后再试");
    } finally {
      // 保持动画至少 600ms，避免闪烁
      setTimeout(() => {
        discoverRefreshBtn.classList.remove("discovering");
        discoverRefreshBtn.disabled = false;
      }, 600);
    }
  });
}

// ── 检测当前页面 ──────────────────────────────────

export async function detectCurrentPage(): Promise<void> {
  // Electron 环境下不支持发现功能
  if (platform.isElectron) return;

  try {
    const [tab] = await platform.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url?.startsWith("http")) return;

    // 尝试发消息，若 content script 未注入则主动注入后重试
    let response = await sendDetectMessage(tab.id);
    if (!response) {
      await ensureContentScript(tab.id);
      response = await sendDetectMessage(tab.id);
    }
    if (!response) return;

    const existingFeeds = await getAllFeeds();
    let hasContent = false;

    if (response.feeds && response.feeds.length > 0) {
      renderDetectedFeeds(response.feeds, existingFeeds);
      hasContent = true;
    }

    if (response.pageArticles?.hasArticles) {
      renderPageSubscribe(
        response.pageUrl || "",
        response.pageTitle || "",
        response.pageArticles,
        existingFeeds
      );
      hasContent = true;
    }

    if (hasContent && noDetectedEl) {
      noDetectedEl.style.display = "none";
      if (discoverDotEl) discoverDotEl.classList.add("visible");
    }
  } catch {
    // 无法访问当前 tab（如 chrome:// 页面），静默忽略
  }
}

interface DetectResponseRaw {
  feeds?: DetectedFeed[];
  pageUrl?: string;
  pageTitle?: string;
  pageArticles?: PageArticlesResult;
}

/**
 * 向目标 tab 发送检测消息，返回 response 或 null
 */
async function sendDetectMessage(tabId: number): Promise<DetectResponseRaw | null> {
  const response = await platform.tabs.sendMessage(tabId, { type: "detect-feeds" });
  return (response as DetectResponseRaw) || null;
}

/**
 * 主动注入 content script（当页面在插件安装/更新前已打开时需要）
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await platform.scripting.executeScript({
      target: { tabId },
      files: ["src/detector.js"],
    });
  } catch {
    // 注入失败（如受限页面），静默忽略
  }
}

// ── 渲染：RSS 源发现列表 ────────────────────────

function renderDetectedFeeds(feeds: DetectedFeed[], existingFeeds: string[]): void {
  if (!detectedListEl || !detectedSection) return;
  detectedListEl.innerHTML = "";
  detectedSection.style.display = "block";
  if (detectedCountEl) detectedCountEl.textContent = String(feeds.length);

  if (noDetectedEl) noDetectedEl.style.display = "none";
  if (discoverDotEl) discoverDotEl.classList.add("visible");

  const fragment = document.createDocumentFragment();
  for (const feed of feeds) {
    const li = document.createElement("li");
    li.className = "detected-item";

    const info = document.createElement("div");
    info.className = "detected-info";

    const title = document.createElement("div");
    title.className = "detected-title";
    title.textContent = feed.title || prettifyUrl(feed.url);
    title.title = feed.url;

    const url = document.createElement("div");
    url.className = "detected-url";
    url.textContent = feed.url;

    info.append(title, url);

    const tag = document.createElement("span");
    tag.className = "detected-tag";
    tag.textContent = feed.source === "link" ? "link" : "a";

    const already = existingFeeds.includes(feed.url);
    const btn = document.createElement("button");
    btn.className = "btn btn-subscribe" + (already ? " subscribed" : "");
    btn.textContent = already ? "已订阅" : "订阅";

    btn.addEventListener("click", async () => {
      const isSubscribed = btn.classList.contains("subscribed");
      btn.disabled = true;

      if (isSubscribed) {
        btn.textContent = "取消中…";
        await removeFeed(feed.url);
        btn.classList.remove("subscribed");
        btn.textContent = "订阅";
        btn.disabled = false;
        showToast("已取消订阅 " + prettifyUrl(feed.url));
        await refreshFeeds();
        await _onFeedChanged();
      } else {
        btn.textContent = "订阅中…";
        const result = await addFeed(feed.url);
        if (result.ok) {
          btn.textContent = "已订阅";
          btn.classList.add("subscribed");
          btn.disabled = false;
          showToast("✓ 已订阅 " + prettifyUrl(feed.url));
          await refreshFeeds();
          await _onFeedChanged();
          triggerFetch();
        } else {
          btn.textContent = "失败";
          setTimeout(() => {
            btn.textContent = "订阅";
            btn.disabled = false;
          }, 2000);
        }
      }
    });

    li.append(info, tag, btn);
    fragment.appendChild(li);
  }
  detectedListEl.appendChild(fragment);
}

// ── 渲染：网页订阅卡片 ──────────────────────────

function renderPageSubscribe(
  pageUrl: string,
  pageTitle: string,
  pageArticles: PageArticlesResult,
  existingFeeds: string[]
): void {
  if (!pageSubSection) return;

  pageSubSection.style.display = "block";
  if (noDetectedEl) noDetectedEl.style.display = "none";

  if (pageTitleEl) {
    pageTitleEl.textContent = pageTitle || prettifyUrl(pageUrl);
    pageTitleEl.title = pageTitle || "";
  }
  if (pageUrlEl) {
    pageUrlEl.textContent = pageUrl;
    pageUrlEl.title = pageUrl;
  }
  if (pageHintEl) {
    pageHintEl.textContent = `检测到 ${pageArticles.articleCount} 篇文章，可作为网页源订阅`;
  }

  if (pageSamplesEl && pageArticles.sampleTitles?.length > 0) {
    pageSamplesEl.innerHTML = "";
    pageSamplesEl.classList.add("visible");

    const label = document.createElement("div");
    label.className = "sample-label";
    label.textContent = "文章预览";
    pageSamplesEl.appendChild(label);

    for (const title of pageArticles.sampleTitles) {
      const item = document.createElement("div");
      item.className = "sample-item";
      item.textContent = title;
      item.title = title;
      pageSamplesEl.appendChild(item);
    }
  }

  if (!pageSubBtn) return;

  const already = existingFeeds.includes(pageUrl);
  if (already) {
    pageSubBtn.textContent = "已订阅";
    pageSubBtn.classList.add("subscribed");
  } else {
    pageSubBtn.textContent = "订阅此网页";
    pageSubBtn.classList.remove("subscribed");
  }
  pageSubBtn.disabled = false;

  // 移除旧监听器，避免重复绑定
  const newBtn = pageSubBtn.cloneNode(true) as HTMLButtonElement;
  pageSubBtn.replaceWith(newBtn);

  newBtn.addEventListener("click", async () => {
    const isSubscribed = newBtn.classList.contains("subscribed");
    newBtn.disabled = true;

    if (isSubscribed) {
      newBtn.textContent = "取消中…";
      await removeFeed(pageUrl);
      newBtn.classList.remove("subscribed");
      newBtn.textContent = "订阅此网页";
      newBtn.disabled = false;
      showToast("已取消订阅此网页");
      await refreshFeeds();
      await _onFeedChanged();
    } else {
      newBtn.textContent = "订阅中…";
      const result = await addFeed(pageUrl);
      if (result.ok) {
        newBtn.textContent = "已订阅";
        newBtn.classList.add("subscribed");
        newBtn.disabled = false;
        showToast("✓ 已订阅此网页");
        await refreshFeeds();
        await _onFeedChanged();
        triggerFetch();
      } else if (result.reason === "exists") {
        newBtn.textContent = "已订阅";
        newBtn.classList.add("subscribed");
        newBtn.disabled = false;
      } else {
        newBtn.textContent = "订阅失败";
        setTimeout(() => {
          newBtn.textContent = "订阅此网页";
          newBtn.disabled = false;
        }, 2000);
      }
    }
  });
}
