/**
 * promptCollection.ts — 個人提示詞收集 tRPC Router
 *
 * 設計核心：
 *   • 「收集」標的是站內各處的 prompt 片段（精靈 system slice、主動觸發
 *     模板、模型 prompt 偏好、ImageStudio 內建模板）+ 使用者自輸入。
 *   • Visibility 比照 digital_asset_library：private / team_shared，後者
 *     需指定 teamId 且使用者必須為該 team 成員才能讀寫。
 *   • 為什麼用獨立 router 而非擴 promptLibrary：兩者語意不同（個人模板
 *     沉澱 vs 站內收集 + 團隊共享），權限模型也不同（isPublic 對陌生人
 *     vs team_shared 對同事），混用容易讓邊界錯亂。
 */

import { z } from "zod";
import { eq, and, desc, like, inArray, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { promptCollection, teamMemberships } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import {
  findSitePromptEntry,
  getSitePromptCatalog,
  SITE_PROMPT_SOURCE_TYPES,
  type SitePromptSourceType,
} from "../../shared/site-prompt-catalog";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const CATEGORY_VALUES = [
  "general",
  "image",
  "video",
  "audio",
  "voice",
  "story",
  "system",
] as const;

const SOURCE_TYPE_VALUES = SITE_PROMPT_SOURCE_TYPES as readonly [
  SitePromptSourceType,
  ...SitePromptSourceType[],
];

const VISIBILITY_VALUES = ["private", "team_shared"] as const;

const ListMineInput = z.object({
  search: z.string().max(120).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  sourceType: z.enum(SOURCE_TYPE_VALUES).optional(),
  favoritesOnly: z.boolean().optional(),
  visibility: z.enum(VISIBILITY_VALUES).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const ListTeamInput = z.object({
  teamId: z.number().int().positive().optional(),
  search: z.string().max(120).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  sourceType: z.enum(SOURCE_TYPE_VALUES).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const CollectInput = z.object({
  // 站內條目：sourceType + sourceRef 必填，title/content 從 catalog 取出，
  // 不信任 client 傳的內容（防 spoofing）。
  // 手動輸入：sourceType="manual"、sourceRef 留空、title+content 來自 client。
  sourceType: z.enum(SOURCE_TYPE_VALUES).default("manual"),
  sourceRef: z.string().max(128).optional(),
  title: z.string().max(256).optional(),
  content: z.string().max(20_000).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  tags: z.array(z.string().max(32)).max(10).optional(),
  notes: z.string().max(2_000).optional(),
});

const UpdateInput = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(256).optional(),
  content: z.string().min(1).max(20_000).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  tags: z.array(z.string().max(32)).max(10).optional(),
  notes: z.string().max(2_000).optional(),
});

const SetVisibilityInput = z.object({
  id: z.number().int().positive(),
  visibility: z.enum(VISIBILITY_VALUES),
  teamId: z.number().int().positive().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function listTeamIdsForUser(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));
  return rows.map(r => r.teamId);
}

async function requireTeamMember(teamId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB 不可用",
    });
  }
  const rows = await db
    .select({ id: teamMemberships.id })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.userId, userId)
      )
    )
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "你不是這個團隊的成員",
    });
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const promptCollectionRouter = router({
  /**
   * 站內可收集 prompt 目錄。回傳 pure registry，不查 DB；前端用 listMine 對
   * 比 (sourceType, sourceRef) 已收 / 未收。
   */
  siteCatalog: protectedProcedure
    .input(
      z
        .object({
          sourceType: z.enum(SOURCE_TYPE_VALUES).optional(),
          search: z.string().max(120).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const catalog = getSitePromptCatalog();
      const filters = input ?? {};
      const keyword = filters.search?.trim().toLowerCase() ?? "";

      const entries = catalog.filter(entry => {
        if (filters.sourceType && entry.sourceType !== filters.sourceType) {
          return false;
        }
        if (keyword.length > 0) {
          const hay = [
            entry.title,
            entry.content,
            entry.sourceLabel,
            entry.description ?? "",
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(keyword)) return false;
        }
        return true;
      });

      // 順道把該 user 已收的 (sourceType, sourceRef) 拉回來，讓前端能 disable
      // 對應的 collect 按鈕。比較高效的方法是 IN-list，但 catalog 一般 < 200
      // 條，整體掃 user 全表也夠快。
      const db = await getDb();
      let collected: Array<{ sourceType: string; sourceRef: string | null }> =
        [];
      if (db) {
        collected = await db
          .select({
            sourceType: promptCollection.sourceType,
            sourceRef: promptCollection.sourceRef,
          })
          .from(promptCollection)
          .where(eq(promptCollection.userId, ctx.user.id));
      }
      const collectedKeys = new Set(
        collected
          .filter(c => c.sourceRef !== null)
          .map(c => `${c.sourceType}::${c.sourceRef}`)
      );

      return {
        entries: entries.map(entry => ({
          ...entry,
          alreadyCollected: collectedKeys.has(
            `${entry.sourceType}::${entry.sourceRef}`
          ),
        })),
        total: entries.length,
      };
    }),

  /** 列出我的收集（含 private 與我自己 share 給 team 的）。 */
  listMine: protectedProcedure
    .input(ListMineInput)
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const {
        search,
        category,
        sourceType,
        favoritesOnly,
        visibility,
        page,
        pageSize,
      } = input;
      const conditions = [eq(promptCollection.userId, ctx.user.id)];
      if (category) conditions.push(eq(promptCollection.category, category));
      if (sourceType)
        conditions.push(eq(promptCollection.sourceType, sourceType));
      if (favoritesOnly)
        conditions.push(eq(promptCollection.isFavorite, true));
      if (visibility)
        conditions.push(eq(promptCollection.visibility, visibility));
      if (search) {
        conditions.push(like(promptCollection.title, `%${search}%`));
      }
      const offset = (page - 1) * pageSize;
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(promptCollection)
          .where(and(...conditions))
          .orderBy(desc(promptCollection.updatedAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(promptCollection)
          .where(and(...conditions)),
      ]);
      const total = Number(totalRow[0]?.count ?? 0);
      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }),

  /**
   * 列出我有權看的「團隊共享」收集。預設列出我所有 team 的 team_shared
   * 條目；指定 teamId 時收斂到該 team。
   */
  listTeam: protectedProcedure
    .input(ListTeamInput)
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const { teamId, search, category, sourceType, page, pageSize } = input;
      let teamIds: number[];
      if (teamId !== undefined) {
        await requireTeamMember(teamId, ctx.user.id);
        teamIds = [teamId];
      } else {
        teamIds = await listTeamIdsForUser(ctx.user.id);
      }
      if (teamIds.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
        };
      }
      const conditions = [
        eq(promptCollection.visibility, "team_shared"),
        inArray(promptCollection.teamId, teamIds),
      ];
      if (category) conditions.push(eq(promptCollection.category, category));
      if (sourceType)
        conditions.push(eq(promptCollection.sourceType, sourceType));
      if (search) {
        conditions.push(like(promptCollection.title, `%${search}%`));
      }
      const offset = (page - 1) * pageSize;
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(promptCollection)
          .where(and(...conditions))
          .orderBy(desc(promptCollection.updatedAt))
          .limit(pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(promptCollection)
          .where(and(...conditions)),
      ]);
      const total = Number(totalRow[0]?.count ?? 0);
      return {
        items: rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }),

  /**
   * 新增一筆收集。站內條目以 (sourceType, sourceRef) 從 catalog 取值；
   * 手動輸入則接受 client 傳的 title + content。
   */
  collect: protectedProcedure
    .input(CollectInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      let title: string;
      let content: string;
      let category: (typeof CATEGORY_VALUES)[number] = "general";
      let tags: string[] = [];
      let sourceLabel: string | null = null;
      let sourceRef: string | null = null;
      if (input.sourceType === "manual") {
        if (!input.title || !input.content) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "手動輸入需提供 title 與 content",
          });
        }
        title = input.title;
        content = input.content;
        category = input.category ?? "general";
        tags = input.tags ?? [];
      } else {
        if (!input.sourceRef) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "站內條目需提供 sourceRef",
          });
        }
        const entry = findSitePromptEntry(input.sourceType, input.sourceRef);
        if (!entry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `站內找不到 sourceType=${input.sourceType} sourceRef=${input.sourceRef} 的提示詞`,
          });
        }
        title = input.title ?? entry.title;
        content = entry.content;
        category = input.category ?? entry.category;
        tags = input.tags ?? entry.tags;
        sourceLabel = entry.sourceLabel;
        sourceRef = entry.sourceRef;
      }
      try {
        const result = await db.insert(promptCollection).values({
          userId: ctx.user.id,
          title,
          content,
          category,
          tags,
          notes: input.notes,
          sourceType: input.sourceType,
          sourceRef,
          sourceLabel,
          visibility: "private",
        });
        return { id: Number(result[0].insertId), success: true };
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? "";
        // UNIQUE (userId, sourceType, sourceRef) — 已收過同一個站內條目。
        if (msg.includes("Duplicate") || msg.includes("UNIQUE")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "你已經收藏過這個提示詞",
          });
        }
        throw err;
      }
    }),

  /** 編輯收集（限本人）。 */
  update: protectedProcedure
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const { id, ...fields } = input;
      const existing = await db
        .select({ userId: promptCollection.userId })
        .from(promptCollection)
        .where(
          and(
            eq(promptCollection.id, id),
            eq(promptCollection.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!existing[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到該條目或無權限編輯",
        });
      }
      await db
        .update(promptCollection)
        .set(fields)
        .where(eq(promptCollection.id, id));
      return { success: true };
    }),

  /** 刪除收集（限本人）。 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const existing = await db
        .select({ userId: promptCollection.userId })
        .from(promptCollection)
        .where(
          and(
            eq(promptCollection.id, input.id),
            eq(promptCollection.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!existing[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到該條目或無權限刪除",
        });
      }
      await db
        .delete(promptCollection)
        .where(eq(promptCollection.id, input.id));
      return { success: true };
    }),

  /** 切換收藏狀態（限本人）。 */
  toggleFavorite: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const rows = await db
        .select({ isFavorite: promptCollection.isFavorite })
        .from(promptCollection)
        .where(
          and(
            eq(promptCollection.id, input.id),
            eq(promptCollection.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!rows[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到該條目",
        });
      }
      const newFav = !rows[0].isFavorite;
      await db
        .update(promptCollection)
        .set({ isFavorite: newFav })
        .where(eq(promptCollection.id, input.id));
      return { isFavorite: newFav };
    }),

  /** 使用次數 +1（複製到剪貼簿時呼叫）。 */
  incrementUseCount: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };
      // 只允許對「自己擁有」或「自己所屬 team 的 team_shared」條目 +1，避免
      // 被外部惡意 spam。
      const rows = await db
        .select({
          userId: promptCollection.userId,
          visibility: promptCollection.visibility,
          teamId: promptCollection.teamId,
        })
        .from(promptCollection)
        .where(eq(promptCollection.id, input.id))
        .limit(1);
      if (!rows[0]) return { success: false };
      const row = rows[0];
      if (row.userId !== ctx.user.id) {
        if (row.visibility !== "team_shared" || row.teamId === null) {
          return { success: false };
        }
        await requireTeamMember(row.teamId, ctx.user.id);
      }
      await db
        .update(promptCollection)
        .set({ useCount: sql`${promptCollection.useCount} + 1` })
        .where(eq(promptCollection.id, input.id));
      return { success: true };
    }),

  /**
   * 切換 visibility — 與 digital_asset_library 同一語意：
   *   • private — teamId 清為 NULL
   *   • team_shared — 必須帶 teamId，且使用者必須為該 team 成員
   */
  setVisibility: protectedProcedure
    .input(SetVisibilityInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB 不可用",
        });
      }
      const existing = await db
        .select({ userId: promptCollection.userId })
        .from(promptCollection)
        .where(
          and(
            eq(promptCollection.id, input.id),
            eq(promptCollection.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!existing[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到該條目或無權限變更",
        });
      }
      if (input.visibility === "team_shared") {
        if (!input.teamId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "團隊共享需指定 teamId",
          });
        }
        await requireTeamMember(input.teamId, ctx.user.id);
        await db
          .update(promptCollection)
          .set({ visibility: "team_shared", teamId: input.teamId })
          .where(eq(promptCollection.id, input.id));
      } else {
        await db
          .update(promptCollection)
          .set({ visibility: "private", teamId: null })
          .where(eq(promptCollection.id, input.id));
      }
      return { success: true };
    }),
});
