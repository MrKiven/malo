/**
 * 订阅源列表管理模块
 */

import {
  getAllFeeds,
  addFeed,
  removeFeed,
  getFeedMetaMap,
  getPausedFeeds,
  pauseFeed,
  resumeFeed,
} from "../services/storage";
import { prettifyUrl, FEED_TYPE_LABELS } from "../utils/format";
import { $, showToast, showLoadingBar, hideLoadingBar, setStatus, shakeElement, triggerFetch } from "./shared";
import { bindDragEvents, initDndContext, updateCurrentFeeds } from "./feeds-dnd";
import { onExportFeeds, onImportFileChange } from "./feeds-io";

const feedInput = $<HTMLInputElement>("feed-input");
const addButton = $<HTMLButtonElement>("add-feed");
const statusEl = $("status");
const feedListEl = $("feed-list");
const feedCountEl = $("feed-count");
const emptyFeedsEl = $("empty-feeds");
const feedSortEl = $<HTMLSelectElement>("feed-sort");
const feedListCardEl = $("feed-list-card");
const exportFeedsBtn = $("export-feeds");
const importFeedsBtn = $("import-feeds");
const importFileInput = $<HTMLInputElement>("import-file");

const FEED_TYPE_ORDER: Record<string, number> = { rss: 0, page: 1, "page-js": 2, unknown: 3, "": 4 };

// ── 对外回调（由主模块注入） ─────────────────────────

let _onFeedChanged: () => Promise<void> = async () => {};

/**
 * 设置订阅源变更后的回调（刷新文章列表等）
 */
export function onFeedChanged(fn: () => Promise<void>): void {
  _onFeedChanged = fn;
}

// ── 初始化 ──────────────────────────────────────────

export function initFeeds(): void {
  addButton?.addEventListener("click", onAdd);
  feedInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAdd();
  });
  feedSortEl?.addEventListener("change", () => refreshFeeds());
  exportFeedsBtn?.addEventListener("click", () => onExportFeeds(statusEl));
  importFeedsBtn?.addEventListener("click", () => importFileInput?.click());
  importFileInput?.addEventListener("change", (e) =>
    onImportFileChange(e, statusEl, importFileInput, refreshFeeds, _onFeedChanged)
  );

  // 初始化拖拽上下文
  initDndContext({
    feedListEl,
    currentFeeds: [],
    refreshFeeds,
    onFeedChanged: () => _onFeedChanged(),
  });
}

// ── 添加订阅源 ─────────────────────────────────────

async function onAdd(): Promise<void> {
  if (!feedInput || !addButton) return;
  const url = feedInput.value.trim();
  if (!url) {
    setStatus(statusEl, "请输入 RSS 或博客网址", "error");
    shakeElement(feedInput);
    return;
  }

  try {
    new URL(url);
  } catch {
    setStatus(statusEl, "请输入有效的 URL 地址", "error");
    shakeElement(feedInput);
    return;
  }

  setStatus(statusEl, "正在添加…");
  addButton.disabled = true;
  addButton.style.opacity = "0.7";
  showLoadingBar();

  try {
    const result = await addFeed(url);
    if (result.ok) {
      if (result.reason === "exists") {
        setStatus(statusEl, "该源已存在", "error");
      } else {
        setStatus(statusEl, "添加成功！", "success");
        showToast("✓ 订阅源已添加");
        feedInput.value = "";
        await refreshFeeds();
        triggerFetch();
      }
    } else {
      const msgs: Record<string, string> = { empty: "地址不能为空", invalid_url: "URL 格式不正确" };
      setStatus(statusEl, msgs[result.reason] || "添加失败", "error");
    }
  } catch (e) {
    setStatus(statusEl, "添加失败：" + (e as Error).message, "error");
  } finally {
    hideLoadingBar();
    addButton.disabled = false;
    addButton.style.opacity = "";
    feedInput.focus();
  }
}

// ── 渲染订阅源列表 ─────────────────────────────────

