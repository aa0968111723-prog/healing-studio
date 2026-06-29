import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { recordModelPick } from "../services/agentModelPicks";

// ─── Generation History ───────────────────────────────────────────────────────

export const historyRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await db.getHistoryByUser(ctx.user.id, input?.limit ?? 50);
      } catch (err) {
        console.error("[history.list] DB error:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "歷史紀錄暫時無法載入" });
      }
    }),

  bookmarked: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await db.getBookmarkedHistory(ctx.user.id);
    } catch (err) {
      console.error("[history.bookmarked] DB error:", err);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "書籤歷史暫時無法載入" });
    }
  }),

  toggleBookmark: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        isBookmarked: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
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
      await db.updateHistoryEntry(input.id, { userRating: input.rating });
      if (input.rating >= 4) {
        void db.getHistoryEntry(input.id, ctx.user.id).then(entry => {
          const snap = entry?.parameterSnapshot as Record<string, unknown> | null;
          const modelId = snap?.modelId;
          if (entry && typeof modelId === "string" && modelId.trim()) {
            void recordModelPick({
              userId: ctx.user.id,
              modality: entry.modality,
              modelId: modelId.trim(),
              source: "history",
              accepted: true,
              context: { fromRating: input.rating },
            });
          }
        }).catch(() => {});
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteHistoryEntry(input.id);
      return { success: true };
    }),
});
