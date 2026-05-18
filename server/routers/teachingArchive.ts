/**
 * teachingArchive.ts — 法脈傳承教材庫 Router
 *
 * Phase 1 of the training-data feature. Provides CRUD for teacher discourses,
 * lineage materials, group-practice recordings, class slides, photos, etc.
 * Phase 2 will add an ingestion pipeline that fills `textContent` from
 * transcripts / OCR and then chunks + embeds it for RAG.
 *
 * 上傳流程：前端先呼叫 `/api/upload` 把檔案丟到 S3/R2，拿到 `fileUrl` + `fileKey`
 * 後再呼叫 `teachingArchive.create` 存 metadata。純文字開示則 mediaType='text'
 * 並把內容塞進 `textContent`，不需要上傳檔案。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { scheduleTeachingIngestion } from "../services/teachingArchiveIngest";
import {
  loadMaterialForRead,
  loadMaterialForWrite,
  logAccess,
} from "../services/teachingArchiveAccess";

export const TEACHING_MEDIA_TYPES = [
  "text",
  "pdf",
  "document",
  "image",
  "video",
  "audio",
  "presentation",
] as const;

export const TEACHING_SOURCE_TYPES = [
  "discourse",
  "group_practice",
  "class",
  "ceremony",
  "publication",
  "interview",
  "other",
] as const;

export const TEACHING_VISIBILITY = [
  "private",
  "team_shared",
  "public_disciples",
] as const;

const mediaTypeSchema = z.enum(TEACHING_MEDIA_TYPES);
const sourceTypeSchema = z.enum(TEACHING_SOURCE_TYPES);
const visibilitySchema = z.enum(TEACHING_VISIBILITY);

const createInputSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(10_000).optional(),

  mediaType: mediaTypeSchema,
  fileUrl: z.string().url().optional(),
  fileKey: z.string().max(1024).optional(),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(128).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  thumbnailUrl: z.string().url().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  pageCount: z.number().int().nonnegative().optional(),

  textContent: z.string().max(500_000).optional(),

  lineage: z.string().max(128).optional(),
  sourceType: sourceTypeSchema.default("discourse"),
  sourceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "sourceDate must be YYYY-MM-DD")
    .optional(),
  sourceLocation: z.string().max(255).optional(),
  topic: z.string().max(128).optional(),
  speaker: z.string().max(128).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),

  /**
   * 把素材丟進哪個團隊的池子。null/undefined = 個人池。若 visibility=team_shared
   * 但 teamId 為 null，server 會在 assertMediaPayload 那層擋下來。
   */
  teamId: z.number().int().positive().nullable().optional(),
  visibility: visibilitySchema.default("private"),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const updateInputSchema = createInputSchema.partial();

const listFiltersSchema = z.object({
  mediaType: mediaTypeSchema.optional(),
  sourceType: sourceTypeSchema.optional(),
  lineage: z.string().max(128).optional(),
  topic: z.string().max(128).optional(),
  search: z.string().max(255).optional(),
  /**
   * 視圖切換：
   *   mine    — 只看自己上傳的（私人池）
   *   team    — 只看自己有 membership 的團隊共享池
   *   public  — 只看 public_disciples 全 workspace 公開
   *   undefined — 全部都看（預設）
   */
  scope: z.enum(["mine", "team", "public"]).optional(),
});

/**
 * 純文字開示 (`mediaType: 'text'`) 至少要有 textContent；其他類型至少要有 fileUrl。
 * 在 router 層額外把關，避免不完整的紀錄。
 */