export async function refreshFeeds(): Promise<void> {
  let feeds = await getAllFeeds();
  const [metaMap, pausedSet] = await Promise.all([getFeedMetaMap(), getPausedFeeds()]);

  if (feedSortEl?.value === "type") {
    feeds = [...feeds].sort((a, b) => {
      const ta = metaMap[a]?.type ?? "";
      const tb = metaMap[b]?.type ?? "";
      const orderA = FEED_TYPE_ORDER[ta] ?? 4;
      const orderB = FEED_TYPE_ORDER[tb] ?? 4;
      if (orderA !== orderB) return orderA - orderB;
      return prettifyUrl(a).localeCompare(prettifyUrl(b));
    });
  }

  if (!feedListEl) return;
  feedListEl.innerHTML = "";

  if (feeds.length === 0) {
    if (emptyFeedsEl) emptyFeedsEl.style.display = "block";
    if (feedCountEl) feedCountEl.hidden = true;
    if (feedListCardEl) feedListCardEl.style.display = "none";
    return;
  }

  if (emptyFeedsEl) emptyFeedsEl.style.display = "none";
  if (feedCountEl) {
    feedCountEl.hidden = false;
    feedCountEl.textContent = String(feeds.length);
  }
  if (feedListCardEl) feedListCardEl.style.display = "block";

  // 更新拖拽模块的 feeds 列表
  updateCurrentFeeds([...feeds]);
  const isDragEnabled = !feedSortEl?.value; // 仅默认排序时可拖拽

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const li = document.createElement("li");
    li.className = "feed-item";
    li.dataset.feedUrl = feed;
    li.dataset.index = String(i);

    // 拖拽启用
    if (isDragEnabled) {
      li.draggable = true;
    }

    const meta = metaMap[feed];
    const type = meta?.type || "";
    const isPaused = pausedSet.has(feed);

    if (isPaused) {
      li.classList.add("feed-paused");
    }

    if (type) {
      const typeTag = document.createElement("span");
      typeTag.className = "feed-type " + type;
      typeTag.textContent = FEED_TYPE_LABELS[type] || type;
      li.appendChild(typeTag);
    }

    if (isPaused) {
      const pausedTag = document.createElement("span");
      pausedTag.className = "feed-type paused";
      pausedTag.textContent = "已暂停";
      li.appendChild(pausedTag);
    }

    const isLinkable = type === "page" || type === "page-js";
    const span = document.createElement(isLinkable ? "a" : "span") as HTMLElement;
    span.className = "feed-url";
    span.textContent = prettifyUrl(feed);
    span.title = feed;
    if (isLinkable && span instanceof HTMLAnchorElement) {
      span.href = feed;
      span.target = "_blank";
      span.rel = "noopener noreferrer";
    }

    // 暂停/恢复按钮
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "btn btn-pause" + (isPaused ? " is-paused" : "");
    pauseBtn.textContent = isPaused ? "恢复" : "暂停";
    pauseBtn.title = isPaused ? "恢复自动抓取" : "暂停自动抓取";
    pauseBtn.addEventListener("click", async () => {
      pauseBtn.disabled = true;
      if (isPaused) {
        await resumeFeed(feed);
        showToast("✓ 已恢复抓取");
      } else {
        await pauseFeed(feed);
        showToast("已暂停抓取");
      }
      await refreshFeeds();
      await _onFeedChanged();
    });

    const del = document.createElement("button") as HTMLButtonElement & { _resetTimer?: ReturnType<typeof setTimeout> };
    del.className = "btn btn-danger";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      if (!del.dataset.confirming) {
        del.dataset.confirming = "1";
        del.textContent = "确认删除？";
        del.classList.add("confirming");
        del._resetTimer = setTimeout(() => {
          delete del.dataset.confirming;
          del.textContent = "删除";
          del.classList.remove("confirming");
        }, 3000);
        return;
      }
      clearTimeout(del._resetTimer);
      del.disabled = true;
      del.textContent = "删除中…";
      await removeFeed(feed);
      showToast("已删除订阅源");
      await refreshFeeds();
      await _onFeedChanged();
    });

    // 拖拽事件（仅默认排序模式下启用）
    if (isDragEnabled) {
      bindDragEvents(li);
    }

    // 拖拽手柄放在末尾（仅默认排序模式下显示）
    if (isDragEnabled) {
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="9" cy="5" r="1.2"/><circle cx="15" cy="5" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="19" r="1.2"/><circle cx="15" cy="19" r="1.2"/></svg>';
      handle.title = "拖拽排序";
      li.append(span, pauseBtn, del, handle);
    } else {
      li.append(span, pauseBtn, del);
    }
    fragment.appendChild(li);
  }
  feedListEl.appendChild(fragment);
}
