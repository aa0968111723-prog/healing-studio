/**
 * news.ts — 首頁新聞唯讀 tRPC Router
 *
 * 所有端點皆為 publicProcedure（唯讀），前端絕不直連第三方 API。
 * 實作 Cursor-based LOD 分頁，支援分類篩選與置頂文章優先。
 *
 * 端點清單：
 *   news.list       — LOD 分頁列表（cursor + limit + category 篩選）
 *   news.getById    — 單篇文章詳情（含閱讀次數 +1）
 *   news.pinned     — 置頂文章列表（首頁 Hero 區塊用）
 *   news.categories — 可用分類列表（含各分類文章數）
 *   news.byTag      — 依標籤篩選文章
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { newsArticles } from "../../drizzle/schema";
import { eq, desc, and, lt, sql, like } from "drizzle-orm";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { logDatabaseError, logValidationError } from "../_core/logger";
import { metrics } from "../_core/metrics";

// ─── Shared Constants ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const PINNED_LIMIT = 5;

// ─── Category enum values (must match schema) ────────────────────────────────

const NEWS_CATEGORIES = [
  "product_update",
  "community_highlight",
  "tutorial",
  "industry_news",
  "tips_and_tricks",
] as const;

// ─── Helper: safe DB access ──────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "資料庫暫時無法連線，請稍後再試。",
    });
  }
  return db;
}

/** 嘗試取得 DB，DB 不可用時回傳 null（公開唯讀端點用，降級為空結果） */
async function tryDb() {
  return await getDb();
}

// ─── News Router ──────────────────────────────────────────────────────────────

