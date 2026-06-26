/**
 * videoProject.ts — 影片專案 Router（AIDV-252/AIDV-241）
 *
 * 管理影片專案的格式選擇（aspect_ratio）與標題，
 * 供 Fal.ai 派發時從 DB 讀取取代硬編碼 "16:9"。
 *
 * AIDV-241：update mutation 支援樂觀鎖 CAS（expectedVersion），
 * 版本不符時回傳 CONFLICT(409)，防止協作者靜默覆蓋。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { VIDEO_OUTPUT_SPEC_DEFAULT, type VideoOutputSpec } from "../../drizzle/schema";
import { sanitizePlainText } from "../utils/sanitize";

const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);

// AIDV-260: 影片輸出規格 Zod schema
const outputSpecSchema = z.object({
  resolution: z.enum(["720p", "1080p", "4K"]).default("1080p"),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  codec: z.enum(["h264", "h265", "vp9"]).default("h264"),
});

// AIDV-338: 優先等級 Zod schema
const priorityClassSchema = z.enum(["standard", "express", "critical"]);

/** 從 DB 讀到的 output_spec（可能為 null）回退到預設值。 */
function resolveOutputSpec(raw: VideoOutputSpec | null | undefined): VideoOutputSpec {
  return raw ?? VIDEO_OUTPUT_SPEC_DEFAULT;
}

export const videoProjectRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255).transform(sanitizePlainText).default("未命名影片"),
        aspectRatio: aspectRatioSchema.default("16:9"),
        creativeProjectId: z.number().int().positive().optional(),
        outputSpec: outputSpecSchema.optional(),
        deadlineAt: z.string().datetime().optional(),
        priorityClass: priorityClassSchema.default("standard"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createVideoProject({
        userId: ctx.user.id,
        title: input.title,
        aspectRatio: input.aspectRatio,
        creativeProjectId: input.creativeProjectId ?? null,
        outputSpec: input.outputSpec ?? VIDEO_OUTPUT_SPEC_DEFAULT,
        deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
        priorityClass: input.priorityClass,
      });
      const row = await db.getVideoProject(id);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return {
        id: row.id,
        title: row.title,
        aspectRatio: row.aspectRatio,
        outputSpec: resolveOutputSpec(row.outputSpec),
        version: row.version,
        deadlineAt: row.deadlineAt ?? null,
        priorityClass: row.priorityClass,
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return {
        id: row.id,
        title: row.title,
        aspectRatio: row.aspectRatio,
        outputSpec: resolveOutputSpec(row.outputSpec),
        version: row.version,
        deadlineAt: row.deadlineAt ?? null,
        priorityClass: row.priorityClass,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        aspectRatio: aspectRatioSchema.optional(),
        title: z.string().min(1).max(255).transform(sanitizePlainText).optional(),
        outputSpec: outputSpecSchema.optional(),
        deadlineAt: z.string().datetime().nullable().optional(),
        priorityClass: priorityClassSchema.optional(),
        /** AIDV-241 樂觀鎖：攜帶呼叫方讀到的 version，後端做原子 WHERE id=? AND version=?；
         *  version 不符時回傳 CONFLICT(409)；省略時退化為無版本檢查（向下相容）。 */
        expectedVersion: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      const patch: Record<string, unknown> = {};
      if (input.aspectRatio) patch.aspectRatio = input.aspectRatio;
      if (input.title) patch.title = input.title;
      if (input.outputSpec) patch.outputSpec = input.outputSpec;
      if (input.deadlineAt !== undefined) patch.deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;
      if (input.priorityClass) patch.priorityClass = input.priorityClass;
      const { updated } = await db.updateVideoProject(
        input.id,
        patch as Parameters<typeof db.updateVideoProject>[1],
        { expectedVersion: input.expectedVersion }
      );
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "版本衝突，請重新載入後再試",
        });
      }
      return { ok: true };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getVideoProjectsByUser(ctx.user.id);
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      aspectRatio: r.aspectRatio,
      outputSpec: resolveOutputSpec(r.outputSpec),
      version: r.version,
      deadlineAt: r.deadlineAt ?? null,
      priorityClass: r.priorityClass,
      createdAt: r.createdAt,
    }));
  }),

  /** AIDV-248: 複製影片專案（A/B 迭代必備），回傳新 projectId */
  duplicate: protectedProcedure
    .input(
      z.object({
        sourceId: z.number().int().positive(),
        title: z.string().min(1).max(255).transform(sanitizePlainText).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const source = await db.getVideoProject(input.sourceId);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "來源專案不存在" });
      if (source.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      const newId = await db.duplicateVideoProject(input.sourceId, ctx.user.id, input.title);
      return { id: newId };
    }),

  /** AIDV-227: 列出最近 N 個快照（版本歷程） */
  listSnapshots: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await db.getVideoProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (project.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      const rows = await db.listProjectSnapshots(input.projectId, input.limit);
      return rows.map(r => ({
        id: r.id,
        projectId: r.projectId,
        source: r.source,
        createdAt: r.createdAt,
        snapshot: r.snapshot,
      }));
    }),

  /**
   * AIDV-227: 回溯至指定快照，在覆寫前先存一個 'pre-restore' 快照以防意外。
   * 回傳新 version 供前端更新樂觀鎖。
   */
  restoreSnapshot: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        snapshotId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getVideoProject(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (project.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });

      const snap = await db.getProjectSnapshot(input.snapshotId);
      if (!snap || snap.projectId !== input.projectId)
        throw new TRPCError({ code: "NOT_FOUND", message: "快照不存在" });

      await db.createProjectSnapshot(input.projectId, {}, "pre-restore");

      const patch = snap.snapshot as Parameters<typeof db.updateVideoProject>[1];
      const { updated } = await db.updateVideoProject(input.projectId, patch);
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const refreshed = await db.getVideoProject(input.projectId);
      return { ok: true, version: refreshed?.version ?? 0 };
    }),

  /**
   * AIDV-241/227: 儲存影片專案（帶 CAS 版本鎖），成功後自動寫入快照。
   * expectedVersion 省略時退化為無版本檢查（向下相容）。
   */
  save: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(255).optional(),
        aspectRatio: aspectRatioSchema.optional(),
        outputSpec: outputSpecSchema.optional(),
        deadlineAt: z.string().datetime().nullable().optional(),
        priorityClass: priorityClassSchema.optional(),
        expectedVersion: z.number().int().nonnegative().optional(),
        snapshotData: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });

      const patch: Record<string, unknown> = {};
      if (input.title) patch.title = input.title;
      if (input.aspectRatio) patch.aspectRatio = input.aspectRatio;
      if (input.outputSpec) patch.outputSpec = input.outputSpec;
      if (input.deadlineAt !== undefined) patch.deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;
      if (input.priorityClass) patch.priorityClass = input.priorityClass;

      const { updated } = await db.updateVideoProject(
        input.id,
        patch as Parameters<typeof db.updateVideoProject>[1],
        { expectedVersion: input.expectedVersion }
      );
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "版本衝突，請重新載入後再試",
        });
      }

      if (input.snapshotData) {
        void db.createProjectSnapshot(input.id, input.snapshotData, "auto").catch(() => {});
      }

      return { ok: true };
    }),
});
