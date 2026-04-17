/**
 * promptLibrary.ts — 提示詞庫 tRPC Router
 * ──────────────────────────────────────────────────────────────────────────
 * 功能：
 *   - list    : 分頁列出用戶的提示詞（支援 category / tags 篩選、搜尋）
 *   - getById : 取得單一提示詞
 *   - create  : 新增提示詞
 *   - update  : 更新提示詞（限本人）
 *   - delete  : 刪除提示詞（限本人）
 *   - toggleFavorite : 切換收藏狀態
 *   - incrementUseCount : 使用次數 +1（每次應用提示詞時呼叫）
 *   - listPublic : 公開提示詞廣場（isPublic=true，含所有用戶）
 *   - adminSeed  : 管理員批次種子提示詞（admin only）
 */

import { z } from "zod";
import { eq, and, desc, like, inArray, sql } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { promptLibrary } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CATEGORY_VALUES = ["general", "image", "video", "audio", "voice", "story", "system"] as const;

const PromptCreateInput = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  category: z.enum(CATEGORY_VALUES).default("general"),
  tags: z.array(z.string().max(32)).max(10).optional(),
  isPublic: z.boolean().default(false),
  modelHint: z.string().max(128).optional(),
  language: z.string().max(8).default("zh"),
});

const PromptUpdateInput = PromptCreateInput.partial().extend({
  id: z.number().int().positive(),
});

const ListInput = z.object({
  category: z.enum(CATEGORY_VALUES).optional(),
  search: z.string().max(100).optional(),
  tags: z.array(z.string()).max(5).optional(),
  favoritesOnly: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const promptLibraryRouter = router({

  // ── 列出我的提示詞 ─────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(ListInput)
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const userId = ctx.user.id;
      const { category, search, favoritesOnly, page, pageSize } = input;

      const conditions = [eq(promptLibrary.userId, userId)];

      if (category) conditions.push(eq(promptLibrary.category, category));
      if (favoritesOnly) conditions.push(eq(promptLibrary.isFavorite, true));
      if (search) {
        conditions.push(like(promptLibrary.title, `%${search}%`));
      }

      const offset = (page - 1) * pageSize;

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(promptLibrary)
          .where(and(...conditions))
          .orderBy(desc(promptLibrary.updatedAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(promptLibrary)
          .where(and(...conditions)),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  // ── 公開提示詞廣場 ──────────────────────────────────────────────────────────
  listPublic: protectedProcedure
    .input(
      z.object({
        category: z.enum(CATEGORY_VALUES).optional(),
        search: z.string().max(100).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const { category, search, page, pageSize } = input;
      const conditions = [eq(promptLibrary.isPublic, true)];

      if (category) conditions.push(eq(promptLibrary.category, category));
      if (search) conditions.push(like(promptLibrary.title, `%${search}%`));

      const offset = (page - 1) * pageSize;

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(promptLibrary)
          .where(and(...conditions))
          .orderBy(desc(promptLibrary.useCount), desc(promptLibrary.updatedAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(promptLibrary)
          .where(and(...conditions)),
      ]);

      return {
        items: rows,
        total: Number(countResult[0]?.count ?? 0),
        page,
        pageSize,
        totalPages: Math.ceil(Number(countResult[0]?.count ?? 0) / pageSize),
      };
    }),

  // ── 取得單一提示詞 ──────────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const rows = await db
        .select()
        .from(promptLibrary)
        .where(
          and(
            eq(promptLibrary.id, input.id),
            eq(promptLibrary.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此提示詞" });

      return rows[0];
    }),

  // ── 新增提示詞 ──────────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(PromptCreateInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const result = await db.insert(promptLibrary).values({
        userId: ctx.user.id,
        title: input.title,
        content: input.content,
        category: input.category,
        tags: input.tags ?? [],
        isPublic: input.isPublic,
        modelHint: input.modelHint,
        language: input.language,
      });

      return { id: Number(result[0].insertId), success: true };
    }),

  // ── 更新提示詞 ──────────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(PromptUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const { id, ...fields } = input;

      // 確認本人才能改
      const existing = await db
        .select({ userId: promptLibrary.userId })
        .from(promptLibrary)
        .where(and(eq(promptLibrary.id, id), eq(promptLibrary.userId, ctx.user.id)))
        .limit(1);

      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此提示詞或無權限修改" });

      await db
        .update(promptLibrary)
        .set({ ...fields })
        .where(eq(promptLibrary.id, id));

      return { success: true };
    }),

  // ── 刪除提示詞 ──────────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const existing = await db
        .select({ userId: promptLibrary.userId })
        .from(promptLibrary)
        .where(and(eq(promptLibrary.id, input.id), eq(promptLibrary.userId, ctx.user.id)))
        .limit(1);

      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此提示詞或無權限刪除" });

      await db.delete(promptLibrary).where(eq(promptLibrary.id, input.id));

      return { success: true };
    }),

  // ── 切換收藏 ────────────────────────────────────────────────────────────────
  toggleFavorite: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const rows = await db
        .select({ isFavorite: promptLibrary.isFavorite })
        .from(promptLibrary)
        .where(and(eq(promptLibrary.id, input.id), eq(promptLibrary.userId, ctx.user.id)))
        .limit(1);

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此提示詞" });

      const newFav = !rows[0].isFavorite;
      await db.update(promptLibrary).set({ isFavorite: newFav }).where(eq(promptLibrary.id, input.id));

      return { isFavorite: newFav };
    }),

  // ── 使用次數 +1 ─────────────────────────────────────────────────────────────
  incrementUseCount: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await db
        .update(promptLibrary)
        .set({ useCount: sql`${promptLibrary.useCount} + 1` })
        .where(eq(promptLibrary.id, input.id));

      return { success: true };
    }),

  // ── 管理員批次種子 ──────────────────────────────────────────────────────────
  adminSeed: adminProcedure
    .input(
      z.array(
        z.object({
          title: z.string(),
          content: z.string(),
          category: z.enum(CATEGORY_VALUES).default("general"),
          tags: z.array(z.string()).optional(),
          isPublic: z.boolean().default(true),
          modelHint: z.string().optional(),
          language: z.string().default("zh"),
        })
      )
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      const adminId = ctx.user.id;
      const values = input.map(item => ({
        userId: adminId,
        ...item,
        tags: item.tags ?? [],
      }));

      await db.insert(promptLibrary).values(values);

      return { inserted: values.length };
    }),
});
