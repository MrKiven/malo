/**
 * 文章内容抓取与提取模块
 *
 * 负责从 URL 抓取网页 HTML 并提取主要文本内容
 * 被 ai-panel 等模块用于获取待总结的文章正文
 */

import * as pdfjsLib from "pdfjs-dist";
import { platform } from "../platform";

/** 确保 PDF.js worker 只初始化一次 */
let pdfWorkerInitialized = false;
function ensurePdfWorker(): void {
  if (pdfWorkerInitialized) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = platform.runtime.getURL("src/pdf.worker.min.mjs");
  pdfWorkerInitialized = true;
}

/**
 * 判断 URL 是否指向 PDF 文件
 */
export function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".pdf");
  } catch {
    return false;
  }
}

/**
 * 从 Content-Type 判断响应是否为 PDF
 */
function isPdfResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") || "";
  return ct.toLowerCase().includes("application/pdf");
}

/**
 * 抓取 PDF 文件并提取文本内容
 */
export async function fetchPdfContent(pdfUrl: string): Promise<string> {
  try {
    ensurePdfWorker();
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      if (pageText.trim()) {
        pageTexts.push(pageText.trim());
      }
    }

    const text = pageTexts.join("\n\n");
    if (!text || text.length < 20) {
      throw new Error("PDF 文本内容过少，可能是扫描件或图片型 PDF");
    }
    return text;
  } catch (e) {
    if ((e as Error).message.includes("PDF 文本内容过少")) throw e;
    throw new Error(`PDF 内容提取失败：${(e as Error).message}`);
  }
}

/**
 * 抓取文章正文内容
 */
export async function fetchArticleContent(articleUrl: string): Promise<string> {
  try {
    // 先通过 URL 后缀判断
    if (isPdfUrl(articleUrl)) {
      return fetchPdfContent(articleUrl);
    }

    const res = await fetch(articleUrl, {
      headers: {
        Accept: "text/html, application/xhtml+xml, */*",
        "User-Agent": "Mozilla/5.0 (compatible; RSSHelper/1.0)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // 响应 Content-Type 是 PDF 的情况（URL 没有 .pdf 后缀但实际是 PDF）
    if (isPdfResponse(res)) {
      ensurePdfWorker();
      const arrayBuffer = await res.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageTexts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        if (pageText.trim()) {
          pageTexts.push(pageText.trim());
        }
      }
      return pageTexts.join("\n\n") || "";
    }

    const html = await res.text();
    return extractMainContent(html);
  } catch (e) {
    throw new Error(`获取文章内容失败：${(e as Error).message}`);
  }
}

/**
 * 从 HTML 中提取主要文本内容
 */
export function extractMainContent(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  const articleMatch = text.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  const mainMatch = text.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);

  const contentHtml = articleMatch?.[1] || mainMatch?.[1] || text;

  const plainText = contentHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return plainText;
}
