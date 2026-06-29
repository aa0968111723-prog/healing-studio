import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { recordModelPick } from "../services/agentModelPicks";

// ─── Generation History ───────────────────────────────────────────────────────

/**
 * AIDV-609 — 擁有權守門。
 *
 * `generation_history` 的 id 是連號整數、可枚舉，因此每個「以 id 操作別人記錄」
 * 的 mutation 都必須先確認這筆記錄屬於目前登入者。`db.getHistoryEntry(id, userId)`
 * 的 WHERE 已含 `and(eq(id), eq(userId))`，命中 0 代表「不存在或不屬於你」。
 * 一律回 NOT_FOUND（而非 FORBIDDEN）以避免洩漏「該 id 是否存在」。
 *
 * 回傳已驗證擁有的那一列，呼叫端可直接重用、免去二次查詢。
 */
async function assertHistoryOwned(id: number, userId: number) {
  const entry = await db.getHistoryEntry(id, userId);
  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "找不到這筆生成記錄，或它不屬於你。",
    });
  }
  return entry;
}

export const historyRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await db.getHistoryByUser(ctx.user.id, input?.limit ?? 50);
      } catch {
        return [];
      }
    }),

  bookmarked: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await db.getBookmarkedHistory(ctx.user.id);
    } catch {
      return [];
    }
  }),

  toggleBookmark: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        isBookmarked: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertHistoryOwned(input.id, ctx.user.id);
      await db.updateHistoryEntry(input.id, {
        isBookmarked: input.isBookmarked,
      });
      return { success: true };
    }),

  rate: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        rating: z.number().min(1).max(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 先驗擁有權再寫入，並重用已取回的記錄做 model-pick 回饋（免二次查詢）。
      const entry = await assertHistoryOwned(input.id, ctx.user.id);
      await db.updateHistoryEntry(input.id, { userRating: input.rating });
      if (input.rating >= 4) {
        const snap = entry.parameterSnapshot as Record<string, unknown> | null;
        const modelId = snap?.modelId;
        if (typeof modelId === "string" && modelId.trim()) {
          void recordModelPick({
            userId: ctx.user.id,
            modality: entry.modality,
            modelId: modelId.trim(),
            source: "history",
            accepted: true,
            context: { fromRating: input.rating },
          }).catch(() => {});
        }
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await assertHistoryOwned(input.id, ctx.user.id);
      await db.deleteHistoryEntry(input.id);
      return { success: true };
    }),
});
