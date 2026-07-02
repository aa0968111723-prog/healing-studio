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
 *
 * 內容回填策略：
 *   策展精選庫（featured_showcase）為空時，list / byModality / trending 會
 *   自動補入使用者親手肯定（書籤或 ≥4 星）的 generation_history 作品，
 *   以負值 ID 命名空間（id = -historyId）回傳；getById 會自動分流。
 *   一旦有策展內容（sortWeight > 0），策展作品永遠優先排在前面。
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  featuredShowcase,
  featuredShowcaseComments,
  generationHistory,
  users,
} from "../../drizzle/schema";
import {
  eq,
  desc,
  and,
  or,
  lt,
  gte,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";

// ─── Shared Constants ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;
const TRENDING_LIMIT = 8;

// ─── Modality enum values (must match schema) ────────────────────────────────

const MODALITIES = ["image", "video", "audio", "voice"] as const;
type Modality = (typeof MODALITIES)[number];

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

// ─── Generation History Fallback ─────────────────────────────────────────────
//
// 當策展精選庫（featured_showcase）尚未填滿目標頁數時，從生成歷史中補入
// 使用者親自肯定的作品（書籤 OR 高評分 ≥ 4），讓首頁不會永遠空白。
//
// 設計重點：
//   - 補入的作品 ID 以「負值」namespace（id = -historyId），避免與
//     featured_showcase 主鍵衝突；前端 getById 會自動分流回 generation_history。
//   - 已被 promote 進 featured_showcase 的歷史紀錄會排除（避免重覆）。
//   - resultUrl 必須存在；空字串視為無效。
//   - LOD 欄位形狀與 featured_showcase 完全一致，前端可無縫渲染。

const FALLBACK_PROMOTED_LOOKBACK = 365; // days
const HISTORY_TITLE_MAX_LEN = 60;

function deriveTitleFromPrompt(prompt: string | null): string {
  const text = (prompt ?? "").trim();
  if (!text) return "未命名作品";
  if (text.length <= HISTORY_TITLE_MAX_LEN) return text;
  return text.slice(0, HISTORY_TITLE_MAX_LEN) + "…";
}

interface FallbackRow {
  id: number;
  prompt: string | null;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  modality: Modality;
  userRating: number | null;
  isBookmarked: boolean;
  createdAt: Date;
}

interface ShowcaseListItem {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  modality: string;
  sortWeight: number;
  likeCount: number;
  forkCount: number;
  commentCount: number;
  createdAt: Date;
}

function mapHistoryToShowcase(row: FallbackRow): ShowcaseListItem {
  return {
    // Negative ID namespaces fallback rows; getById decodes this.
    id: -row.id,
    title: deriveTitleFromPrompt(row.prompt),
    description: null,
    imageUrl: row.resultUrl,
    thumbnailUrl: row.thumbnailUrl ?? row.resultUrl,
    modality: row.modality,
    sortWeight: 0,
    likeCount: row.isBookmarked ? 1 : 0,
    forkCount: 0,
    // History-fallback rows live in a separate table — they can't carry comments.
    commentCount: 0,
    createdAt: row.createdAt,
  };
}

/**
 * Fetch quality generation_history rows to fill empty slots in the showcase.
 * Filters: has resultUrl, user-affirmed quality (bookmarked OR rating ≥ 4),
 * not already promoted into featured_showcase.
 */
async function fetchFallbackHistory(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  opts: {
    limit: number;
    modality?: Modality;
    /** Skip generation_history rows whose negated id is ≥ this cursor (used for paging fallbacks). */
    beforeNegativeId?: number;
  }
): Promise<FallbackRow[]> {
  if (opts.limit <= 0) return [];

  // Subquery: history IDs already promoted into featured_showcase.
  const promotedSince = new Date(
    Date.now() - FALLBACK_PROMOTED_LOOKBACK * 24 * 60 * 60 * 1000
  );
  const promotedIdsRows = await db
    .select({ id: featuredShowcase.generatedItemId })
    .from(featuredShowcase)
    .where(
      and(
        eq(featuredShowcase.isActive, true),
        isNotNull(featuredShowcase.generatedItemId),
        gte(featuredShowcase.createdAt, promotedSince)
      )
    );
  const promotedIds = promotedIdsRows
    .map(r => r.id)
    .filter((id): id is number => typeof id === "number");

  const conditions = [
    isNotNull(generationHistory.resultUrl),
    ne(generationHistory.resultUrl, ""),
    or(
      eq(generationHistory.isBookmarked, true),
      gte(generationHistory.userRating, 4)
    )!,
  ];

  if (opts.modality) {
    conditions.push(eq(generationHistory.modality, opts.modality));
  }

  if (promotedIds.length > 0) {
    conditions.push(
      sql`${generationHistory.id} NOT IN (${sql.join(
        promotedIds.map(id => sql`${id}`),
        sql`, `
      )})`
    );
  }

  // Cursor convention mirrors featured_showcase: the cursor stores the popped
  // boundary item's ID (negated for namespacing). To page forward in our
  // DESC-by-id ordering we need rows strictly older than that boundary.
  if (typeof opts.beforeNegativeId === "number" && opts.beforeNegativeId < 0) {
    conditions.push(lt(generationHistory.id, -opts.beforeNegativeId));
  }

  const rows = await db
    .select({
      id: generationHistory.id,
      prompt: generationHistory.prompt,
      resultUrl: generationHistory.resultUrl,
      thumbnailUrl: generationHistory.thumbnailUrl,
      modality: generationHistory.modality,
      userRating: generationHistory.userRating,
      isBookmarked: generationHistory.isBookmarked,
      createdAt: generationHistory.createdAt,
    })
    .from(generationHistory)
    .where(and(...conditions))
    .orderBy(
      // Bookmarked first, then higher rating, then most recent.
      desc(generationHistory.isBookmarked),
      desc(generationHistory.userRating),
      desc(generationHistory.id)
    )
    .limit(opts.limit);

  return rows as FallbackRow[];
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
  commentCount: featuredShowcase.commentCount,
  createdAt: featuredShowcase.createdAt,
  // LOD: 不含 vibeParameters、completelyDeconstructedBlocks、originalPrompt
} as const;

// ─── Comments Constants ───────────────────────────────────────────────────────
const COMMENT_MAX_LENGTH = 500;
const COMMENTS_PAGE_SIZE = 30;

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

      // Cursor convention:
      //   - positive  → page through featured_showcase (id < cursor)
      //   - negative  → page through generation_history fallback (-historyId < cursor)
      //   - null      → fresh load: featured first, top up with fallback
      const isFallbackCursor = typeof cursor === "number" && cursor < 0;

      let featuredItems: ShowcaseListItem[] = [];

      if (!isFallbackCursor) {
        const conditions = [eq(featuredShowcase.isActive, true)];
        if (typeof cursor === "number" && cursor > 0) {
          conditions.push(lt(featuredShowcase.id, cursor));
        }
        if (modality) {
          conditions.push(eq(featuredShowcase.modality, modality));
        }

        const rows = await db
          .select(LIST_FIELDS)
          .from(featuredShowcase)
          .where(and(...conditions))
          .orderBy(
            desc(featuredShowcase.sortWeight),
            desc(featuredShowcase.likeCount),
            desc(featuredShowcase.id)
          )
          .limit(limit + 1);

        featuredItems = rows.map(r => ({ ...r, createdAt: r.createdAt as Date }));
      }

      // If we already have a full page of curated items, return that page —
      // we'll only mix fallback once curated items run out.
      if (featuredItems.length > limit) {
        const nextItem = featuredItems.pop()!;
        return { items: featuredItems, nextCursor: nextItem.id };
      }

      // Top up with generation_history fallback (or paginate through it
      // if the cursor is already in the fallback range).
      const remaining = limit + 1 - featuredItems.length;
      const fallback = await fetchFallbackHistory(db, {
        limit: remaining,
        modality,
        beforeNegativeId: isFallbackCursor ? cursor! : undefined,
      });

      const items: ShowcaseListItem[] = [
        ...featuredItems,
        ...fallback.map(mapHistoryToShowcase),
      ];

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id; // negative if from fallback, positive otherwise
      }

      return { items, nextCursor };
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

      // Negative IDs identify generation_history fallback rows. Decode and
      // synthesise a featured_showcase-shaped record so the detail dialog +
      // studio transfer payload behave identically for both sources.
      if (input.id < 0) {
        const historyId = -input.id;
        // AIDV-609：getById 是 publicProcedure（匿名可呼叫）。負 id 直指
        // generation_history 私有列，過去只用 id 過濾 → 任何人都能枚舉抓出他人
        // 未公開作品的完整提示詞＋成品 URL。這裡套用與 fetchFallbackHistory
        // 相同的「公開廣場可見性」述詞：有成品 URL 且（已加書籤 OR 評分>=4）。
        // 不符可見性即 NOT_FOUND，與 list 端授權一致。
        const rows = await db
          .select()
          .from(generationHistory)
          .where(
            and(
              eq(generationHistory.id, historyId),
              isNotNull(generationHistory.resultUrl),
              ne(generationHistory.resultUrl, ""),
              or(
                eq(generationHistory.isBookmarked, true),
                gte(generationHistory.userRating, 4)
              )!
            )
          )
          .limit(1);

        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到這件展示作品，可能已被移除。",
          });
        }

        const h = rows[0];
        return {
          id: input.id,
          generatedItemId: h.id,
          title: deriveTitleFromPrompt(h.prompt),
          description: null,
          imageUrl: h.resultUrl ?? "",
          thumbnailUrl: h.thumbnailUrl ?? h.resultUrl,
          // No curated vibe matrix or deconstructed blocks for raw history rows.
          // Studio transfer handles nulls — user lands with the prompt only.
          vibeParameters: null,
          completelyDeconstructedBlocks: null,
          originalPrompt: h.prompt ?? "",
          modality: h.modality,
          curatorUserId: null,
          sortWeight: 0,
          isActive: true,
          likeCount: h.isBookmarked ? 1 : 0,
          forkCount: 0,
          // History-fallback rows can't accept comments (no foreign key target).
          commentCount: 0,
          createdAt: h.createdAt,
          updatedAt: h.createdAt,
        };
      }

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

      const featured = await db
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

      if (featured.length >= limit) return featured;

      const fallback = await fetchFallbackHistory(db, {
        limit: limit - featured.length,
      });
      return [
        ...featured.map(r => ({ ...r, createdAt: r.createdAt as Date })),
        ...fallback.map(mapHistoryToShowcase),
      ];
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

      const isFallbackCursor = typeof cursor === "number" && cursor < 0;

      let featuredItems: ShowcaseListItem[] = [];

      if (!isFallbackCursor) {
        const conditions = [
          eq(featuredShowcase.isActive, true),
          eq(featuredShowcase.modality, modality),
        ];
        if (typeof cursor === "number" && cursor > 0) {
          conditions.push(lt(featuredShowcase.id, cursor));
        }

        const rows = await db
          .select(LIST_FIELDS)
          .from(featuredShowcase)
          .where(and(...conditions))
          .orderBy(desc(featuredShowcase.sortWeight), desc(featuredShowcase.id))
          .limit(limit + 1);

        featuredItems = rows.map(r => ({ ...r, createdAt: r.createdAt as Date }));
      }

      if (featuredItems.length > limit) {
        const nextItem = featuredItems.pop()!;
        return { items: featuredItems, nextCursor: nextItem.id };
      }

      const remaining = limit + 1 - featuredItems.length;
      const fallback = await fetchFallbackHistory(db, {
        limit: remaining,
        modality,
        beforeNegativeId: isFallbackCursor ? cursor! : undefined,
      });

      const items: ShowcaseListItem[] = [
        ...featuredItems,
        ...fallback.map(mapHistoryToShowcase),
      ];

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return { items, nextCursor };
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
      const resultUrl = historyItem.resultUrl;
      if (!resultUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "此生成紀錄沒有結果 URL，無法加入精選。",
        });
      }

      // Check per-day limit (max 5 per user per day)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Determine modality
      const modality = (historyItem.modality ?? "image") as
        | "image"
        | "video"
        | "audio"
        | "voice";

      // AIDV-780：count＋insert 包進單一交易，count 走 SELECT ... FOR UPDATE
      // 鎖定行/間隙，修補並發 promote 繞過每日 5 件上限的競態。
      await db.transaction(async tx => {
        const todayCount = await tx
          .select({ count: sql<number>`COUNT(*)` })
          .from(featuredShowcase)
          .where(
            and(
              eq(featuredShowcase.curatorUserId, userId),
              sql`${featuredShowcase.createdAt} >= ${todayStart}`
            )
          )
          .for("update");

        const count = Number((todayCount[0] as any)?.count ?? 0);
        if (count >= 5) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "今日提交數量已達上限（每天最多 5 件），請明天再試。",
          });
        }

        // Insert into featured showcase (same transaction — count still locked)
        await tx.insert(featuredShowcase).values({
          generatedItemId: historyItem.id,
          title: input.title,
          description: input.description ?? null,
          imageUrl: resultUrl,
          thumbnailUrl: historyItem.thumbnailUrl ?? resultUrl,
          originalPrompt: historyItem.prompt ?? "",
          modality,
          curatorUserId: userId,
          sortWeight: 0,
          isActive: true,
          likeCount: 0,
          forkCount: 0,
        });
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
   * showcase.listComments — 列出某件精選作品的評論
   *
   * 公開唯讀。歷史回填作品（負值 id）一律回傳空陣列，因為它們沒有對應
   * 的 featured_showcase 主鍵。
   */
  listComments: publicProcedure
    .input(
      z.object({
        showcaseId: z.number(),
        limit: z
          .number()
          .min(1)
          .max(COMMENTS_PAGE_SIZE * 2)
          .default(COMMENTS_PAGE_SIZE),
        cursor: z.number().nullish(),
      })
    )
    .query(async ({ input }) => {
      const db = await tryDb();
      if (!db) return { items: [], nextCursor: undefined };
      // Negative IDs map to generation_history fallbacks — no comments table.
      if (input.showcaseId < 0)
        return { items: [], nextCursor: undefined };

      const conditions = [
        eq(featuredShowcaseComments.showcaseId, input.showcaseId),
      ];
      if (typeof input.cursor === "number" && input.cursor > 0) {
        conditions.push(lt(featuredShowcaseComments.id, input.cursor));
      }

      const rows = await db
        .select({
          id: featuredShowcaseComments.id,
          showcaseId: featuredShowcaseComments.showcaseId,
          userId: featuredShowcaseComments.userId,
          content: featuredShowcaseComments.content,
          createdAt: featuredShowcaseComments.createdAt,
          authorName: users.name,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(featuredShowcaseComments)
        .leftJoin(users, eq(featuredShowcaseComments.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(featuredShowcaseComments.id))
        .limit(input.limit + 1);

      let nextCursor: number | undefined;
      if (rows.length > input.limit) {
        const popped = rows.pop()!;
        nextCursor = popped.id;
      }

      return { items: rows, nextCursor };
    }),

  /**
   * showcase.addComment — 對某件精選作品新增評論（需登入）
   *
   * 同時把 featured_showcase.commentCount + 1，讓詳情卡片不必每次都 COUNT(*)。
   */
  addComment: protectedProcedure
    .input(
      z.object({
        showcaseId: z.number().int().positive(),
        content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      // Confirm the showcase actually exists and is active before letting a
      // comment land — otherwise we'd accumulate orphan rows.
      const target = await db
        .select({ id: featuredShowcase.id })
        .from(featuredShowcase)
        .where(
          and(
            eq(featuredShowcase.id, input.showcaseId),
            eq(featuredShowcase.isActive, true)
          )
        )
        .limit(1);

      if (target.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到這件展示作品，無法新增評論。",
        });
      }

      const inserted = await db.insert(featuredShowcaseComments).values({
        showcaseId: input.showcaseId,
        userId: ctx.user.id,
        content: input.content,
      });

      await db
        .update(featuredShowcase)
        .set({
          commentCount: sql`${featuredShowcase.commentCount} + 1`,
        })
        .where(eq(featuredShowcase.id, input.showcaseId));

      const newId = Number((inserted as any)?.[0]?.insertId ?? 0);
      return { success: true, id: newId };
    }),

  /**
   * showcase.deleteComment — 刪除自己的評論（需登入）
   *
   * 只有評論作者本人可刪。連動把 commentCount - 1（floor 0）。
   */
  deleteComment: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      const rows = await db
        .select({
          id: featuredShowcaseComments.id,
          showcaseId: featuredShowcaseComments.showcaseId,
          userId: featuredShowcaseComments.userId,
        })
        .from(featuredShowcaseComments)
        .where(eq(featuredShowcaseComments.id, input.id))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到此評論。",
        });
      }

      const comment = rows[0];
      if (comment.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只有評論作者本人可以刪除這則評論。",
        });
      }

      await db
        .delete(featuredShowcaseComments)
        .where(eq(featuredShowcaseComments.id, input.id));

      // GREATEST clamps the counter at 0 in case it drifts (manual deletes etc.)
      await db
        .update(featuredShowcase)
        .set({
          commentCount: sql`GREATEST(${featuredShowcase.commentCount} - 1, 0)`,
        })
        .where(eq(featuredShowcase.id, comment.showcaseId));

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
