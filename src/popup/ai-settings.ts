/**
 * AI 设置面板模块
 */

import { getAIConfig, setAIConfig } from "../services/storage";
import { $, showToast, setStatus } from "./shared";
import { setAIConfigured, renderFilteredItems, openAIPanelWindow } from "./articles";
import { platform } from "../platform";

const aiBaseUrlEl = $<HTMLInputElement>("ai-base-url");
const aiApiKeyEl = $<HTMLInputElement>("ai-api-key");
const aiModelEl = $<HTMLInputElement>("ai-model");
const aiSaveBtn = $<HTMLButtonElement>("ai-save");
const aiTestBtn = $<HTMLButtonElement>("ai-test");
const aiStatusEl = $("ai-status");
const aiKeyToggleBtn = $("ai-key-toggle");
const aiPromptEl = $<HTMLTextAreaElement>("ai-prompt");
const aiFetchModelsBtn = $<HTMLButtonElement>("ai-fetch-models");
const aiModelDropdown = $("ai-model-dropdown");
const summarizePageBtn = $("summarize-page");
const aiTemperatureEl = $<HTMLInputElement>("ai-temperature");
const aiMaxTokensEl = $<HTMLInputElement>("ai-max-tokens");
const aiMaxContentLengthEl = $<HTMLInputElement>("ai-max-content-length");
let modelList: string[] = []; // 从 API 获取的模型列表

function setAIStatus(text: string, type?: "" | "error" | "success"): void {
  setStatus(aiStatusEl, text, type);
}

/**
 * 重新从存储加载 AI 配置到表单（供外部模块调用，如配置导入后刷新）
 */
export async function reloadAIForm(): Promise<void> {
  const config = await getAIConfig();
  if (aiBaseUrlEl) aiBaseUrlEl.value = config.baseUrl || "";
  if (aiApiKeyEl) aiApiKeyEl.value = config.apiKey || "";
  if (aiModelEl) aiModelEl.value = config.model || "";
  if (aiPromptEl) aiPromptEl.value = config.prompt || "";
  if (aiTemperatureEl) aiTemperatureEl.value = config.temperature != null ? String(config.temperature) : "";
  if (aiMaxTokensEl) aiMaxTokensEl.value = config.maxTokens ? String(config.maxTokens) : "";
  if (aiMaxContentLengthEl) aiMaxContentLengthEl.value = config.maxContentLength ? String(config.maxContentLength) : "";
  summarizePageBtn?.classList.toggle("visible", !!config.apiKey);
}

/**
 * 初始化 AI 设置
 */
export async function initAISettings(): Promise<void> {
  const config = await getAIConfig();
  const configured = !!config.apiKey;
  setAIConfigured(configured);

  // 显示/隐藏「总结当前网页」按钮
  if (summarizePageBtn) {
    summarizePageBtn.classList.toggle("visible", configured);
    summarizePageBtn.addEventListener("click", onSummarizePage);
  }

  if (aiBaseUrlEl) aiBaseUrlEl.value = config.baseUrl || "";
  if (aiApiKeyEl) aiApiKeyEl.value = config.apiKey || "";
  if (aiModelEl) aiModelEl.value = config.model || "";
  if (aiPromptEl) aiPromptEl.value = config.prompt || "";
  if (aiTemperatureEl) aiTemperatureEl.value = config.temperature != null ? String(config.temperature) : "";
  if (aiMaxTokensEl) aiMaxTokensEl.value = config.maxTokens ? String(config.maxTokens) : "";
  if (aiMaxContentLengthEl) aiMaxContentLengthEl.value = config.maxContentLength ? String(config.maxContentLength) : "";

  // 保存配置
  aiSaveBtn?.addEventListener("click", async () => {
    const tempVal = parseFloat(aiTemperatureEl?.value || "");
    const maxTokVal = parseInt(aiMaxTokensEl?.value || "", 10);
    const maxLenVal = parseInt(aiMaxContentLengthEl?.value || "", 10);
    const newConfig = {
      baseUrl: aiBaseUrlEl?.value.trim() || "https://api.openai.com/v1",
      apiKey: aiApiKeyEl?.value.trim() || "",
      model: aiModelEl?.value.trim() || "gpt-4o-mini",
      prompt: aiPromptEl?.value.trim() || "",
      temperature: Number.isFinite(tempVal) ? Math.min(2, Math.max(0, tempVal)) : 0.7,
      maxTokens: Number.isFinite(maxTokVal) && maxTokVal >= 256 ? maxTokVal : 8192,
      maxContentLength: Number.isFinite(maxLenVal) && maxLenVal >= 5000 ? maxLenVal : 80000,
    };
    await setAIConfig(newConfig);
    setAIConfigured(!!newConfig.apiKey);
    setAIStatus("✓ 配置已保存", "success");
    showToast("✓ AI 配置已保存");
    summarizePageBtn?.classList.toggle("visible", !!newConfig.apiKey);
    renderFilteredItems();
  });

  // 测试连接
  aiTestBtn?.addEventListener("click", async () => {
    const apiKey = aiApiKeyEl?.value.trim() || "";
    if (!apiKey) {
      setAIStatus("请先输入 API Key", "error");
      return;
    }

    if (aiTestBtn) {
      aiTestBtn.disabled = true;
      aiTestBtn.textContent = "测试中…";
    }
    setAIStatus("正在测试连接…");

    try {
      const baseUrl = (aiBaseUrlEl?.value.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
      const model = aiModelEl?.value.trim() || "gpt-4o-mini";
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      });

      if (res.ok) {
        setAIStatus("✓ 连接成功！", "success");
      } else {
        const errorBody = await res.text().catch(() => "");
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.error?.message) errorMsg = errorJson.error.message;
        } catch {
          /* ignore */
        }
        setAIStatus(`连接失败：${errorMsg}`, "error");
      }
    } catch (e) {
      setAIStatus(`连接失败：${(e as Error).message}`, "error");
    } finally {
      if (aiTestBtn) {
        aiTestBtn.disabled = false;
        aiTestBtn.textContent = "测试连接";
      }
    }
  });

  // API Key 显示/隐藏切换
  aiKeyToggleBtn?.addEventListener("click", () => {
    if (!aiApiKeyEl) return;
    if (aiApiKeyEl.type === "password") {
      aiApiKeyEl.type = "text";
    } else {
      aiApiKeyEl.type = "password";
    }
  });

  // 获取模型列表
  aiFetchModelsBtn?.addEventListener("click", () => fetchModels());

  // 输入框获焦时显示下拉（如果有数据）
  aiModelEl?.addEventListener("focus", () => {
    if (modelList.length > 0) showModelDropdown();
  });

  // 输入时过滤下拉列表
  aiModelEl?.addEventListener("input", () => {
    if (modelList.length > 0) showModelDropdown();
  });

  // 点击其他区域关闭下拉
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".model-select-wrap")) {
      hideModelDropdown();
    }
  });

}

