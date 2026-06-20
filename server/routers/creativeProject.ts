/**
 * Creative Project Router — 創作專案整合層
 *
 * 把 Director session（存在 project_notes_calendar）+ Worldbuilding
 * framework + World Storyboard 三者綁定成一個有意義的創作單位。全站光球
 * 與各 Studio 頁面透過 WorldContextContext 讀取目前選定的 project，
 * 從而獲得跨頁面共享的世界觀上下文。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { CreativeProject } from "../../drizzle/schema";
import { getProjectContextSummary } from "../subsystems/projectContext/projectContextService";
import { ProjectContextAccessError } from "../subsystems/projectContext/contracts";
import {
  recordAuditEvent,
  extractRequestSource,
} from "../services/audit/auditLog";

const projectStatusSchema = z.enum([
  "concept",
  "production",
  "review",
  "complete",
]);

const createInputSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10_000).optional(),
  directorSessionId: z.number().int().positive().nullable().optional(),
  worldFrameworkId: z.number().int().positive().nullable().optional(),
  worldStoryboardId: z.number().int().positive().nullable().optional(),
  worldviewId: z.number().int().positive().nullable().optional(),
  scriptId: z.number().int().positive().nullable().optional(),
  status: projectStatusSchema.optional(),
  coverImageUrl: z.string().max(2048).optional(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateInputSchema = z.object({
  id: z.number().int().positive(),
  patch: createInputSchema.partial(),
});

function rowToData(row: CreativeProject) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    directorSessionId: row.directorSessionId ?? null,
    worldFrameworkId: row.worldFrameworkId ?? null,
    worldStoryboardId: row.worldStoryboardId ?? null,
    worldviewId: row.worldviewId ?? null,
    scriptId: row.scriptId ?? null,
    status: row.status,
    coverImageUrl: row.coverImageUrl ?? undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const creativeProjectRouter = router({
  /** 列出當前使用者的所有創作專案 */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getCreativeProjectsByUser(ctx.user.id);
    return rows.map(rowToData);
  }),

  /** 取得單一創作專案（含關聯的世界觀摘要，方便前端一次取齊） */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getCreativeProject(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const data = rowToData(row);

      // 同時取得世界觀摘要（前端 WorldContext 可直接使用，少一次往返）
      let worldFrameworkName: string | null = null;
      if (data.worldFrameworkId) {
        const wb = await db.getWorldbuildingFramework(data.worldFrameworkId);
        if (wb && wb.userId === ctx.user.id) {
          worldFrameworkName = wb.name;
        }
      }

      return { ...data, worldFrameworkName };
    }),

  /**
   * M1-A Active Project Context：取得 `/create` 顯示的專案上下文摘要。
   * 彙整專案核心欄位、連結世界觀框架與最近素材；權限檢查在 service 內完成。
   */
  getContextSummary: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getProjectContextSummary(ctx.user.id, input.projectId);
      } catch (error) {
        if (error instanceof ProjectContextAccessError) {
          throw new TRPCError({
            code: error.reason === "forbidden" ? "FORBIDDEN" : "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  /** 建立新創作專案 */
  create: protectedProcedure
    .input(createInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const id = await db.createCreativeProject({
          userId: ctx.user.id,
          title: input.title,
          description: input.description ?? null,
          directorSessionId: input.directorSessionId ?? null,
          worldFrameworkId: input.worldFrameworkId ?? null,
          worldStoryboardId: input.worldStoryboardId ?? null,
          worldviewId: input.worldviewId ?? null,
          scriptId: input.scriptId ?? null,
          status: input.status ?? "concept",
          coverImageUrl: input.coverImageUrl ?? null,
          tags: input.tags ?? [],
          metadata: input.metadata ?? null,
        });
        recordAuditEvent({
          actorUserId: ctx.user.id,
          actorRole: ctx.user.role,
          action: "project.create",
          targetType: "project",
          targetId: id,
          metadata: { title: input.title },
          ...extractRequestSource(ctx.req),
        });
        return { id };
      } catch (error) {
        const cause = (error as { cause?: { code?: string; message?: string } })
          ?.cause;
        const reason = cause?.message ?? (error as Error).message;
        const code = cause?.code ? ` [${cause.code}]` : "";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `建立創作專案失敗${code}：${reason}`,
          cause: error,
        });
      }
    }),

  /** 更新創作專案 */
  update: protectedProcedure
    .input(updateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getCreativeProject(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const p = input.patch;
      await db.updateCreativeProject(input.id, {
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.directorSessionId !== undefined
          ? { directorSessionId: p.directorSessionId }
          : {}),
        ...(p.worldFrameworkId !== undefined
          ? { worldFrameworkId: p.worldFrameworkId }
          : {}),
        ...(p.worldStoryboardId !== undefined
          ? { worldStoryboardId: p.worldStoryboardId }
          : {}),
        ...(p.worldviewId !== undefined ? { worldviewId: p.worldviewId } : {}),
        ...(p.scriptId !== undefined ? { scriptId: p.scriptId } : {}),
        ...(p.status !== undefined ? { status: p.status } : {}),
        ...(p.coverImageUrl !== undefined
          ? { coverImageUrl: p.coverImageUrl }
          : {}),
        ...(p.tags !== undefined ? { tags: p.tags } : {}),
        ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
      });
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "project.update",
        targetType: "project",
        targetId: input.id,
        metadata: { fields: Object.keys(p) },
        ...extractRequestSource(ctx.req),
      });
      return { ok: true };
    }),

  /** 刪除創作專案 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getCreativeProject(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.deleteCreativeProject(input.id);
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "project.delete",
        targetType: "project",
        targetId: input.id,
        metadata: { title: existing.title },
        ...extractRequestSource(ctx.req),
      });
      return { ok: true };
    }),

  /**
   * 綁定（或解綁）三大資源到專案。傳 null 代表解綁。
   * 同時呼叫多個 link 可以一次設定多項；省略則維持原值。
   */
  link: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        directorSessionId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional(),
        worldFrameworkId: z.number().int().positive().nullable().optional(),
        worldStoryboardId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getCreativeProject(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.updateCreativeProject(input.id, {
        ...(input.directorSessionId !== undefined
          ? { directorSessionId: input.directorSessionId }
          : {}),
        ...(input.worldFrameworkId !== undefined
          ? { worldFrameworkId: input.worldFrameworkId }
          : {}),
        ...(input.worldStoryboardId !== undefined
          ? { worldStoryboardId: input.worldStoryboardId }
          : {}),
      });
      return { ok: true };
    }),
});
