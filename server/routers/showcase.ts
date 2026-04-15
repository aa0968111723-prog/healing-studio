/**
 * showcase.ts — 首頁精選展示 tRPC Router
 *
 * 唯讀端點使用 publicProcedure，寫入端點使用 protectedProcedure。
 * 實作 Cursor-based LOD 分頁，支援模態篩選與熱門排序。
 *
 * 端點清單：
 *   showcase.list       — LOD 分頁列表（cursor + limit + modality 篩選）
 *   showcase.getById    — 單件作品詳情（含完整解構積木 + 情緒矩陣）
 *   showcase.trending   — 熱門作品列表（按讚數 + fork 數加權排序）
 *   showcase.byModality — 依模態篩選作品（image / video / audio / voice）
 *   showcase.promote    — 將歷史紀錄加入精選（需登入）
 *   showcase.myItems    — 查詢我的精選作品（需登入）
 *   showcase.removeItem — 移除我的精選作品（需登入）
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { featuredShowcase, generationHistory } from "../../drizzle/schema";
import { eq, desc, and, lt, sql, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";

// ─── Shared Constants ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;
const TRENDING_LIMIT = 8;

// ─── Modality enum values (must match schema) ────────────────────────────────

const MODALITIES = ["image", "video", "audio", "voice"] as const;

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

/** 嘗試取得 DB，DB 不可用時回傳 null（公開唯讀端點用，優雅降級） */
async function tryDb() {
  return await getDb();
}

// ─── LOD Field Sets ──────────────────────────────────────────────────────────

/** 列表層級：輕量欄位，適合網格/卡片預覽 */
const LIST_FIELDS = {
  id: featuredShowcase.id,
  title: featuredShowcase.title,
  description: featuredShowcase.description,
  imageUrl: featuredShowcase.imageUrl,
  thumbnailUrl: featuredShowcase.thumbnailUrl,
  modality: featuredShowcase.modality,
  sortWeight: featuredShowcase.sortWeight,
  likeCount: featuredShowcase.likeCount,
  forkCount: featuredShowcase.forkCount,
  createdAt: featuredShowcase.createdAt,
  // LOD: 不含 vibeParameters、completelyDeconstructedBlocks、originalPrompt
} as const;

// ─── Showcase Router ──────────────────────────────────────────────────────────

