/**
 * 文章列表状态管理与筛选模块
 */

import type { FeedItem, FeedMeta, FavoriteDetail } from "../types";
import {
  getAllFeeds,
  getAllItems,
  getItemsForFeed,
  getFeedMetaMap,
  getFavorites,
  getFavoriteDetails,
  getReadItems,
  markAllAsRead,
  getPausedFeeds,
} from "../services/storage";
import { extractHost, feedTypeLabel as getFeedTypeLabel } from "../utils/format";
import { $, showToast, showLoadingBar, hideLoadingBar, triggerFetch } from "./shared";
import { platform } from "../platform";
import { showArticleSkeleton, renderPage, appendNextPage, type RenderState } from "./articles-render";
export { openAIPanelWindow } from "./articles-ai";

const itemListEl = $("item-list");
const emptyItemsEl = $("empty-items");
const emptyFilterEl = $("empty-filter");
const refreshBtn = $<HTMLButtonElement>("refresh-items");
const filterKeywordEl = $<HTMLInputElement>("filter-keyword");
const filterSourceEl = $<HTMLSelectElement>("filter-source");
const filterUnreadBtn = $("filter-unread");
const filterFavBtn = $("filter-fav");
const markAllReadBtn = $<HTMLButtonElement>("mark-all-read");
const unreadBadgeEl = $("unread-badge");
const articlesPane = $("articles-pane");
const backTopBtn = $("btn-back-top");

// ── 状态 ──────────────────────────────────────────

/** 缓存当前所有条目 */
let cachedItems: FeedItem[] = [];
/** 收藏集合缓存 */
let favoritesSet = new Set<string>();
/** 已读集合缓存 */
let readSet = new Set<string>();
/** 源元信息缓存 */
let cachedMetaMap: Record<string, FeedMeta> = {};
/** 已暂停的订阅源缓存 */
let pausedSet = new Set<string>();
/** 仅看收藏模式 */
let showFavOnly = false;
/** 仅看未读模式 */
let showUnreadOnly = false;
/** AI 是否已配置 */
let aiConfigured = false;
/** 手动刷新冷却截止时间戳（在此之前忽略后台 items-updated 消息） */
let refreshCooldownUntil = 0;

/** 当前筛选后的全部文章（用于懒加载） */
let filteredItems: (FeedItem | FavoriteDetail)[] = [];
/** 已渲染条数 */
let renderedCount = 0;

// ── 渲染状态快照（传递给 render 模块）──────────────

function getRenderState(): RenderState {
  return {
    cachedMetaMap,
    readSet,
    favoritesSet,
    aiConfigured,
    filteredItems,
    renderedCount,
    showFavOnly,
    cachedItems,
    itemListEl,
    emptyItemsEl,
    emptyFilterEl,
  };
}

function syncRenderState(state: RenderState): void {
  renderedCount = state.renderedCount;
}

/**
 * 设置 AI 配置状态
 */
export function setAIConfigured(configured: boolean): void {
  aiConfigured = configured;
}

/**
 * 是否处于手动刷新冷却期（期间应忽略后台 items-updated 消息）
 */
export function isRefreshing(): boolean {
  return Date.now() < refreshCooldownUntil;
}

// ── 初始化 ──────────────────────────────────────────

