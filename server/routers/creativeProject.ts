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
import { isDataRbacEnabled } from "../services/authz/resourceAccess";
import { canAccessResource } from "../services/authz/resourceAccessResolver";

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
  /** AIDV-316 樂觀鎖：攜帶呼叫方讀到的 version，後端做原子 WHERE id=? AND version=?；
   *  version 不符時回傳 CONFLICT(409)；省略時退化為無版本檢查（向下相容）。 */
  expectedVersion: z.number().int().nonnegative().optional(),
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
    version: row.version,
  };
}

export const creativeProjectRouter = router({
  // AIDV-617: 過渡期 LIMIT 100 防止重度用戶 OOM；前端 8 callsite 應逐步遷移至 listPaginated（infinite query）
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getCreativeProjectsByUser(ctx.user.id, { limit: 100 });
    return rows.map(rowToData);
  }),

  // AIDV-314: cursor 分頁版本（cursor = 上次最後一筆 id；limit 預設 20 / 最大 50）
  // 適合 /video 列表無限捲動；目標：前端 callsite 全數遷移後廢棄上方 list（AIDV-617）。
  listPaginated: protectedProcedure
    .input(
      z.object({
        cursor: z.number().int().positive().optional(),
        limit: z.number().min(1).max(50).default(20),
        search: z.string().max(200).optional(),
        status: projectStatusSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await db.getCreativeProjectsByUserPaginated(ctx.user.id, {
        cursor: input.cursor,
        limit: input.limit + 1,
        search: input.search,
        status: input.status,
      });
      const hasNextPage = rows.length > input.limit;
      const projects = rows.slice(0, input.limit).map(rowToData);
      return {
        projects,
        nextCursor: hasNextPage ? (projects[projects.length - 1]?.id ?? null) : null,
      };
    }),

  /** 取得單一創作專案（含關聯的世界觀摘要，方便前端一次取齊） */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getCreativeProject(input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // ── AIDV-121 enforcement（旗標 gate）─────────────────────────────
      // 旗標 OFF（預設）= 完全保持現狀：只有 owner 看得到（非 owner→NOT_FOUND）。
      // 旗標 ON = owner 仍可，且額外允許「被顯式共享給此 user/team 的」viewer/
      //   editor 看到（A 看得到 B 顯式共享給 A 的專案）。OFF 路徑位元相同。
      if (row.userId !== ctx.user.id) {
        const allowed =
          isDataRbacEnabled() &&
          (await canAccessResource(
            "project",
            row.id,
            { ownerId: row.userId, visibility: null, teamId: null },
            ctx.user.id,
            "view"
          ));
        if (!allowed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
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
      const { updated } = await db.updateCreativeProject(
        input.id,
        {
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
        },
        { expectedVersion: input.expectedVersion }
      );
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "版本衝突：專案已被其他代理更新，請重新載入後重試（optimistic lock AIDV-316）",
        });
      }
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
      // AIDV-121：清掉此資源的孤兒共享記錄（resource_shares 無 FK，刪資源不會
      // cascade）。best-effort，不阻塞刪除主流程（與 audit 同模式）。
      try {
        await db.deleteAllSharesForResource("project", input.id);
      } catch {
        /* 清孤兒失敗不應擋刪除 */
      }
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

  /** 複製創作專案 — 建立同名（附「(副本)」）的新專案，繼承所有關聯欄位 */
  duplicate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const source = await db.getCreativeProject(input.id);
      if (!source || source.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const newId = await db.createCreativeProject({
        userId: ctx.user.id,
        title: `${source.title} (副本)`,
        description: source.description ?? null,
        directorSessionId: null,
        worldFrameworkId: source.worldFrameworkId ?? null,
        worldStoryboardId: source.worldStoryboardId ?? null,
        worldviewId: source.worldviewId ?? null,
        scriptId: source.scriptId ?? null,
        status: "concept",
        coverImageUrl: source.coverImageUrl ?? null,
        tags: Array.isArray(source.tags) ? (source.tags as string[]) : [],
        metadata: source.metadata && typeof source.metadata === "object"
          ? (source.metadata as Record<string, unknown>)
          : null,
      });
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "project.duplicate",
        targetType: "project",
        targetId: newId,
        metadata: { sourceId: input.id, title: source.title },
        ...extractRequestSource(ctx.req),
      });
      return { id: newId };
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
      if (input.directorSessionId != null) {
        const session = await db.getProjectNote(input.directorSessionId);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      if (input.worldFrameworkId != null) {
        const fw = await db.getWorldbuildingFramework(input.worldFrameworkId);
        if (!fw || fw.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      if (input.worldStoryboardId != null) {
        const sb = await db.getWorldStoryboard(input.worldStoryboardId);
        if (!sb || sb.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
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
