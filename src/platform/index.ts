/**
 * 平台抽象层
 *
 * 统一 Chrome Extension 和 Electron 两种运行环境的 API 差异。
 * 运行时根据 window.electronAPI 是否存在自动选择实现。
 */

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(data: Record<string, unknown>): Promise<void>;
}

export interface PlatformAPI {
  storage: {
    sync: StorageArea;
    local: StorageArea;
  };
  runtime: {
    sendMessage(msg: unknown): void;
    onMessage(handler: (msg: unknown) => void): () => void;
    getURL(path: string): string;
  };
  tabs: {
    create(options: { url: string }): void;
    query(q: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string; title?: string }[]>;
    sendMessage(tabId: number, msg: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript(options: { target: { tabId: number }; func?: () => unknown; files?: string[] }): Promise<{ result: unknown }[]>;
  };
  windows: {
    create(options: { url: string; type: string; width: number; height: number; left?: number; top?: number }): void;
    getCurrent(): Promise<{ left?: number; top?: number; width?: number; height?: number }>;
  };
  isElectron: boolean;
}

function createPlatform(): PlatformAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).electronAPI) {
    return createElectronPlatform();
  }
  return createChromePlatform();
}

function createChromePlatform(): PlatformAPI {
  return {
    storage: {
      sync: {
        get: (keys) => chrome.storage.sync.get(keys),
        set: (data) => chrome.storage.sync.set(data),
      },
      local: {
        get: (keys) => chrome.storage.local.get(keys),
        set: (data) => chrome.storage.local.set(data),
      },
    },
    runtime: {
      sendMessage(msg) {
        chrome.runtime.sendMessage(msg, () => {
          void chrome.runtime.lastError;
        });
      },
      onMessage(handler) {
        const listener = (msg: unknown) => handler(msg);
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
      },
      getURL(path) {
        return chrome.runtime.getURL(path);
      },
    },
    tabs: {
      create(options) {
        chrome.tabs.create(options);
      },
      query(q) {
        return chrome.tabs.query(q);
      },
      sendMessage(tabId, msg) {
        return new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, msg, (response?: unknown) => {
            if (chrome.runtime.lastError || !response) {
              resolve(null);
            } else {
              resolve(response);
            }
          });
        });
      },
    },
    scripting: {
      executeScript(options) {
        return chrome.scripting.executeScript(options as Parameters<typeof chrome.scripting.executeScript>[0]) as Promise<{ result: unknown }[]>;
      },
    },
    windows: {
      create(options) {
        chrome.windows.create(options as chrome.windows.CreateData);
      },
      getCurrent() {
        return chrome.windows.getCurrent();
      },
    },
    isElectron: false,
  };
}

function createElectronPlatform(): PlatformAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).electronAPI;

  return {
    storage: {
      sync: {
        get: (keys) => api.storage.syncGet(keys),
        set: (data) => api.storage.syncSet(data),
      },
      local: {
        get: (keys) => api.storage.localGet(keys),
        set: (data) => api.storage.localSet(data),
      },
    },
    runtime: {
      sendMessage(msg) {
        api.sendMessage(msg);
      },
      onMessage(handler) {
        return api.onMessage(handler);
      },
      getURL(path: string) {
        return path;
      },
    },
    tabs: {
      create(options) {
        api.openExternal(options.url);
      },
      async query() {
        return [];
      },
      async sendMessage() {
        return null;
      },
    },
    scripting: {
      async executeScript() {
        return [];
      },
    },
    windows: {
      create(options) {
        api.openAIPanel(options.url);
      },
      async getCurrent() {
        return { left: 100, top: 100, width: 800, height: 700 };
      },
    },
    isElectron: true,
  };
}

export const platform: PlatformAPI = createPlatform();
