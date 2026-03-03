/**
 * Service Worker 入口
 *
 * 负责生命周期管理和消息调度，抓取逻辑委托给 fetcher 模块
 */

import { markAsRead } from "../services/storage";
import { ALARM_NAME, REFRESH_MINUTES } from "../constants";
import { fetchAllFeeds } from "./fetcher";
import { updateBadge } from "./utils";

// ── 生命周期 ─────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_MINUTES });
  fetchAllFeeds();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_MINUTES });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    fetchAllFeeds();
  }
});

// ── 消息处理 ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "fetch-now") {
    fetchAllFeeds();
  }
  if (msg?.type === "mark-read" && msg.link) {
    markAsRead(msg.link).then(() => updateBadge());
  }
  if (msg?.type === "mark-all-read" || msg?.type === "update-badge") {
    updateBadge();
  }
});
