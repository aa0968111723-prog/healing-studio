import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── User Profile ─────────────────────────────────────────────────────────────

export const profileRouter = router({
  updateQuotaJson: protectedProcedure
    .input(
      z.object({
        image: z.number().min(0),
        video: z.number().min(0),
        audio: z.number().min(0),
        voice: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.updateUserQuotaJson(ctx.user.id, input);
      return { success: true };
    }),

  updateOnboarding: protectedProcedure
    .input(z.object({ done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUserOnboarding(ctx.user.id, input.done);
      return { success: true };
    }),

  deleteAccount: protectedProcedure
    .input(z.object({ confirmation: z.literal("DELETE MY ACCOUNT") }))
    .mutation(async ({ ctx }) => {
      await db.deleteUserAccount(ctx.user.id);
      return { success: true };
    }),

  exportData: protectedProcedure.query(async ({ ctx }) => {
    return db.exportUserData(ctx.user.id);
  }),
});
