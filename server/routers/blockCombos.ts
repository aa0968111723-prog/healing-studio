import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Block Combos ──────────────────────────────────────────────────────────────

export const blockCombosRouter = router({
  list: protectedProcedure
    .input(z.object({ modality: z.enum(["image", "video", "audio", "voice"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return db.getBlockCombosByUser(ctx.user.id, input?.modality);
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        modality: z.enum(["image", "video", "audio", "voice"]),
        blockIds: z.array(z.string()),
        customBlockIds: z.array(z.number()).optional(),
        vibeCardIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createBlockCombo({
        userId: ctx.user.id,
        name: input.name,
        modality: input.modality,
        blockIds: input.blockIds,
        customBlockIds: input.customBlockIds,
        vibeCardIds: input.vibeCardIds,
      });
      return { id };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.renameBlockCombo(input.id, ctx.user.id, input.name);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteBlockCombo(input.id, ctx.user.id);
      return { success: true };
    }),
});
