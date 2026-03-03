# 存储结构说明

本插件使用 Chrome Storage API 持久化数据，分为 `sync` 和 `local` 两层。

## chrome.storage.sync — 用户核心数据（跨浏览器同步）

> 限制：总量 100KB，单 key 8KB，最多 512 个 key。超出 quota 时自动回退到 local。

| Key | 类型 | 说明 |
|---|---|---|
| `feeds` | `string[]` | 用户订阅的 RSS 源 URL 列表（有序，支持拖拽排序） |
| `feedMeta` | `Record<string, FeedMeta>` | 每个源的元信息，key 为 URL。`FeedMeta.type` 取值：`"rss"` \| `"page"` \| `"page-js"` \| `"unknown"` |
| `pausedFeeds` | `string[]` | 已暂停自动抓取的订阅源 URL 列表 |
| `favorites` | `string[]` | 收藏文章的链接列表 |
| `favoriteDetails` | `Record<string, FavoriteDetail>` | 收藏文章的详细信息，key 为文章 link。字段：`{ link, title, description, feedUrl, publishedAt, favoritedAt }` |
| `theme` | `"light"` \| `"dark"` | 主题偏好 |
| `aiConfig` | `AIConfig` | AI 功能配置：`{ apiKey, baseUrl, model, prompt }`。默认 baseUrl 为 `https://api.openai.com/v1`，默认 model 为 `gpt-4o-mini` |

## chrome.storage.local — 文章缓存与状态（仅本地）

| Key | 类型 | 说明 |
|---|---|---|
| `itemsByFeed` | `Record<string, FeedItem[]>` | 各订阅源的文章缓存，key 为源 URL。`FeedItem` 字段：`{ id, title, link, description, publishedAt, feedUrl? }`。每源最多 50 条 |
| `readItems` | `string[]` | 已读文章的 link 列表 |
| `_syncMigrated` | `boolean` | 数据迁移标记（local → sync 是否已完成，仅执行一次） |

## 如何查看存储数据

### 方法一：Chrome DevTools

1. 打开 `chrome://extensions/`
2. 找到本插件，点击 **"Service Worker"** 链接打开 DevTools
3. 切换到 **Application** 标签页
4. 左侧栏 **Storage** 区域可分别查看 `chrome.storage.local` 和 `chrome.storage.sync`

### 方法二：Console 命令

在 Service Worker 的 Console 中执行：

```js
// 查看所有 sync 数据
chrome.storage.sync.get(null, (data) => console.log('sync:', data));

// 查看所有 local 数据
chrome.storage.local.get(null, (data) => console.log('local:', data));
```

## 写入逻辑

- **安全写入**：所有 sync 写入通过 `safeSync()` 封装，写入失败时自动回退到 local
- **读取策略**：优先从 sync 读取，缺失的 key 回退到 local 补漏
- **数据迁移**：首次运行时自动将 local 中的旧数据迁移到 sync（通过 `_syncMigrated` 标记防止重复执行）

## 相关源码

- 存储封装：`src/services/storage.ts`
- 后台抓取与写入：`src/background.ts`
- 类型定义：`src/types.ts`（`FeedItem`、`FeedMeta`、`FavoriteDetail`、`AIConfig` 等）