function assertMediaPayload(
  input: z.infer<typeof createInputSchema>
): void {
  if (input.mediaType === "text") {
    if (!input.textContent || input.textContent.trim().length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "純文字教材必須提供 textContent",
      });
    }
  } else if (!input.fileUrl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${input.mediaType} 類型需要先上傳檔案並提供 fileUrl`,
    });
  }

  // team_shared 必須掛在某個 team 上 — 否則建立後沒人看得到（包括上傳者自己以外）。
  // server 層強制，避免使用者誤以為「設成 team_shared = 自動共享」。
  if (input.visibility === "team_shared" && !input.teamId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "設定為「團隊共享」時必須指定 teamId",
    });
  }
}

export const teachingArchiveRouter = router({
  /**
   * 列出當前使用者看得到的教材：自己上傳的 + 同團隊的 team_shared +
   * 全 workspace 的 public_disciples。可用 scope 過濾「我的 / 團隊 / 公開」。
   */
  list: protectedProcedure
    .input(listFiltersSchema.optional())
    .query(async ({ ctx, input }) => {
      const teamIds = await db.listTeamIdsForUser(ctx.user.id);
      return db.listTeachingMaterialsForUser(ctx.user.id, input ?? {}, {
        teamIds,
        only: input?.scope,
      });
    }),

  /** 取得單一教材 — 自動套用 visibility + team membership 規則 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { material, viaTeamId } = await loadMaterialForRead(input.id, {
        userId: ctx.user.id,
      });
      logAccess(input.id, ctx.user.id, "view", {
        viaTeamId,
        visibility: material.visibility,
      });
      return material;
    }),

  /** 建立新教材；上傳完成後由前端呼叫 */
  create: protectedProcedure
    .input(createInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertMediaPayload(input);

      // 把素材掛在某個 team 上，必須先驗證使用者真的在那個 team。否則
      // 任何人都可以「假裝把素材塞進別人的團隊」。
      if (input.teamId) {
        const membership = await db.getTeamMembership(
          input.teamId,
          ctx.user.id
        );
        if (!membership) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "你不是這個團隊的成員，不能在此團隊建立教材",
          });
        }
      }

      const needsIngestion =
        !input.textContent &&
        (input.mediaType === "pdf" ||
          input.mediaType === "audio" ||
          input.mediaType === "video");
      const id = await db.createTeachingMaterial({
        userId: ctx.user.id,
        teamId: input.teamId ?? null,
        title: input.title,
        description: input.description,
        mediaType: input.mediaType,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        thumbnailUrl: input.thumbnailUrl,
        durationSeconds: input.durationSeconds,
        pageCount: input.pageCount,
        textContent: input.textContent,
        transcriptionStatus: input.textContent
          ? "completed"
          : needsIngestion
            ? "pending"
            : "not_applicable",
        lineage: input.lineage,
        sourceType: input.sourceType,
        // Drizzle MySQL `date()` 欄位要 Date 物件；YYYY-MM-DD 直接 new Date()
        // 會被當成 UTC 午夜，date 欄位只看日期部分所以時區漂移不影響。
        sourceDate: input.sourceDate ? new Date(input.sourceDate) : undefined,
        sourceLocation: input.sourceLocation,
        topic: input.topic,
        speaker: input.speaker,
        tags: input.tags,
        visibility: input.visibility,
        isFeatured: input.isFeatured,
        sortOrder: input.sortOrder,
      });

      // 自動抽文 / 轉文字 — fire-and-forget，請求立刻 return 給前端。
      // 前端透過 `get` 輪詢 transcriptionStatus 看完成沒有。
      if (needsIngestion) {
        setImmediate(() => {
          scheduleTeachingIngestion(id).catch(err => {
            console.error(
              `[teachingArchive] auto-ingest failed for ${id}:`,
              err
            );
          });
        });
      }

      return { id };
    }),

  /**
   * 手動重跑內容抽取（PDF 抽文 / 語音轉文字）。
   * 自動流程失敗時、或之後想重抓更高品質的轉錄時可以呼叫。
   */
  triggerIngestion: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await loadMaterialForWrite(input.id, { userId: ctx.user.id });
      logAccess(input.id, ctx.user.id, "reingest");
      setImmediate(() => {
        scheduleTeachingIngestion(input.id).catch(err => {
          console.error(
            `[teachingArchive] manual ingest failed for ${input.id}:`,
            err
          );
        });
      });
      return { ok: true };
    }),

  /** 更新既有教材（owner 或團隊管理員可改） */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: updateInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { material } = await loadMaterialForWrite(input.id, {
        userId: ctx.user.id,
      });

      // 想把素材搬到別的 team 上 — 同樣要驗證新 team 的 membership
      if (input.patch.teamId && input.patch.teamId !== material.teamId) {
        const membership = await db.getTeamMembership(
          input.patch.teamId,
          ctx.user.id
        );
        if (!membership) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "你不是目標團隊的成員，不能將教材轉移到此團隊",
          });
        }
      }

      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.patch)) {
        if (v !== undefined) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        return { ok: true, noop: true as const };
      }
      await db.updateTeachingMaterial(input.id, patch);
      logAccess(input.id, ctx.user.id, "update", {
        fields: Object.keys(patch),
      });
      return { ok: true, noop: false as const };
    }),

  /** 刪除教材（owner 或團隊管理員可刪；僅刪 metadata，S3 物件保留） */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await loadMaterialForWrite(input.id, { userId: ctx.user.id });
      logAccess(input.id, ctx.user.id, "delete");
      await db.deleteTeachingMaterial(input.id);
      return { ok: true };
    }),

  /**
   * 取得單一教材的存取稽核日誌（最近 N 筆）— 只有 owner 或團隊管理員看得到。
   * 給敏感素材的擁有者用來追蹤「最近誰看過 / 下載過」。
   */
  accessLog: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      await loadMaterialForWrite(input.id, { userId: ctx.user.id });
      return db.listTeachingMaterialAccessLogs(input.id, input.limit);
    }),

  /** distinct lineage / topic 給前端做下拉選單 */
  lineages: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeachingMaterialLineages(ctx.user.id);
  }),

  topics: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeachingMaterialTopics(ctx.user.id);
  }),

  /**
   * search — 給光球 / AI 助理檢索教材庫用。
   *
   * Phase 1 是「LIKE 全文搜尋 + 摘要片段」；Phase 2 會升級成向量檢索，介面
   * 保持不變。回傳挑選過的欄位 + 命中片段（snippet），讓助理可以直接引用：
   *   ─「依師父在《XX 開示》中的說法：『……』」
   *
   * 要讓光球能呼叫，需在 `ORB_TOOL_REGISTRY_JSON` 環境變數加一條：
   *   { "name": "teachingArchive.search", "description": "搜尋師父開示教材庫",
   *     "method": "POST", "endpoint": "...", "riskLevel": "low" }
   * 並把 endpoint 包成 HTTP wrapper（見 server/routers.ts orb proxy）。
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(255),
        limit: z.number().int().min(1).max(20).default(5),
        mediaType: z
          .enum(TEACHING_MEDIA_TYPES)
          .optional(),
        lineage: z.string().max(128).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const teamIds = await db.listTeamIdsForUser(ctx.user.id);
      const rows = await db.listTeachingMaterialsForUser(
        ctx.user.id,
        {
          search: input.query,
          mediaType: input.mediaType,
          lineage: input.lineage,
        },
        { teamIds }
      );
      const top = rows.slice(0, input.limit);
      // 寫 search_hit 稽核 — fire-and-forget，不卡回應。每筆命中各一行，
      // 之後分析 access 統計時可以看「最常被光球引用的開示」等指標。
      for (const row of top) {
        logAccess(row.id, ctx.user.id, "search_hit", {
          query: input.query,
        });
      }
      return top.map(row => ({
        id: row.id,
        title: row.title,
        mediaType: row.mediaType,
        sourceType: row.sourceType,
        lineage: row.lineage,
        topic: row.topic,
        speaker: row.speaker,
        sourceDate: row.sourceDate,
        fileUrl: row.fileUrl,
        snippet: buildSnippet(
          input.query,
          row.title,
          row.description,
          row.textContent
        ),
      }));
    }),
});

/**
 * 抓出 query 在 title / description / textContent 命中位置前後的小段，給
 * AI 助理一個可以直接引用的句子。沒命中就回 textContent 開頭。
 */
function buildSnippet(
  query: string,
  title: string,
  description: string | null,
  textContent: string | null
): string {
  const SNIPPET_RADIUS = 80;
  const haystacks: string[] = [];
  if (description) haystacks.push(description);
  if (textContent) haystacks.push(textContent);
  const lowerQuery = query.toLowerCase();
  for (const h of haystacks) {
    const idx = h.toLowerCase().indexOf(lowerQuery);
    if (idx >= 0) {
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(h.length, idx + query.length + SNIPPET_RADIUS);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < h.length ? "…" : "";
      return prefix + h.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
    }
  }
  // 沒命中就回標題；前端可以決定要不要顯示。
  if (textContent) return textContent.slice(0, 160).replace(/\s+/g, " ") + "…";
  return title;
}

export type TeachingArchiveRouter = typeof teachingArchiveRouter;

/** Exported for unit tests — let us assert payload validation without needing a DB. */
export const __teachingArchiveInternals = {
  createInputSchema,
  updateInputSchema,
  listFiltersSchema,
  assertMediaPayload,
};