export const showcaseRouter = router({
  /**
   * showcase.list — LOD 分頁列表
   *
   * Cursor-based pagination：使用作品 ID 作為游標。
   * 列表只回傳預覽欄位（LOD Level 1），不含重量級 JSON 欄位。
   * 支援 modality 篩選。
   * 排序：sortWeight DESC → likeCount DESC → id DESC
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
        modality: z.enum(MODALITIES).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      // DB 不可用時，優雅降級為空結果（首頁仍可顯示，但無精選作品）
      if (!db) return { items: [], nextCursor: undefined };

      const { limit, cursor, modality } = input;

      const conditions = [eq(featuredShowcase.isActive, true)];

      if (cursor) {
        conditions.push(lt(featuredShowcase.id, cursor));
      }

      if (modality) {
        conditions.push(eq(featuredShowcase.modality, modality));
      }

      const items = await db
        .select(LIST_FIELDS)
        .from(featuredShowcase)
        .where(and(...conditions))
        .orderBy(
          desc(featuredShowcase.sortWeight),
          desc(featuredShowcase.likeCount),
          desc(featuredShowcase.id)
        )
        .limit(limit + 1);

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * showcase.getById — 單件作品詳情
   *
   * LOD Level 2：回傳完整欄位，包含 vibeParameters、
   * completelyDeconstructedBlocks、originalPrompt。
   * 前端用於作品詳情 Modal / 一鍵複製配方。
   */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await tryDb();
      if (!db)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "資料庫暫時無法連線，找不到此作品。",
        });

      const results = await db
        .select()
        .from(featuredShowcase)
        .where(
          and(
            eq(featuredShowcase.id, input.id),
            eq(featuredShowcase.isActive, true)
          )
        )
        .limit(1);

      if (results.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到這件展示作品，可能已被移除。",
        });
      }

      return results[0];
    }),

  /**
   * showcase.trending — 熱門作品列表
   *
   * 首頁「本週熱門」區塊專用。
   * 排序公式：(likeCount * 2 + forkCount * 3) DESC
   * 固定上限 8 件。
   */
  trending: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(20).default(TRENDING_LIMIT),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      if (!db) return [];
      const limit = input?.limit ?? TRENDING_LIMIT;

      return db
        .select(LIST_FIELDS)
        .from(featuredShowcase)
        .where(eq(featuredShowcase.isActive, true))
        .orderBy(
          desc(
            sql`(${featuredShowcase.likeCount} * 2 + ${featuredShowcase.forkCount} * 3)`
          ),
          desc(featuredShowcase.id)
        )
        .limit(limit);
    }),

  /**
   * showcase.byModality — 依模態篩選作品
   *
   * 支援 cursor-based 分頁。
   * 前端用於模態 Tab 切換。
   */
  byModality: publicProcedure
    .input(
      z.object({
        modality: z.enum(MODALITIES),
        limit: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
      })
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      if (!db) return { items: [], nextCursor: undefined };
      const { modality, limit, cursor } = input;

      const conditions = [
        eq(featuredShowcase.isActive, true),
        eq(featuredShowcase.modality, modality),
      ];

      if (cursor) {
        conditions.push(lt(featuredShowcase.id, cursor));
      }

      const items = await db
        .select(LIST_FIELDS)
        .from(featuredShowcase)
        .where(and(...conditions))
        .orderBy(desc(featuredShowcase.sortWeight), desc(featuredShowcase.id))
        .limit(limit + 1);

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * showcase.byAesthetics — 依美學偏好篩選作品
   *
   * 代理暗中重構環境專用端點。
   * 接收 Gemini Director 偵測到的美學標籤陣列，
   * 在 title / description / originalPrompt 中模糊比對，
   * 回傳匹配的作品列表（LOD Level 1）。
   * 排序：匹配度 DESC → sortWeight DESC → likeCount DESC
   */
  byAesthetics: publicProcedure
    .input(
      z.object({
        aesthetics: z.array(z.string()).min(1).max(20),
        limit: z.number().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
        excludeIds: z.array(z.number()).max(100).default([]),
      })
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      if (!db) return { items: [], nextCursor: undefined, totalMatched: 0 };
      const { aesthetics, limit, cursor, excludeIds } = input;

      // Build LIKE conditions for each aesthetic tag across searchable fields
      const likeConditions = aesthetics.map(tag => {
        const pattern = `%${tag}%`;
        return sql`(
          ${featuredShowcase.title} LIKE ${pattern}
          OR ${featuredShowcase.description} LIKE ${pattern}
          OR ${featuredShowcase.originalPrompt} LIKE ${pattern}
        )`;
      });

      // Match score: count how many aesthetic tags match
      const matchScore = sql<number>`(
        ${sql.join(
          aesthetics.map(tag => {
            const pattern = `%${tag}%`;
            return sql`(
              (${featuredShowcase.title} LIKE ${pattern}) +
              (${featuredShowcase.description} LIKE ${pattern}) +
              (${featuredShowcase.originalPrompt} LIKE ${pattern})
            )`;
          }),
          sql` + `
        )}
      )`.as("match_score");

      const conditions = [
        eq(featuredShowcase.isActive, true),
        sql`(${sql.join(likeConditions, sql` OR `)})`,
      ];

      if (cursor) {
        conditions.push(lt(featuredShowcase.id, cursor));
      }

      // Exclude already-visible items
      if (excludeIds.length > 0) {
        conditions.push(
          sql`${featuredShowcase.id} NOT IN (${sql.join(
            excludeIds.map(id => sql`${id}`),
            sql`, `
          )})`
        );
      }

      const items = await db
        .select({
          ...LIST_FIELDS,
          matchScore,
        })
        .from(featuredShowcase)
        .where(and(...conditions))
        .orderBy(
          desc(sql`match_score`),
          desc(featuredShowcase.sortWeight),
          desc(featuredShowcase.likeCount),
          desc(featuredShowcase.id)
        )
        .limit(limit + 1);

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return {
        items: items.map(({ matchScore: _ms, ...rest }) => rest),
        nextCursor,
        totalMatched: items.length,
      };
    }),

  /**
   * showcase.promote — 將歷史紀錄加入首頁精選（需登入）
   *
   * 使用者可將自己的生成作品提交到精選展示區，
   * 每位使用者每天最多可提交 5 件作品。
   */
  promote: protectedProcedure
    .input(
      z.object({
        historyId: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.user.id;

      // Verify history item belongs to this user and has a resultUrl
      const historyItems = await db
        .select()
        .from(generationHistory)
        .where(
          and(
            eq(generationHistory.id, input.historyId),
            eq(generationHistory.userId, userId)
          )
        )
        .limit(1);

      if (historyItems.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到此生成紀錄，或您沒有權限提交此作品。",
        });
      }

      const historyItem = historyItems[0];
      if (!historyItem.resultUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "此生成紀錄沒有結果 URL，無法加入精選。",
        });
      }

      // Check per-day limit (max 5 per user per day)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(featuredShowcase)
        .where(
          and(
            eq(featuredShowcase.curatorUserId, userId),
            sql`${featuredShowcase.createdAt} >= ${todayStart}`
          )
        );

      const count = Number((todayCount[0] as any)?.count ?? 0);
      if (count >= 5) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "今日提交數量已達上限（每天最多 5 件），請明天再試。",
        });
      }

      // Determine modality
      const modality = (historyItem.modality ?? "image") as
        | "image"
        | "video"
        | "audio"
        | "voice";

      // Insert into featured showcase
      await db.insert(featuredShowcase).values({
        generatedItemId: historyItem.id,
        title: input.title,
        description: input.description ?? null,
        imageUrl: historyItem.resultUrl,
        thumbnailUrl: historyItem.thumbnailUrl ?? historyItem.resultUrl,
        originalPrompt: historyItem.prompt ?? "",
        modality,
        curatorUserId: userId,
        sortWeight: 0,
        isActive: true,
        likeCount: 0,
        forkCount: 0,
      });

      return { success: true };
    }),

  /**
   * showcase.myItems — 查詢我的精選作品（需登入）
   */
  myItems: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const userId = ctx.user.id;

    const items = await db
      .select({
        id: featuredShowcase.id,
        title: featuredShowcase.title,
        description: featuredShowcase.description,
        imageUrl: featuredShowcase.imageUrl,
        modality: featuredShowcase.modality,
        likeCount: featuredShowcase.likeCount,
        forkCount: featuredShowcase.forkCount,
        isActive: featuredShowcase.isActive,
        createdAt: featuredShowcase.createdAt,
      })
      .from(featuredShowcase)
      .where(eq(featuredShowcase.curatorUserId, userId))
      .orderBy(desc(featuredShowcase.createdAt))
      .limit(50);

    return items;
  }),

  /**
   * showcase.removeItem — 移除我的精選作品（需登入）
   */
  removeItem: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const userId = ctx.user.id;

      // Verify ownership
      const items = await db
        .select({ id: featuredShowcase.id })
        .from(featuredShowcase)
        .where(
          and(
            eq(featuredShowcase.id, input.id),
            eq(featuredShowcase.curatorUserId, userId)
          )
        )
        .limit(1);

      if (items.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到此精選作品，或您沒有權限移除。",
        });
      }

      await db
        .update(featuredShowcase)
        .set({ isActive: false })
        .where(eq(featuredShowcase.id, input.id));

      return { success: true };
    }),

  /**
   * showcase.stats — 展示區統計摘要
   *
   * 回傳各模態的作品數量，前端用於渲染統計 Badge。
   */
  stats: publicProcedure.query(async () => {
    const db = await tryDb();
    if (!db) return [];

    const modalityCounts = await db
      .select({
        modality: featuredShowcase.modality,
        count: sql<number>`COUNT(*)`.as("count"),
        totalLikes:
          sql<number>`COALESCE(SUM(${featuredShowcase.likeCount}), 0)`.as(
            "totalLikes"
          ),
        totalForks:
          sql<number>`COALESCE(SUM(${featuredShowcase.forkCount}), 0)`.as(
            "totalForks"
          ),
      })
      .from(featuredShowcase)
      .where(eq(featuredShowcase.isActive, true))
      .groupBy(featuredShowcase.modality);

    const modalityLabels: Record<string, string> = {
      image: "圖像",
      video: "影片",
      audio: "音樂",
      voice: "語音",
    };

    return modalityCounts.map(m => ({
      key: m.modality,
      label: modalityLabels[m.modality] || m.modality,
      count: Number(m.count),
      totalLikes: Number(m.totalLikes),
      totalForks: Number(m.totalForks),
    }));
  }),
});
