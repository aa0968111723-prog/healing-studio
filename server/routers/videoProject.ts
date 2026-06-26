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
        userId: ctx.user.id,
        title: input.title,
        aspectRatio: input.aspectRatio,
        creativeProjectId: input.creativeProjectId ?? null,
      });
      const row = await db.getVideoProject(id);
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: row.id, title: row.title, aspectRatio: row.aspectRatio, version: row.version };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getVideoProject(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      if (row.userId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return { id: row.id, title: row.title, aspectRatio: row.aspectRatio, version: row.version };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        aspectRatio: aspectRatioSchema.optional(),
        title: z.string().min(1).max(255).optional(),
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
      version: r.version,
      createdAt: r.createdAt,
    }));
  }),
});
