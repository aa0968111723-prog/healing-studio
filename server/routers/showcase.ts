/**
 * showcase.ts — 首頁精選展示唯讀 tRPC Router
 *
 * 所有端點皆為 publicProcedure（唯讀），前端絕不直連第三方 API。
 * 實作 Cursor-based LOD 分頁，支援模態篩選與熱門排序。
 *
 * 端點清單：
 *   showcase.list       — LOD 分頁列表（cursor + limit + modality 篩選）
 *   showcase.getById    — 單件作品詳情（含完整解構積木 + 情緒矩陣）
 *   showcase.trending   — 熱門作品列表（按讚數 + fork 數加權排序）
 *   showcase.byModality — 依模態篩選作品（image / video / audio / voice）
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { featuredShowcase } from "../../drizzle/schema";
import { eq, desc, and, lt, sql } from "drizzle-orm";
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
        limit: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
        modality: z.enum(MODALITIES).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
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
      const db = await requireDb();

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
      const db = await requireDb();
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
        limit: z
          .number()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .default(DEFAULT_PAGE_SIZE),
        cursor: z.number().nullish(),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
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
        .orderBy(
          desc(featuredShowcase.sortWeight),
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
   * showcase.stats — 展示區統計摘要
   *
   * 回傳各模態的作品數量，前端用於渲染統計 Badge。
   */
  stats: publicProcedure.query(async () => {
    const db = await requireDb();

    const modalityCounts = await db
      .select({
        modality: featuredShowcase.modality,
        count: sql<number>`COUNT(*)`.as("count"),
        totalLikes: sql<number>`COALESCE(SUM(${featuredShowcase.likeCount}), 0)`.as(
          "totalLikes"
        ),
        totalForks: sql<number>`COALESCE(SUM(${featuredShowcase.forkCount}), 0)`.as(
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

    return modalityCounts.map((m) => ({
      key: m.modality,
      label: modalityLabels[m.modality] || m.modality,
      count: Number(m.count),
      totalLikes: Number(m.totalLikes),
      totalForks: Number(m.totalForks),
    }));
  }),
});
