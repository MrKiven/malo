/**
 * 收藏功能存储
 *
 * 收藏数据使用 chrome.storage.sync（跨浏览器同步）
 */

import type { FeedItem, FavoriteDetail } from "../../types";
import { safeSync, getFromSync } from "./helpers";

// ── Favorites（收藏 → sync）─────────────────────────

/**
 * 获取所有收藏的文章链接集合
 */
export async function getFavorites(): Promise<Set<string>> {
  const { favorites = [] } = await getFromSync(["favorites"]);
  return new Set(Array.isArray(favorites) ? favorites as string[] : []);
}

/**
 * 收藏一篇文章（存储完整信息以便独立展示）
 */
export async function addFavorite(article: FeedItem): Promise<void> {
  if (!article?.link) return;
  const { favorites = [], favoriteDetails = {} } = await getFromSync(["favorites", "favoriteDetails"]);
  const links = Array.isArray(favorites) ? favorites as string[] : [];
  if (!links.includes(article.link)) {
    links.push(article.link);
  }
  const details = (favoriteDetails && typeof favoriteDetails === "object")
    ? favoriteDetails as Record<string, FavoriteDetail>
    : {};
  details[article.link] = {
    link: article.link,
    title: (article.title || "").slice(0, 120),
    description: (article.description || "").slice(0, 100),
    feedUrl: article.feedUrl || "",
    publishedAt: article.publishedAt || 0,
    favoritedAt: Date.now(),
  };
  await safeSync({ favorites: links, favoriteDetails: details });
}

/**
 * 取消收藏
 */
export async function removeFavorite(link: string): Promise<void> {
  if (!link) return;
  const { favorites = [], favoriteDetails = {} } = await getFromSync(["favorites", "favoriteDetails"]);
  const links = Array.isArray(favorites) ? favorites as string[] : [];
  const updated = links.filter((l) => l !== link);
  const details = (favoriteDetails && typeof favoriteDetails === "object")
    ? favoriteDetails as Record<string, FavoriteDetail>
    : {};
  delete details[link];
  await safeSync({ favorites: updated, favoriteDetails: details });
}

/**
 * 获取所有收藏文章的详细信息（按收藏时间降序）
 */
export async function getFavoriteDetails(): Promise<FavoriteDetail[]> {
  const { favoriteDetails = {} } = await getFromSync(["favoriteDetails"]);
  const details = (favoriteDetails && typeof favoriteDetails === "object")
    ? favoriteDetails as Record<string, FavoriteDetail>
    : {};
  const list = Object.values(details);
  list.sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
  return list;
}
