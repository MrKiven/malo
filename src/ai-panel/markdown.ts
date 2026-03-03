/**
 * 简易 Markdown → HTML 渲染器
 *
 * 将 AI 返回的 Markdown 文本转换为 HTML，用于 AI 面板展示
 * 支持：标题、列表、引用块、粗体、斜体、行内代码、分隔线
 */

/**
 * 将 Markdown 文本渲染为 HTML
 */
export function renderMarkdown(md: string): string {
  if (!md) return "";

  // 转义 HTML 实体
  let text = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 按行处理，然后重新组合
  const lines = text.split("\n");
  const outputLines: string[] = [];
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 引用块 (> ...)
    if (/^&gt;\s?(.*)$/.test(line)) {
      const content = line.replace(/^&gt;\s?/, "");
      if (!inBlockquote) {
        outputLines.push('<blockquote class="md-blockquote">');
        inBlockquote = true;
      }
      outputLines.push(content);
      continue;
    } else if (inBlockquote) {
      outputLines.push("</blockquote>");
      inBlockquote = false;
    }

    // 标题
    if (/^### (.+)$/.test(line)) {
      outputLines.push(line.replace(/^### (.+)$/, '<h5 class="md-h3">$1</h5>'));
      continue;
    }
    if (/^## (.+)$/.test(line)) {
      outputLines.push(line.replace(/^## (.+)$/, '<h4 class="md-h2">$1</h4>'));
      continue;
    }
    if (/^# (.+)$/.test(line)) {
      outputLines.push(line.replace(/^# (.+)$/, '<h3 class="md-h1">$1</h3>'));
      continue;
    }

    // 水平分隔线
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      outputLines.push('<hr class="md-hr">');
      continue;
    }

    // 无序列表
    if (/^- (.+)$/.test(line)) {
      outputLines.push(line.replace(/^- (.+)$/, '<li class="md-li">$1</li>'));
      continue;
    }

    // 空行 → 段落间距
    if (line.trim() === "") {
      outputLines.push('<div class="md-spacer" style="height:6px;"></div>');
      continue;
    }

    // 普通文本行
    outputLines.push(line);
  }

  // 关闭未闭合的引用块
  if (inBlockquote) {
    outputLines.push("</blockquote>");
  }

  let html = outputLines.join("\n");

  // 行内样式（在拼接后统一处理）
  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

  // 清除块元素前后的多余换行，避免产生额外 <br>
  html = html
    .replace(/\n+(<h[345]|<li|<blockquote|<\/blockquote|<hr|<div class="md-spacer")/g, "$1")
    .replace(/(<\/h[345]>|<\/li>|<\/blockquote>|<hr[^>]*>|<div class="md-spacer"[^>]*>)\n+/g, "$1");

  // 剩余换行转 <br>
  html = html
    .replace(/\n{2,}/g, "<br>")
    .replace(/\n/g, "<br>");

  return html;
}

/**
 * 转义 HTML 特殊字符
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
