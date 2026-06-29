import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── 創作工作室持久化（RecipeLibraryPanel / VersionHistoryPanel）─────────────
// Studio.tsx 之前把 savedRecipes / versions 放在 useState，重新整理就消失。
// 兩個 sub-router 把它們搬到 MySQL；schema 見 drizzle/schema.ts
// studioRecipes / studioVersions（migration 0030）。

export const studioRouter = router({
  recipes: router({
    list: protectedProcedure
      .input(
        z
          .object({
            modality: z
              .enum(["image", "video", "music", "voice"])
              .optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        return db.listStudioRecipes(ctx.user.id, input?.modality);
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          modality: z.enum(["image", "video", "music", "voice"]),
          payload: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createStudioRecipe({
          userId: ctx.user.id,
          name: input.name,
          modality: input.modality,
          payload: input.payload,
        });
        return { id, success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteStudioRecipe(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  versions: router({
    list: protectedProcedure
      .input(
        z
          .object({
            modality: z
              .enum(["image", "video", "music", "voice"])
              .optional(),
            limit: z.number().min(1).max(200).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        return db.listStudioVersions(
          ctx.user.id,
          input?.modality,
          input?.limit ?? 50
        );
      }),

    create: protectedProcedure
      .input(
        z.object({
          modality: z.enum(["image", "video", "music", "voice"]),
          versionKey: z.string().min(1).max(64),
          pinned: z.boolean().optional(),
          payload: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createStudioVersion({
          userId: ctx.user.id,
          modality: input.modality,
          versionKey: input.versionKey,
          pinned: input.pinned ?? false,
          payload: input.payload,
        });
        return { id, success: true };
      }),

    setPinned: protectedProcedure
      .input(
        z.object({
          versionKey: z.string().min(1).max(64),
          pinned: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await db.setStudioVersionPinned(
          ctx.user.id,
          input.versionKey,
          input.pinned
        );
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteStudioVersion(input.id, ctx.user.id);
        return { success: true };
      }),
  }),
});
