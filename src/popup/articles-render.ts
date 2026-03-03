/**
 * 文章列表 DOM 渲染
 *
 * 负责文章卡片的创建、骨架屏、懒加载追加等
 */

import type { FeedItem, FeedMeta, FavoriteDetail } from "../types";
import {
  addFavorite,
  removeFavorite,
} from "../services/storage";
import {
  relativeTime,
  formatFullDate,
  formatTimeWithSeconds,
  formatFullDateTime,
  extractHost,
  makeSummary,
  feedTypeLabel as getFeedTypeLabel,
} from "../utils/format";
import { showToast } from "./shared";
import { openAIPanel } from "./articles-ai";
import { PAGE_SIZE } from "../constants";
import { platform } from "../platform";

// ── 渲染状态（由 articles.ts 管理并传入）──────────────

export interface RenderState {
  cachedMetaMap: Record<string, FeedMeta>;
  readSet: Set<string>;
  favoritesSet: Set<string>;
  aiConfigured: boolean;
  filteredItems: (FeedItem | FavoriteDetail)[];
  renderedCount: number;
  showFavOnly: boolean;
  cachedItems: FeedItem[];
  itemListEl: HTMLElement | null;
  emptyItemsEl: HTMLElement | null;
  emptyFilterEl: HTMLElement | null;
}

// ── Skeleton loading ─────────────────────────────

export function showArticleSkeleton(state: RenderState): void {
  if (!state.itemListEl) return;
  if (state.itemListEl.children.length > 0) return;
  const count = 4;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const li = document.createElement("li");
    li.className = "skeleton-article";
    li.innerHTML =
      '<div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>';
    li.style.animationDelay = `${i * 0.1}s`;
    fragment.appendChild(li);
  }
  state.itemListEl.appendChild(fragment);
  if (state.emptyItemsEl) state.emptyItemsEl.style.display = "none";
}

// ── 渲染入口 ─────────────────────────────────────

export function renderPage(state: RenderState): void {
  if (state.cachedItems.length === 0 && !state.showFavOnly) {
    if (state.emptyItemsEl) state.emptyItemsEl.style.display = "block";
    if (state.emptyFilterEl) state.emptyFilterEl.style.display = "none";
    return;
  }

  if (state.emptyItemsEl) state.emptyItemsEl.style.display = "none";

  if (state.filteredItems.length === 0) {
    if (state.emptyFilterEl) state.emptyFilterEl.style.display = "block";
    return;
  }
  if (state.emptyFilterEl) state.emptyFilterEl.style.display = "none";

  appendNextPage(state);
}

// ── 追加下一批文章 DOM ────────────────────────────

