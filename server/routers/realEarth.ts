/**
 * Real Earth Information Router
 *
 * 真實地球資訊系統路由 —— 提供 CRUD 與查詢端點
 * 供前端瀏覽、搜尋、管理真實世界資料（歷史、文化、人文、環境）
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  realEarthEntryInputSchema,
  realEarthSearchSchema,
  type RealEarthEntry,
  type RealEarthSearchResult,
  type RealEarthSearchParams,
} from "../../shared/real-earth-types";
import { seedRealEarthData, hasExistingSeedData } from "../services/realEarthSeeder";

/**
 * 將資料庫 row 轉換成 RealEarthEntry 格式
 */
function rowToEntry(row: NonNullable<Awaited<ReturnType<typeof db.getRealEarthEntry>>>): RealEarthEntry {
  return {
    id: row.id.toString(),
    title: row.title,
    category: row.category as any,
    summary: row.summary,
    content: row.content,
    location: row.locationJson as any,
    historicalPeriod: row.historicalPeriod ?? undefined,
    yearRange: row.yearRangeJson as any,
    imageUrls: (row.imageUrls as string[]) ?? undefined,
    externalLinks: (row.externalLinksJson as any) ?? undefined,
    citations: (row.citationsJson as any) ?? undefined,
    tags: (row.tags as string[]) ?? undefined,
    relatedEntryIds: (row.relatedEntryIds as string[]) ?? undefined,
    quality: row.qualityJson as any,
    isTaiwanFocused: row.isTaiwanFocused ?? false,
    language: (row.language as any) ?? "zh-TW",
    metadata: (row.metadata as any) ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const realEarthRouter = router({
  /** 列出所有條目（可篩選） */
  list: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        taiwanOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await db.getRealEarthEntries({
        category: input?.category,
        taiwanOnly: input?.taiwanOnly,
        limit: input?.limit,
        offset: input?.offset,
      });
      return rows.map(rowToEntry);
    }),

  /** 取得單一條目 */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getRealEarthEntry(parseInt(input.id, 10));
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此條目" });
      }
      return rowToEntry(row);
    }),

  /** 搜尋條目 */
  search: protectedProcedure
    .input(realEarthSearchSchema)
    .query(async ({ ctx, input }): Promise<RealEarthSearchResult> => {
      const page = input.page ?? 1;
      const perPage = input.perPage ?? 20;
      const offset = (page - 1) * perPage;

      const result = await db.searchRealEarthEntries({
        query: input.query,
        categories: input.categories,
        regions: input.regions,
        historicalPeriods: input.historicalPeriods,
        yearRange: input.yearRange,
        tags: input.tags,
        taiwanOnly: input.taiwanOnly,
        minCredibility: input.minCredibility,
        sortBy: input.sortBy ?? "relevance",
        limit: perPage,
        offset,
      });

      return {
        entries: result.rows.map(rowToEntry),
        total: result.total,
        page,
        perPage,
        totalPages: Math.ceil(result.total / perPage),
      };
    }),

  /** 建立新條目 */
  create: protectedProcedure
    .input(realEarthEntryInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const id = await db.createRealEarthEntry({
          title: input.title,
          category: input.category,
          summary: input.summary,
          content: input.content,
          locationJson: input.location ?? null,
          historicalPeriod: input.historicalPeriod ?? null,
          yearRangeJson: input.yearRange ?? null,
          imageUrls: input.imageUrls ?? null,
          externalLinksJson: input.externalLinks ?? null,
          citationsJson: input.citations ?? null,
          tags: input.tags ?? null,
          relatedEntryIds: input.relatedEntryIds ?? null,
          qualityJson: input.quality ?? null,
          isTaiwanFocused: input.isTaiwanFocused ?? false,
          language: input.language ?? "zh-TW",
          metadata: input.metadata ?? null,
          createdBy: ctx.user.id,
        });
        return { id: id.toString() };
      } catch (error) {
        const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
        const reason = cause?.message ?? (error as Error).message;
        const code = cause?.code ? ` [${cause.code}]` : "";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `建立條目失敗${code}：${reason}`,
          cause: error,
        });
      }
    }),

  /** 更新既有條目 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        patch: realEarthEntryInputSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = parseInt(input.id, 10);
      const existing = await db.getRealEarthEntry(id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此條目" });
      }
      // 只有建立者或管理員可以編輯
      if (existing.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權編輯此條目" });
      }

      const p = input.patch;
      await db.updateRealEarthEntry(id, {
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.category !== undefined ? { category: p.category } : {}),
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.content !== undefined ? { content: p.content } : {}),
        ...(p.location !== undefined ? { locationJson: p.location } : {}),
        ...(p.historicalPeriod !== undefined ? { historicalPeriod: p.historicalPeriod } : {}),
        ...(p.yearRange !== undefined ? { yearRangeJson: p.yearRange } : {}),
        ...(p.imageUrls !== undefined ? { imageUrls: p.imageUrls } : {}),
        ...(p.externalLinks !== undefined ? { externalLinksJson: p.externalLinks } : {}),
        ...(p.citations !== undefined ? { citationsJson: p.citations } : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
        ...(p.relatedEntryIds !== undefined ? { relatedEntryIds: p.relatedEntryIds } : {}),
        ...(p.quality !== undefined ? { qualityJson: p.quality } : {}),
        ...(p.isTaiwanFocused !== undefined ? { isTaiwanFocused: p.isTaiwanFocused } : {}),
        ...(p.language !== undefined ? { language: p.language } : {}),
        ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
      });
      return { ok: true };
    }),

  /** 刪除條目 */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const id = parseInt(input.id, 10);
      const existing = await db.getRealEarthEntry(id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此條目" });
      }
      // 只有建立者或管理員可以刪除
      if (existing.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權刪除此條目" });
      }
      await db.deleteRealEarthEntry(id);
      return { ok: true };
    }),

  /** 取得台灣重點資料（快速查詢） */
  taiwanHighlights: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await db.getRealEarthEntries({
        taiwanOnly: true,
        category: input?.category,
        limit: input?.limit,
        offset: 0,
      });
      return rows.map(rowToEntry);
    }),

  /** 取得統計資訊 */
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const stats = await db.getRealEarthStats();
      return stats;
    }),

  /** 取得相關條目建議 */
  getRelated: protectedProcedure
    .input(z.object({ id: z.string(), limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      const id = parseInt(input.id, 10);
      const entry = await db.getRealEarthEntry(id);
      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此條目" });
      }

      // 先查詢已明確關聯的條目
      const relatedIds = (entry.relatedEntryIds as string[]) ?? [];
      const related: RealEarthEntry[] = [];
      for (const relId of relatedIds.slice(0, input.limit)) {
        const relEntry = await db.getRealEarthEntry(parseInt(relId, 10));
        if (relEntry) {
          related.push(rowToEntry(relEntry));
        }
      }

      // 如果不足，根據標籤和類別查找相似條目
      if (related.length < input.limit) {
        const tags = (entry.tags as string[]) ?? [];
        const remaining = input.limit - related.length;
        const similar = await db.findSimilarRealEarthEntries({
          excludeId: id,
          category: entry.category,
          tags,
          limit: remaining,
        });
        related.push(...similar.map(rowToEntry));
      }

      return related;
    }),

  /** 初始化種子資料（僅管理員可用） */
  seedData: protectedProcedure
    .mutation(async ({ ctx }) => {
      // 檢查權限：僅管理員可執行
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "僅管理員可執行此操作" });
      }

      // 檢查是否已有資料
      const hasData = await hasExistingSeedData();
      if (hasData) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "系統已有資料，無法重複初始化。如需重新初始化，請先清空資料庫。"
        });
      }

      // 執行種子資料初始化
      const result = await seedRealEarthData(ctx.user.id);
      return result;
    }),

  /** 檢查是否需要初始化 */
  needsInit: protectedProcedure
    .query(async ({ ctx }) => {
      const hasData = await hasExistingSeedData();
      return { needsInit: !hasData };
    }),

  /** 取得關聯的教材列表 */
  getLinkedMaterials: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const entryId = parseInt(input.id, 10);
      const materials = await db.findTeachingMaterialsByRealEarthRef(entryId);
      return materials;
    }),
});
