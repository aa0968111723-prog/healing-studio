import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Custom Blocks ─────────────────────────────────────────────────────────────

export const customBlocksRouter = router({
  list: protectedProcedure
    .input(z.object({ modality: z.enum(["image", "video", "audio", "voice"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return db.getCustomBlocksByUser(ctx.user.id, input?.modality);
    }),

  create: protectedProcedure
    .input(
      z.object({
        modality: z.enum(["image", "video", "audio", "voice"]),
        category: z.string().min(1),
        label: z.string().min(1).max(128),
        prompt: z.string().min(1).max(512),
        emoji: z.string().max(8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createCustomBlock({
        userId: ctx.user.id,
        modality: input.modality,
        category: input.category,
        label: input.label,
        prompt: input.prompt,
        emoji: input.emoji,
      });
      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteCustomBlock(input.id, ctx.user.id);
      return { success: true };
    }),
});
