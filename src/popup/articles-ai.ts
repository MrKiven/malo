/**
 * AI 面板打开逻辑
 *
 * 从文章列表或其他入口打开 AI 总结弹窗
 */

import type { FeedItem } from "../types";
import { platform } from "../platform";

/**
 * 打开 AI 面板弹窗（通用）
 */
export async function openAIPanelWindow(params: URLSearchParams): Promise<void> {
  const panelUrl =
    platform.runtime.getURL("src/ai-panel/index.html") + "?" + params.toString();
  const panelW = 1200, panelH = 800;
  const win = await platform.windows.getCurrent();
  platform.windows.create({
    url: panelUrl,
    type: "popup",
    width: panelW,
    height: panelH,
    left: Math.round((win.left || 0) + (win.width || 0) - panelW - 20),
    top: Math.round((win.top || 0) + 60),
  });
}

export function openAIPanel(article: FeedItem): void {
  const params = new URLSearchParams();
  params.set("title", article.title || "");
  params.set("link", article.link || "");
  params.set("desc", article.description || "");
  openAIPanelWindow(params);
}
