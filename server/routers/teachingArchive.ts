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
    return;
  }
  if (!input.fileUrl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${input.mediaType} 類型需要先上傳檔案並提供 fileUrl`,
    });
  }
}

export const teachingArchiveRouter = router({
  /** 列出當前使用者的教材（支援多軸過濾） */
  list: protectedProcedure
    .input(listFiltersSchema.optional())
    .query(async ({ ctx, input }) => {
      return db.listTeachingMaterialsByUser(ctx.user.id, input ?? {});
    }),

  /** 取得單一教材 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getTeachingMaterial(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return row;
    }),

  /** 建立新教材；上傳完成後由前端呼叫 */
  create: protectedProcedure
    .input(createInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertMediaPayload(input);
      const id = await db.createTeachingMaterial({
        userId: ctx.user.id,
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
        // textContent 已存進 DB，等 Phase 2 RAG 才會切片 + embedding；
        // 上傳當下沒有需要轉文字的工作，標 not_applicable。
        transcriptionStatus: input.textContent ? "completed" : "not_applicable",
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
      return { id };
    }),

  /** 更新既有教材 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: updateInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getTeachingMaterial(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // 全 undefined 的 patch 沒意義；空 set 在 MySQL 會炸。
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.patch)) {
        if (v !== undefined) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) {
        return { ok: true, noop: true as const };
      }
      await db.updateTeachingMaterial(input.id, patch);
      return { ok: true, noop: false as const };
    }),

  /** 刪除教材（僅刪 metadata；S3 物件保留，避免誤刪共用檔案） */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getTeachingMaterial(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.deleteTeachingMaterial(input.id);
      return { ok: true };
    }),

  /** distinct lineage / topic 給前端做下拉選單 */
  lineages: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeachingMaterialLineages(ctx.user.id);
  }),

  topics: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeachingMaterialTopics(ctx.user.id);
  }),
});

export type TeachingArchiveRouter = typeof teachingArchiveRouter;

/** Exported for unit tests — let us assert payload validation without needing a DB. */
export const __teachingArchiveInternals = {
  createInputSchema,
  updateInputSchema,
  listFiltersSchema,
  assertMediaPayload,
};
