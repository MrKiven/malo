/**
 * 订阅源列表拖拽排序
 *
 * 处理 drag & drop 事件，实现订阅源的手动排序
 */

import { saveFeedOrder } from "../services/storage";
import { showToast } from "./shared";

// ── 状态 ─────────────────────────────────────

let dragSrcEl: HTMLElement | null = null;

// ── 对外接口 ─────────────────────────────────

export interface DndContext {
  feedListEl: HTMLElement | null;
  currentFeeds: string[];
  refreshFeeds: () => Promise<void>;
  onFeedChanged: () => Promise<void>;
}

let ctx: DndContext;

export function initDndContext(c: DndContext): void {
  ctx = c;
}

export function updateCurrentFeeds(feeds: string[]): void {
  ctx.currentFeeds = feeds;
}

// ── 事件绑定入口 ─────────────────────────────

export function bindDragEvents(li: HTMLElement): void {
  li.addEventListener("dragstart", handleDragStart);
  li.addEventListener("dragover", handleDragOver);
  li.addEventListener("dragenter", handleDragEnter);
  li.addEventListener("dragleave", handleDragLeave);
  li.addEventListener("drop", handleDrop);
  li.addEventListener("dragend", handleDragEnd);
}

// ── 事件处理 ─────────────────────────────────

function handleDragStart(this: HTMLElement, e: DragEvent): void {
  dragSrcEl = this;
  this.classList.add("dragging");
  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData("text/plain", this.dataset.index || "");

  // 创建半透明拖拽镜像
  const rect = this.getBoundingClientRect();
  e.dataTransfer!.setDragImage(this, e.clientX - rect.left, e.clientY - rect.top);
}

function handleDragOver(this: HTMLElement, e: DragEvent): void {
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";

  if (!dragSrcEl || this === dragSrcEl) return;

  const rect = this.getBoundingClientRect();
  const isFirst = this.dataset.index === "0";
  const isLast = parseInt(this.dataset.index || "0", 10) === ctx.currentFeeds.length - 1;
  // 第一个元素上方判定区域放大到70%，最后一个元素下方判定区域放大到70%
  const threshold = isFirst ? 0.7 : isLast ? 0.3 : 0.5;
  const after = e.clientY > rect.top + rect.height * threshold;

  // 移除所有 drop 指示器
  if (ctx.feedListEl) {
    ctx.feedListEl.querySelectorAll(".feed-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
  }

  // 添加相应方向的指示器
  this.classList.add(after ? "drag-over-bottom" : "drag-over-top");
}

function handleDragEnter(this: HTMLElement, e: DragEvent): void {
  e.preventDefault();
}

function handleDragLeave(this: HTMLElement): void {
  this.classList.remove("drag-over-top", "drag-over-bottom");
}

function handleDrop(this: HTMLElement, e: DragEvent): void {
  e.stopPropagation();
  e.preventDefault();

  if (!dragSrcEl || this === dragSrcEl) return;

  const fromIndex = parseInt(dragSrcEl.dataset.index || "0", 10);

  const rect = this.getBoundingClientRect();
  const isFirst = this.dataset.index === "0";
  const isLast = parseInt(this.dataset.index || "0", 10) === ctx.currentFeeds.length - 1;
  const threshold = isFirst ? 0.7 : isLast ? 0.3 : 0.5;
  const after = e.clientY > rect.top + rect.height * threshold;

  // 先取出被拖拽的元素
  const movedFeed = ctx.currentFeeds[fromIndex];
  ctx.currentFeeds.splice(fromIndex, 1);

  // 找到目标元素在 splice 后数组中的新位置
  const targetFeed = this.dataset.feedUrl || "";
  const targetIdx = ctx.currentFeeds.indexOf(targetFeed);
  const insertIdx = targetIdx >= 0
    ? (after ? targetIdx + 1 : targetIdx)
    : ctx.currentFeeds.length;

  ctx.currentFeeds.splice(insertIdx, 0, movedFeed);

  // 保存并重新渲染，同时通知文章列表刷新来源筛选顺序
  saveFeedOrder(ctx.currentFeeds).then(async () => {
    await ctx.refreshFeeds();
    await ctx.onFeedChanged();
    showToast("✓ 排序已保存");
  });
}

function handleDragEnd(this: HTMLElement): void {
  // 清除所有拖拽状态
  this.classList.remove("dragging");
  if (ctx.feedListEl) {
    ctx.feedListEl.querySelectorAll(".feed-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom", "dragging");
    });
  }
  dragSrcEl = null;
}
