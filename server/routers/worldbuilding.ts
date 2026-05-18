/**
 * Worldbuilding Router — 導演 AI 的自訂世界觀架構器
 *
 * 提供 CRUD 端點，以及一個 `linkableModels` query
 * 回傳當前使用者已訓練完成（status = ready）的 LoRA 模型清單，
 * 供前端在角色卡 / 場景卡中下拉選擇。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  worldbuildingFrameworkInputSchema,
  type WorldbuildingFrameworkData,
} from "../../shared/worldbuilding-types";

function rowToData(row: NonNullable<Awaited<ReturnType<typeof db.getWorldbuildingFramework>>>): WorldbuildingFrameworkData & {
  id: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    genre: row.genre ?? undefined,
    characters: (row.charactersJson ?? []) as WorldbuildingFrameworkData["characters"],
    scenes: (row.scenesJson ?? []) as WorldbuildingFrameworkData["scenes"],
    objects: (row.objectsJson ?? undefined) as
      | WorldbuildingFrameworkData["objects"]
      | undefined,
    linkedModelIds: (row.linkedModelIds ?? undefined) as number[] | undefined,
    tags: (row.tags ?? undefined) as string[] | undefined,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const worldbuildingRouter = router({
  /** 列出當前使用者的所有世界觀 */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getWorldbuildingFrameworksByUser(ctx.user.id);
    return rows.map(rowToData);
  }),

  /** 取得單一世界觀 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldbuildingFramework(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return rowToData(row);
    }),

  /** 建立新世界觀 */
  create: protectedProcedure
    .input(worldbuildingFrameworkInputSchema)
    .mutation(async ({ ctx, input }) => {
      const id = await db.createWorldbuildingFramework({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        genre: input.genre,
        charactersJson: input.characters,
        scenesJson: input.scenes,
        objectsJson: input.objects ?? [],
        linkedModelIds: input.linkedModelIds ?? [],
        tags: input.tags ?? [],
        isActive: input.isActive ?? true,
      });
      return { id };
    }),

  /** 更新既有世界觀 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: worldbuildingFrameworkInputSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldbuildingFramework(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const p = input.patch;
      await db.updateWorldbuildingFramework(input.id, {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.genre !== undefined ? { genre: p.genre } : {}),
        ...(p.characters !== undefined
          ? { charactersJson: p.characters }
          : {}),
        ...(p.scenes !== undefined ? { scenesJson: p.scenes } : {}),
        ...(p.objects !== undefined ? { objectsJson: p.objects } : {}),
        ...(p.linkedModelIds !== undefined
          ? { linkedModelIds: p.linkedModelIds }
          : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
        ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
      });
      return { ok: true };
    }),

  /** 刪除世界觀 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldbuildingFramework(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.deleteWorldbuildingFramework(input.id);
      return { ok: true };
    }),

  /**
   * 列出當前使用者已訓練完成、可以被角色 / 場景連結的 LoRA 模型清單。
   * 從模型訓練中心（fine_tuned_models）撈出 status=ready 的條目。
   */
  linkableModels: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);
    return models
      .filter(m => m.status === "ready" || m.status === "training")
      .map(m => {
        const config = (m.configJson ?? {}) as Record<string, unknown>;
        return {
          id: m.id,
          name: m.name,
          modelType: m.modelType,
          status: m.status,
          triggerWord: (config.triggerWord as string | undefined) ?? null,
        };
      });
  }),
});
