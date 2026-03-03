/**
 * Electron 存储层
 *
 * 用 electron-store 替代 chrome.storage.sync / chrome.storage.local
 * 两个独立的 store 实例分别对应 sync 和 local 数据
 */

import Store from "electron-store";

let syncStore: Store | null = null;
let localStore: Store | null = null;

function getSyncStore(): Store {
  if (!syncStore) {
    syncStore = new Store({ name: "sync-data" });
  }
  return syncStore;
}

function getLocalStore(): Store {
  if (!localStore) {
    localStore = new Store({ name: "local-data" });
  }
  return localStore;
}

export function syncGet(keys: string[]): Record<string, unknown> {
  const store = getSyncStore();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const val = store.get(key);
    if (val !== undefined) result[key] = val;
  }
  return result;
}

export function syncSet(data: Record<string, unknown>): void {
  const store = getSyncStore();
  for (const [key, value] of Object.entries(data)) {
    store.set(key, value);
  }
}

export function localGet(keys: string[]): Record<string, unknown> {
  const store = getLocalStore();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const val = store.get(key);
    if (val !== undefined) result[key] = val;
  }
  return result;
}

export function localSet(data: Record<string, unknown>): void {
  const store = getLocalStore();
  for (const [key, value] of Object.entries(data)) {
    store.set(key, value);
  }
}
