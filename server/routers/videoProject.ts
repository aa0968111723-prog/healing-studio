/**
 * videoProject.ts — 影片專案 Router（AIDV-252）
 *
 * 管理影片專案的格式選擇（aspect_ratio）與標題，
 * 供 Fal.ai 派發時從 DB 讀取取代硬編碼 "16:9"。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);

export const videoProjectRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255).default("未命名影片"),
        aspectRatio: aspectRatioSchema.default("16:9"),
        creativeProjectId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createVideoProject({
        userId: ctx.session.userId,
        title: input.title,
        aspectRatio: input.aspectRatio,
        creativeProjectId: input.creativeProjectId ?? null,
      });
      const row = await db.getVideoProject(id);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: row.id, title: row.title, aspectRatio: row.aspectRatio };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.session.userId)
        throw new TRPCError({ code: "FORBIDDEN" });
      return { id: row.id, title: row.title, aspectRatio: row.aspectRatio };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        aspectRatio: aspectRatioSchema.optional(),
        title: z.string().min(1).max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.session.userId)
        throw new TRPCError({ code: "FORBIDDEN" });
      const patch: Record<string, unknown> = {};
      if (input.aspectRatio) patch.aspectRatio = input.aspectRatio;
      if (input.title) patch.title = input.title;
      await db.updateVideoProject(input.id, patch);
      return { ok: true };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getVideoProjectsByUser(ctx.session.userId);
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      aspectRatio: r.aspectRatio,
      createdAt: r.createdAt,
    }));
  }),
});
