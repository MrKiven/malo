/**
 * Tab 切换模块
 */

let lastActiveTab = "articles";

/** Tab 切换回调映射：{ tabName: () => void } */
const tabCallbacks: Record<string, () => void> = {};

/**
 * 注册 Tab 切换回调（切到该 Tab 时触发）
 */
export function onTabActivate(tabName: string, fn: () => void): void {
  tabCallbacks[tabName] = fn;
}

/**
 * 初始化 Tab 切换
 */
export function initTabs(): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLElement).dataset.tab;
      if (!tab || lastActiveTab === tab) return;

      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-pane").forEach((p) => {
        p.classList.remove("active");
      });

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      const pane = document.querySelector(`[data-pane="${tab}"]`);
      if (pane) {
        pane.classList.add("active");
        pane.scrollTop = 0;
      }

      lastActiveTab = tab;

      // 触发 Tab 切换回调
      tabCallbacks[tab]?.();
    });
  });
}
