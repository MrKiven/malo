/**
 * Popup 共享 UI 工具
 *
 * 提供 Toast 提示、Loading bar、状态文本、后台消息、动画等通用 UI 功能
 * 被 feeds.ts、articles.ts、detect.ts、ai-settings.ts 等模块引用
 */

import { platform } from "../platform";

// ── DOM 工具 ──────────────────────────────────

/**
 * 按 ID 获取 DOM 元素的快捷方式
 */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const toastEl = $("toast");
const loadingBarEl = $("loading-bar");

// ── Toast ──────────────────────────────────────

let toastTimer = 0;

/**
 * 显示 Toast 提示
 */
export function showToast(text: string, duration = 2000): void {
  if (!toastEl) return;
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.add("show");
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
  }, duration);
}

// ── Loading bar ────────────────────────────────

/**
 * 显示顶部加载条
 */
export function showLoadingBar(): void {
  if (!loadingBarEl) return;
  loadingBarEl.style.width = "70%";
  loadingBarEl.classList.add("active");
}

/**
 * 隐藏顶部加载条
 */
export function hideLoadingBar(): void {
  if (!loadingBarEl) return;
  loadingBarEl.style.width = "100%";
  setTimeout(() => {
    loadingBarEl.classList.remove("active");
    loadingBarEl.style.width = "0";
  }, 300);
}

// ── Status ─────────────────────────────────────

let statusTimer = 0;

/**
 * 设置状态文本（带自动清除）
 */
export function setStatus(el: HTMLElement | null, text: string, type?: "" | "error" | "success"): void {
  if (!el) return;
  clearTimeout(statusTimer);
  el.textContent = text || "";
  el.className =
    "status" +
    (type === "error" ? " error" : type === "success" ? " success" : "");
  if (text) {
    statusTimer = window.setTimeout(() => {
      el.textContent = "";
    }, 3000);
  }
}

// ── 触发后台抓取 ─────────────────────────────

/**
 * 通知后台立即抓取所有订阅源
 */
export function triggerFetch(): void {
  platform.runtime.sendMessage({ type: "fetch-now" });
}

// ── 元素抖动动画 ──────────────────────────────

/**
 * 元素抖动动画（用于输入验证失败）
 */
export function shakeElement(el: HTMLElement): void {
  el.style.animation = "none";
  el.offsetHeight; // 触发 reflow
  el.style.animation = "shake 0.4s ease";
  el.addEventListener(
    "animationend",
    () => {
      el.style.animation = "";
    },
    { once: true }
  );

  // 注入 shake 动画（如果不存在）
  if (!document.querySelector("#shake-style")) {
    const style = document.createElement("style");
    style.id = "shake-style";
    style.textContent = `@keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-4px); } 40%, 80% { transform: translateX(4px); } }`;
    document.head.appendChild(style);
  }
}
