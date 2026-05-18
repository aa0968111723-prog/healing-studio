/**
 * server/routers/modelWishesRouter.ts — 模型許願池 tRPC router
 *
 * 提供使用者許願平台支援新 AI 模型的功能：
 *   modelWishes.list         — 列出許願（公開讀取，已登入時帶 hasVoted）
 *   modelWishes.create       — 建立許願（需登入）
 *   modelWishes.delete       — 刪除自己的許願（管理員可刪任何人的）
 *   modelWishes.vote         — 投票表態（需登入；idempotent）
 *   modelWishes.unvote       — 取消投票（需登入）
 *   modelWishes.updateStatus — 管理員更新狀態與備註
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../_core/trpc";
import * as db from "../db";

const MODALITY = [
  "text",
  "image",
  "video",
  "audio",
  "voice",
  "3d",
  "multimodal",
  "embedding",
  "other",
] as const;

const STATUS = [
  "pending",
  "under_review",
  "planned",
  "added",
  "rejected",
] as const;

export const modelWishesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          modality: z.enum(["all", ...MODALITY]).optional(),
          status: z.enum(["all", ...STATUS]).optional(),
          sort: z.enum(["votes", "latest"]).optional(),
          limit: z.number().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const viewerId = ctx.user?.id ?? null;
      const items = await db.listModelWishes({
        viewerId,
        modality: input?.modality,
        status: input?.status,
        sort: input?.sort ?? "votes",
        limit: input?.limit ?? 100,
      });
      return {
        items,
        meta: {
          total: items.length,
          viewerId,
        },
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        modelName: z
          .string()
          .max(191, "模型名稱過長")
          .transform(s => s.trim())
          .refine(s => s.length > 0, "請輸入模型名稱"),
        provider: z.string().max(128).optional(),
        modality: z.enum(MODALITY).default("other"),
        reason: z.string().max(2000).optional(),
        referenceUrl: z
          .string()
          .url("請輸入有效的網址")
          .max(2048)
          .optional()
          .or(z.literal("")),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createModelWish({
        userId: ctx.user.id,
        modelName: input.modelName,
        provider: input.provider?.trim() || null,
        modality: input.modality,
        reason: input.reason?.trim() || null,
        referenceUrl: input.referenceUrl?.trim() || null,
      });
      // 許願者自動為自己投一票
      await db.voteModelWish(id, ctx.user.id);

      // best-effort：通知站長有新許願
      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          title: `新模型許願：${input.modelName}`,
          content:
            `來自 ${ctx.user.name || "匿名使用者"}\n` +
            `模態：${input.modality}\n` +
            `廠商：${input.provider || "未填"}\n` +
            `原因：${input.reason || "(無)"}\n` +
            `參考：${input.referenceUrl || "(無)"}`,
        });
      } catch {
        /* notification is best-effort */
      }

      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const wish = await db.getModelWishById(input.id);
      if (!wish) {
        throw new TRPCError({ code: "NOT_FOUND", message: "許願不存在" });
      }
      const isOwner = wish.userId === ctx.user.id;
      const isAdmin = ctx.user.role === "admin";
      if (!isOwner && !isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能刪除自己的許願",
        });
      }
      await db.deleteModelWish(input.id);
      return { success: true };
    }),

  vote: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await db.voteModelWish(input.id, ctx.user.id);
      } catch (e) {
        if (e instanceof Error && e.message === "WISH_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "許願不存在" });
        }
        throw e;
      }
    }),

  unvote: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await db.unvoteModelWish(input.id, ctx.user.id);
      } catch (e) {
        if (e instanceof Error && e.message === "WISH_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "許願不存在" });
        }
        throw e;
      }
    }),

  updateStatus: adminProcedure
    .input(
      z
        .object({
          id: z.number().int().positive(),
          // 兩個欄位都改成 optional：呼叫端只傳實際要動的欄位，
          // 才不會在「只改備註」時拿陳舊的 status 把別人剛剛改的狀態蓋掉。
          status: z.enum(STATUS).optional(),
          adminNote: z.string().max(2000).nullable().optional(),
        })
        .refine(v => v.status !== undefined || v.adminNote !== undefined, {
          message: "至少要更新 status 或 adminNote 其中一項",
        })
    )
    .mutation(async ({ input }) => {
      const wish = await db.getModelWishById(input.id);
      if (!wish) {
        throw new TRPCError({ code: "NOT_FOUND", message: "許願不存在" });
      }
      await db.updateModelWishStatus(input.id, {
        status: input.status,
        // 明確區分 undefined（不動）vs null（清除）
        adminNote: input.adminNote,
      });
      return { success: true };
    }),
});