export function initArticles(): void {
  refreshBtn?.addEventListener("click", onRefresh);

  // 筛选事件
  let filterTimer = 0;
  filterKeywordEl?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => renderFilteredItems(), 200);
  });
  filterSourceEl?.addEventListener("change", () => renderFilteredItems());

  // 未读筛选
  if (filterUnreadBtn) {
    filterUnreadBtn.addEventListener("click", () => {
      showUnreadOnly = !showUnreadOnly;
      filterUnreadBtn.classList.toggle("active", showUnreadOnly);
      renderFilteredItems();
    });
  }

  // 收藏筛选
  filterFavBtn?.addEventListener("click", () => {
    showFavOnly = !showFavOnly;
    filterFavBtn?.classList.toggle("active", showFavOnly);
    renderFilteredItems();
  });

  // 一键已读
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", onMarkAllRead);
  }

  // 回到顶部按钮 + 滚动懒加载
  if (articlesPane && backTopBtn) {
    articlesPane.addEventListener("scroll", () => {
      backTopBtn.classList.toggle("visible", articlesPane.scrollTop > 200);
      // 懒加载：接近底部时加载更多
      const { scrollTop, scrollHeight, clientHeight } = articlesPane;
      if (scrollTop + clientHeight >= scrollHeight - 100 && renderedCount < filteredItems.length) {
        const state = getRenderState();
        appendNextPage(state);
        syncRenderState(state);
      }
    });
    backTopBtn.addEventListener("click", () => {
      articlesPane.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // 监听收藏变更事件（由 render 模块的收藏按钮触发）
  itemListEl?.addEventListener("fav-changed", () => {
    renderFilteredItems();
  });
}

// ── 一键已读 ────────────────────────────────────────

async function onMarkAllRead(): Promise<void> {
  if (!markAllReadBtn) return;
  markAllReadBtn.disabled = true;
  await markAllAsRead();
  readSet = await getReadItems();

  // 更新 UI：所有文章加上已读样式
  document.querySelectorAll(".article-item").forEach((el) => {
    el.classList.add("read");
  });

  // 通知 background 更新 badge
  platform.runtime.sendMessage({ type: "mark-all-read" });

  updateUnreadBadge();
  showToast("✓ 已全部标为已读");
  markAllReadBtn.disabled = false;
}

// ── 刷新 ──────────────────────────────────────────

async function onRefresh(): Promise<void> {
  if (!refreshBtn) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add("refreshing");
  const originalHTML = refreshBtn.innerHTML;
  refreshBtn.innerHTML = '<span class="spinner"></span> 刷新中…';

  showLoadingBar();
  showArticleSkeleton(getRenderState());

  triggerFetch();
  await pollForItems(8000, 800);

  hideLoadingBar();
  // 设置冷却期：刷新完成后 3 秒内忽略后台 items-updated，防止重复刷新
  refreshCooldownUntil = Date.now() + 3000;
  refreshBtn.innerHTML = originalHTML;
  refreshBtn.classList.remove("refreshing");
  refreshBtn.disabled = false;
  showToast("✓ 已刷新");
}

// ── 数据刷新 ────────────────────────────────────

export async function refreshItems(): Promise<void> {
  [cachedItems, favoritesSet, readSet, cachedMetaMap, pausedSet] = await Promise.all([
    getAllItems(),
    getFavorites(),
    getReadItems(),
    getFeedMetaMap(),
    getPausedFeeds(),
  ]);
  // 过滤掉已暂停订阅源的文章
  cachedItems = cachedItems.filter((it) => !pausedSet.has(it.feedUrl || ""));
  updateUnreadBadge();
  await updateSourceFilter();
  await renderFilteredItems();
}

/** 更新「文章」Tab 上的未读计数 */
function updateUnreadBadge(): void {
  if (!unreadBadgeEl) return;
  const unread = cachedItems.filter((it) => it.link && !readSet.has(it.link)).length;
  unreadBadgeEl.textContent = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "";
}

/** 更新来源下拉列表 */
async function updateSourceFilter(): Promise<void> {
  if (!filterSourceEl) return;
  const currentValue = filterSourceEl.value;
  const feeds = await getAllFeeds();
  // 过滤掉已暂停的订阅源
  const activeFeeds = feeds.filter((f) => !pausedSet.has(f));
  const sources =
    activeFeeds.length > 0
      ? activeFeeds
      : [...new Set(cachedItems.map((it) => it.feedUrl).filter(Boolean) as string[])];

  filterSourceEl.innerHTML = '<option value="">全部来源</option>';
  for (const src of sources) {
    const opt = document.createElement("option");
    opt.value = src;
    const type = cachedMetaMap[src]?.type || "";
    const typeTag = getFeedTypeLabel(type);
    opt.textContent =
      (typeTag ? `[${typeTag}] ` : "") +
      (extractHost(src) || src);
    filterSourceEl.appendChild(opt);
  }

  if (sources.includes(currentValue)) {
    filterSourceEl.value = currentValue;
  }
}

/** 根据关键词、来源、收藏筛选并渲染 */
export async function renderFilteredItems(): Promise<void> {
  const keyword = filterKeywordEl?.value.trim().toLowerCase() || "";
  const source = filterSourceEl?.value || "";

  let base: (FeedItem | FavoriteDetail)[];
  if (showFavOnly) {
    base = await getFavoriteDetails();
  } else if (source) {
    base = await getItemsForFeed(source);
  } else {
    base = cachedItems;
  }

  if (source && showFavOnly) {
    base = base.filter((it) => it.feedUrl === source);
  }

  if (showUnreadOnly) {
    base = base.filter((it) => it.link && !readSet.has(it.link));
  }

  if (keyword) {
    base = base.filter((it) => {
      const title = ((it as FeedItem).title || "").toLowerCase();
      const desc = ((it as FeedItem).description || "").toLowerCase();
      const link = (it.link || "").toLowerCase();
      return (
        title.includes(keyword) ||
        desc.includes(keyword) ||
        link.includes(keyword)
      );
    });
  }

  filteredItems = base;
  renderedCount = 0;
  if (itemListEl) itemListEl.innerHTML = "";

  const state = getRenderState();
  renderPage(state);
  syncRenderState(state);
}

// ── 轮询 ──────────────────────────────────────────

async function pollForItems(totalMs: number, intervalMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    await refreshItems();
    if (itemListEl && itemListEl.children.length > 0) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  await refreshItems();
}
