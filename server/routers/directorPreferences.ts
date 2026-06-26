import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Director Preferences ─────────────────────────────────────────────────────

export const directorPreferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const pref = await db.getDirectorPreferences(ctx.user.id);
    if (pref) return pref;
    return {
      id: 0,
      userId: ctx.user.id,
      personality: "creative" as const,
      preferredFormat: "co-star" as const,
      updatedAt: new Date(),
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        personality: z.enum(["calm", "creative", "technical"]).optional(),
        preferredFormat: z
          .enum(["co-star", "sslcm", "selcm", "free"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.upsertDirectorPreferences(ctx.user.id, input);
      return { id };
    }),
});