// ── 获取模型列表 ──────────────────────────────

async function fetchModels(): Promise<void> {
  const apiKey = aiApiKeyEl?.value.trim() || "";
  const baseUrl = (aiBaseUrlEl?.value.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");

  if (!apiKey) {
    setAIStatus("请先输入 API Key", "error");
    return;
  }

  if (aiFetchModelsBtn) {
    aiFetchModelsBtn.disabled = true;
    aiFetchModelsBtn.classList.add("loading");
  }
  setAIStatus("正在获取模型列表…");

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error?.message) errorMsg = errorJson.error.message;
      } catch { /* ignore */ }
      setAIStatus(`获取模型失败：${errorMsg}`, "error");
      return;
    }

    const data = await res.json();
    modelList = ((data.data || []) as { id: string }[])
      .map((m) => m.id)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    if (modelList.length === 0) {
      setAIStatus("未获取到可用模型", "error");
      return;
    }

    showModelDropdown();
    setAIStatus(`✓ 已获取 ${modelList.length} 个模型`, "success");
  } catch (e) {
    setAIStatus(`获取模型失败：${(e as Error).message}`, "error");
  } finally {
    if (aiFetchModelsBtn) {
      aiFetchModelsBtn.disabled = false;
      aiFetchModelsBtn.classList.remove("loading");
    }
  }
}

// ── 模型下拉框 ──────────────────────────────

function showModelDropdown(): void {
  if (!aiModelDropdown || modelList.length === 0) return;

  const keyword = (aiModelEl?.value || "").trim().toLowerCase();
  const filtered = keyword
    ? modelList.filter((id) => id.toLowerCase().includes(keyword))
    : modelList;

  if (filtered.length === 0) {
    aiModelDropdown.innerHTML = `<li class="model-dropdown-empty">无匹配模型</li>`;
  } else {
    const currentVal = (aiModelEl?.value || "").trim();
    aiModelDropdown.innerHTML = filtered
      .map((id) => {
        const isActive = id === currentVal ? ' class="active"' : '';
        return `<li${isActive} data-model="${id}">${id}</li>`;
      })
      .join("");
  }

  aiModelDropdown.classList.add("show");

  // 绑定点击选择
  aiModelDropdown.querySelectorAll("li[data-model]").forEach((li) => {
    li.addEventListener("click", () => {
      if (aiModelEl) aiModelEl.value = (li as HTMLElement).dataset.model || "";
      hideModelDropdown();
    });
  });
}

function hideModelDropdown(): void {
  aiModelDropdown?.classList.remove("show");
}

// ── 总结当前网页 ──────────────────────────────

async function onSummarizePage(): Promise<void> {
  if (platform.isElectron) {
    showToast("桌面版暂不支持总结当前网页");
    return;
  }
  try {
    const [tab] = await platform.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || !tab.url) {
      showToast("无法获取当前页面信息");
      return;
    }
    if (!/^https?:\/\//.test(tab.url)) {
      showToast("仅支持 http/https 网页");
      return;
    }
    const params = new URLSearchParams();
    params.set("title", tab.title || "");
    params.set("link", tab.url);
    params.set("mode", "page");
    params.set("tabId", String(tab.id));
    await openAIPanelWindow(params);
  } catch (e) {
    showToast("打开失败：" + (e as Error).message);
  }
}