export const newsRouter = router({
  /**
   * news.list — LOD 分頁列表
   *
   * Cursor-based pagination：使用文章 ID 作為游標，
   * 每次回傳 limit 筆 + nextCursor（若還有更多資料）。
   * 支援 category 篩選。
   *
   * LOD (Level of Detail)：
   *   列表只回傳摘要欄位（不含 bodyMarkdown），降低傳輸量。
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(), // 上一頁最後一筆的 ID
        category: z.enum(NEWS_CATEGORIES).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      // DB 不可用時，優雅降級為空結果（首頁仍可顯示，但無新聞資料）
      if (!db) {
        logDatabaseError("news.list — DB unavailable", null, { endpoint: "news.list" });
        metrics.recordError("news.list", 503, "DB_UNAVAILABLE");
        return { items: [], nextCursor: undefined };
      }

      const { limit, cursor, category } = input;

      // Build WHERE conditions
      const conditions = [eq(newsArticles.isPublished, true)];

      if (cursor) {
        conditions.push(lt(newsArticles.id, cursor));
      }

      if (category) {
        conditions.push(eq(newsArticles.category, category));
      }

      try {
        // Query: published articles, ordered by pinned first then newest
        const articles = await db
          .select({
            id: newsArticles.id,
            title: newsArticles.title,
            oarsSummary: newsArticles.oarsSummary,
            sourceName: newsArticles.sourceName,
            sourceUrl: newsArticles.sourceUrl,
            coverImageUrl: newsArticles.coverImageUrl,
            category: newsArticles.category,
            tags: newsArticles.tags,
            isPinned: newsArticles.isPinned,
            publishedAt: newsArticles.publishedAt,
            viewCount: newsArticles.viewCount,
            createdAt: newsArticles.createdAt,
            // LOD: bodyMarkdown 不在列表中回傳
          })
          .from(newsArticles)
          .where(and(...conditions))
          .orderBy(desc(newsArticles.isPinned), desc(newsArticles.id))
          .limit(limit + 1); // +1 to detect if there are more

        // Determine nextCursor
        let nextCursor: number | undefined;
        if (articles.length > limit) {
          const nextItem = articles.pop()!;
          nextCursor = nextItem.id;
        }

        return { items: articles, nextCursor };
      } catch (err) {
        logDatabaseError("news.list — select failed", err, {
          endpoint: "news.list",
          limit,
          cursor,
          category,
        });
        metrics.recordError("news.list", 500, "DB_QUERY_FAILED");
        // Graceful degradation — return empty list rather than 500
        return { items: [], nextCursor: undefined };
      }
    }),

  /**
   * news.getById — 單篇文章詳情
   *
   * 回傳完整內容（含 bodyMarkdown），並自動將 viewCount +1。
   * LOD 完整層級：包含所有欄位。
   */
  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();

      let results;
      try {
        results = await db
          .select()
          .from(newsArticles)
          .where(
            and(eq(newsArticles.id, input.id), eq(newsArticles.isPublished, true))
          )
          .limit(1);
      } catch (err) {
        logDatabaseError("news.getById — select failed", err, {
          endpoint: "news.getById",
          articleId: input.id,
        });
        metrics.recordError("news.getById", 500, "DB_QUERY_FAILED");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "資料庫查詢失敗，請稍後再試。",
        });
      }

      if (results.length === 0) {
        metrics.recordError("news.getById", 404, "NOT_FOUND");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到這篇文章，可能已被移除或尚未發布。",
        });
      }

      // Increment view count (fire-and-forget, don't block response)
      db.update(newsArticles)
        .set({ viewCount: sql`${newsArticles.viewCount} + 1` })
        .where(eq(newsArticles.id, input.id))
        .catch(err => {
          logDatabaseError("news.getById — viewCount update failed", err, {
            endpoint: "news.getById",
            articleId: input.id,
          });
        });

      return results[0];
    }),

  /**
   * news.pinned — 置頂文章列表
   *
   * 首頁 Hero 區塊專用，只回傳已置頂且已發布的文章。
   * 固定上限 5 篇，按發布時間倒序。
   */
  pinned: publicProcedure.query(async () => {
    const db = await requireDb();

    try {
      return await db
        .select({
          id: newsArticles.id,
          title: newsArticles.title,
          oarsSummary: newsArticles.oarsSummary,
          sourceName: newsArticles.sourceName,
          sourceUrl: newsArticles.sourceUrl,
          coverImageUrl: newsArticles.coverImageUrl,
          category: newsArticles.category,
          tags: newsArticles.tags,
          publishedAt: newsArticles.publishedAt,
          viewCount: newsArticles.viewCount,
        })
        .from(newsArticles)
        .where(
          and(eq(newsArticles.isPinned, true), eq(newsArticles.isPublished, true))
        )
        .orderBy(desc(newsArticles.publishedAt))
        .limit(PINNED_LIMIT);
    } catch (err) {
      logDatabaseError("news.pinned — select failed", err, { endpoint: "news.pinned" });
      metrics.recordError("news.pinned", 500, "DB_QUERY_FAILED");
      return [];
    }
  }),

  /**
   * news.categories — 可用分類列表（含各分類文章數）
   *
   * 前端用於渲染分類篩選 Tab。
   */
  categories: publicProcedure.query(async () => {
    const db = await requireDb();

    // Map to a structured response with labels
    const categoryLabels: Record<string, string> = {
      product_update: "產品更新",
      community_highlight: "社群精選",
      tutorial: "教學指南",
      industry_news: "產業動態",
      tips_and_tricks: "技巧心法",
    };

    try {
      const counts = await db
        .select({
          category: newsArticles.category,
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(newsArticles)
        .where(eq(newsArticles.isPublished, true))
        .groupBy(newsArticles.category);

      return counts.map(c => ({
        key: c.category,
        label: categoryLabels[c.category] || c.category,
        count: Number(c.count),
      }));
    } catch (err) {
      logDatabaseError("news.categories — select failed", err, {
        endpoint: "news.categories",
      });
      metrics.recordError("news.categories", 500, "DB_QUERY_FAILED");
      return [];
    }
  }),

  /**
   * news.byTag — 依標籤篩選文章
   *
   * 搜尋 tags JSON 欄位中包含指定標籤的文章。
   * 使用 MySQL JSON_CONTAINS 進行查詢。
   * 支援 cursor-based 分頁。
   */
  byTag: publicProcedure
    .input(
      z.object({
        tag: z.string().min(1).max(100),
        limit: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const { tag, limit, cursor } = input;

      const conditions = [
        eq(newsArticles.isPublished, true),
        sql`JSON_CONTAINS(${newsArticles.tags}, ${JSON.stringify(tag)})`,
      ];

      if (cursor) {
        conditions.push(lt(newsArticles.id, cursor));
      }

      try {
        const articles = await db
          .select({
            id: newsArticles.id,
            title: newsArticles.title,
            oarsSummary: newsArticles.oarsSummary,
            sourceName: newsArticles.sourceName,
            sourceUrl: newsArticles.sourceUrl,
            coverImageUrl: newsArticles.coverImageUrl,
            category: newsArticles.category,
            tags: newsArticles.tags,
            isPinned: newsArticles.isPinned,
            publishedAt: newsArticles.publishedAt,
            viewCount: newsArticles.viewCount,
            createdAt: newsArticles.createdAt,
          })
          .from(newsArticles)
          .where(and(...conditions))
          .orderBy(desc(newsArticles.id))
          .limit(limit + 1);

        let nextCursor: number | undefined;
        if (articles.length > limit) {
          const nextItem = articles.pop()!;
          nextCursor = nextItem.id;
        }

        return { items: articles, nextCursor };
      } catch (err) {
        logDatabaseError("news.byTag — select failed", err, {
          endpoint: "news.byTag",
          tag,
          limit,
          cursor,
        });
        metrics.recordError("news.byTag", 500, "DB_QUERY_FAILED");
        return { items: [], nextCursor: undefined };
      }
    }),
});