export function appendNextPage(state: RenderState): void {
  const start = state.renderedCount;
  const end = Math.min(start + PAGE_SIZE, state.filteredItems.length);
  if (start >= end) return;

  const starOutlineSvg = '<img src="../../assets/icons/star-outline.svg" alt="" />';
  const starFilledSvg = '<img src="../../assets/icons/star-filled.svg" alt="" />';

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const item = state.filteredItems[i] as FeedItem;
    const li = document.createElement("li");
    const isRead = state.readSet.has(item.link);
    li.className = "article-item" + (isRead ? " read" : "");

    const itemLink = item.link || "";
    if (itemLink) {
      li.addEventListener("click", () => {
        doMarkRead(item.link, li, state);
        platform.tabs.create({ url: itemLink });
      });
    }

    const row = document.createElement("div");
    row.className = "article-row";

    const content = document.createElement("div");
    content.className = "article-content";

    // 元信息行
    const meta = document.createElement("div");
    meta.className = "article-meta";

    const typeText = feedTypeLabel(item.feedUrl || "", state.cachedMetaMap);
    if (typeText) {
      const typeTag = document.createElement("span");
      const typeCls = state.cachedMetaMap[item.feedUrl || ""]?.type || "";
      typeTag.className = "article-type " + typeCls;
      typeTag.textContent = typeText;
      meta.appendChild(typeTag);
    }

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = extractHost(item.feedUrl || item.link || "");
    meta.appendChild(badge);

    const dateText = relativeTime(item.publishedAt);
    if (dateText) {
      const fullDate = formatFullDate(item.publishedAt);
      const timeText = formatTimeWithSeconds(item.publishedAt);
      if (timeText) {
        const dot = document.createElement("span");
        dot.className = "meta-dot";
        meta.appendChild(dot);

        const timeSpan = document.createElement("span");
        timeSpan.className = "article-time";
        timeSpan.textContent =
          fullDate && dateText !== fullDate
            ? `${fullDate} ${timeText}`
            : timeText;
        timeSpan.title = formatFullDateTime(item.publishedAt);
        meta.appendChild(timeSpan);
      }

      const timeDot = document.createElement("span");
      timeDot.className = "meta-dot";
      meta.appendChild(timeDot);

      const dateSpan = document.createElement("span");
      dateSpan.className = "article-date";
      dateSpan.textContent = dateText;
      dateSpan.title = formatFullDateTime(item.publishedAt);
      meta.appendChild(dateSpan);
    }

    // 标题链接
    const a = document.createElement("a");
    a.className = "article-title";
    a.href = item.link || "#";
    a.textContent = item.title || item.link || "(无标题)";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      doMarkRead(item.link, li, state);
      platform.tabs.create({ url: item.link });
    });

    // 摘要
    const desc = document.createElement("div");
    desc.className = "article-desc";
    const summary = makeSummary(item.description || "");
    if (summary) desc.textContent = summary;

    content.append(meta, a);
    if (summary) content.appendChild(desc);

    // 收藏按钮
    const isFav = state.favoritesSet.has(item.link);
    const favBtn = document.createElement("button");
    favBtn.className = "btn-fav" + (isFav ? " active" : "");
    favBtn.innerHTML = isFav ? starFilledSvg : starOutlineSvg;
    favBtn.dataset.tooltip = isFav ? "取消收藏" : "收藏";
    favBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const currentlyFav = state.favoritesSet.has(item.link);
      if (currentlyFav) {
        await removeFavorite(item.link);
        state.favoritesSet.delete(item.link);
        favBtn.classList.remove("active");
        favBtn.innerHTML = starOutlineSvg;
        favBtn.dataset.tooltip = "收藏";
        showToast("已取消收藏");
        if (state.showFavOnly) {
          // 需要外部触发 renderFilteredItems，通过事件机制
          favBtn.dispatchEvent(new CustomEvent("fav-changed", { bubbles: true }));
        }
      } else {
        await addFavorite(item);
        state.favoritesSet.add(item.link);
        favBtn.classList.add("active");
        favBtn.innerHTML = starFilledSvg;
        favBtn.dataset.tooltip = "取消收藏";
        favBtn.style.transform = "scale(1.3)";
        setTimeout(() => {
          favBtn.style.transform = "";
        }, 200);
        showToast("✓ 已收藏");
      }
    });

    // 操作按钮组
    const actions = document.createElement("div");
    actions.className = "article-actions";

    // AI 总结按钮
    if (state.aiConfigured && itemLink) {
      const aiBtn = document.createElement("button");
      aiBtn.className = "btn-ai";
      aiBtn.innerHTML = '<img src="../../assets/icons/sparkles.svg" alt="" />';
      aiBtn.dataset.tooltip = "AI 总结";
      aiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        doMarkRead(item.link, li, state);
        openAIPanel(item);
      });
      actions.appendChild(aiBtn);
    }

    actions.appendChild(favBtn);
    row.append(content, actions);
    li.appendChild(row);
    fragment.appendChild(li);
  }
  state.renderedCount = end;
  state.itemListEl?.appendChild(fragment);
}

// ── 标记已读 ─────────────────────────────────────

function doMarkRead(link: string, liEl: HTMLElement, state: RenderState): void {
  if (!link || state.readSet.has(link)) return;
  state.readSet.add(link);
  if (liEl) liEl.classList.add("read");
  // 交给 background 写入存储并更新图标 badge，避免 popup 关闭后任务中断
  platform.runtime.sendMessage({ type: "mark-read", link });
}

// ── 内部工具 ─────────────────────────────────────

function feedTypeLabel(feedUrl: string, metaMap: Record<string, FeedMeta>): string {
  const type = metaMap[feedUrl]?.type || "";
  return getFeedTypeLabel(type);
}
