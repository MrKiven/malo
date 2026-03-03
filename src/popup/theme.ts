/**
 * 主题切换模块
 */

import { getTheme, setTheme } from "../services/storage";

/**
 * 初始化主题（读取存储并应用，绑定切换按钮）
 */
export async function initTheme(): Promise<void> {
  const theme = await getTheme();
  applyTheme(theme);

  // 绑定主题切换按钮
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", toggleTheme);
  }
}

/**
 * 应用主题到 DOM
 */
export function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * 切换主题（light ↔ dark）
 */
export async function toggleTheme(): Promise<void> {
  const current =
    document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await setTheme(next);
}
