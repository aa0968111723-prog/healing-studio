import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Consistency Vault ────────────────────────────────────────────────────────

export const vaultRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          itemType: z.enum(["character", "scene"]).optional(),
          search: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      let items = input?.itemType
        ? await db.getVaultItemsByType(ctx.user.id, input.itemType)
        : await db.getVaultItemsByUser(ctx.user.id);

      if (input?.search) {
        const q = input.search.toLowerCase();
        items = items.filter(
          v =>
            v.name.toLowerCase().includes(q) ||
            ((v.tags as string[] | null) || []).some(t =>
              t.toLowerCase().includes(q)
            )
        );
      }
      if (input?.tags && input.tags.length > 0) {
        items = items.filter(v => {
          const vTags = (v.tags as string[] | null) || [];
          return input.tags!.some(t => vTags.includes(t));
        });
      }
      return items;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        itemType: z.enum(["character", "scene"]),
        imageUrl: z.string().min(1),
        fileKey: z.string().optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createVaultItem({
        userId: ctx.user.id,
        name: input.name,
        itemType: input.itemType,
        imageUrl: input.imageUrl,
        fileKey: input.fileKey,
        tags: input.tags,
        metadata: input.metadata,
      });
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(128).optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        imageUrl: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await db.getVaultItem(input.id);
      if (!item || item.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "保險庫項目不存在",
        });
      }
      await db.updateVaultItem(input.id, {
        name: input.name,
        tags: input.tags,
        imageUrl: input.imageUrl,
        metadata: input.metadata,
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.getVaultItem(input.id);
      if (!item || item.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "保險庫項目不存在",
        });
      }
      await db.deleteVaultItem(input.id);
      return { success: true };
    }),

  exportToAssets: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.getVaultItem(input.id);
      if (!item || item.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "保險庫項目不存在",
        });
      }
      const assetId = await db.createDigitalAsset({
        userId: ctx.user.id,
        title: `[保險庫] ${item.name}`,
        description: `從一致性保險庫匯出 (${item.itemType})`,
        assetType: "image",
        fileUrl: item.imageUrl,
        fileKey: item.fileKey || "",
      });
      return { assetId };
    }),
});
