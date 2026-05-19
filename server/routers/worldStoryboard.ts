/**
 * World Storyboard Router — 動畫分鏡時間軸 CRUD + 管線編排
 *
 * 提供：
 *   - CRUD：list / get / listByWorld / create / update / delete
 *   - skeleton：根據世界觀自動生成空白分鏡骨架
 *   - plan：呼叫 planAnimationPipeline 產出可執行步驟序列
 *   - summarize：把分鏡壓成 LLM-friendly 純文字（給 review / 編劇用）
 *   - validate：時間軸合法性檢查
 *   - exportShotList：把分鏡輸出成「鏡頭表」格式（CSV / JSON）
 *
 * 動畫管線實際執行（kick off render jobs）會接到 cross-modality-workflows 的
 * VIDEO_CREATION_WORKFLOW，但完整 orchestrator 跨多個 spirit，超出本 router
 * 的範圍。本 router 只負責「規劃」和「狀態追蹤」，執行交給 Director AI /
 * 全域代理。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  worldStoryboardInputSchema,
  planAnimationPipeline,
  seedStoryboardSkeleton,
  validateStoryboardTimeline,
  summarizeStoryboardForPrompt,
  type WorldStoryboard,
} from "../../shared/worldbuilding-animation";
import type { WorldbuildingFrameworkData } from "../../shared/worldbuilding-types";

// ─── 內部 helper：DB row → API model ────────────────────────────────────────

function rowToStoryboard(
  row: NonNullable<Awaited<ReturnType<typeof db.getWorldStoryboard>>>
): WorldStoryboard & {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  pipelinePlan?: Record<string, unknown> | null;
  jobs?: Record<string, Record<string, unknown>> | null;
} {
  return {
    id: row.id,
    worldId: row.worldId,
    name: row.name,
    totalDurationSec: row.totalDurationSec,
    fps: row.fps,
    aspectRatio: row.aspectRatio,
    scenes: (row.scenesJson ?? []) as WorldStoryboard["scenes"],
    sourceScriptId: row.sourceScriptId ?? undefined,
    narration: row.narration ?? undefined,
    productionStatus: row.productionStatus as WorldStoryboard["productionStatus"],
    finalVideoUrl: row.finalVideoUrl ?? undefined,
    estimatedCostUsd: row.estimatedCostUsd
      ? Number(row.estimatedCostUsd)
      : undefined,
    pipelinePlan: (row.pipelinePlanJson ?? null) as Record<string, unknown> | null,
    jobs: (row.jobsJson ?? null) as Record<
      string,
      Record<string, unknown>
    > | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 取得世界觀並驗證 ownership */
async function loadFramework(
  ctxUserId: number,
  worldId: number
): Promise<WorldbuildingFrameworkData & { id: number }> {
  const w = await db.getWorldbuildingFramework(worldId);
  if (!w || w.userId !== ctxUserId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "世界觀不存在或無權存取" });
  }
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? undefined,
    genre: w.genre ?? undefined,
    era: w.era ?? undefined,
    characters: (w.charactersJson ?? []) as WorldbuildingFrameworkData["characters"],
    scenes: (w.scenesJson ?? []) as WorldbuildingFrameworkData["scenes"],
    objects: (w.objectsJson ?? undefined) as
      | WorldbuildingFrameworkData["objects"]
      | undefined,
    linkedModelIds: (w.linkedModelIds ?? undefined) as number[] | undefined,
    styleProfiles: (w.styleProfilesJson ?? undefined) as
      | WorldbuildingFrameworkData["styleProfiles"]
      | undefined,
    musicThemes: (w.musicThemesJson ?? undefined) as
      | WorldbuildingFrameworkData["musicThemes"]
      | undefined,
    defaultStyleProfileId: w.defaultStyleProfileId ?? null,
    globalNegativePrompt: w.globalNegativePrompt ?? undefined,
    productionTargets: (w.productionTargetsJson ?? undefined) as
      | WorldbuildingFrameworkData["productionTargets"]
      | undefined,
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const worldStoryboardRouter = router({
  /** 列出當前使用者的所有分鏡 */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.getWorldStoryboardsByUser(ctx.user.id);
    return rows.map(rowToStoryboard);
  }),

  /** 按世界觀列出分鏡 */
  listByWorld: protectedProcedure
    .input(z.object({ worldId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await loadFramework(ctx.user.id, input.worldId); // ownership check
      const rows = await db.getWorldStoryboardsByWorld(input.worldId);
      return rows.map(rowToStoryboard);
    }),

  /** 取得單一分鏡 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return rowToStoryboard(row);
    }),

  /** 建立新分鏡 */
  create: protectedProcedure
    .input(worldStoryboardInputSchema)
    .mutation(async ({ ctx, input }) => {
      await loadFramework(ctx.user.id, input.worldId); // ownership
      const id = await db.createWorldStoryboard({
        userId: ctx.user.id,
        worldId: input.worldId,
        name: input.name,
        totalDurationSec: input.totalDurationSec,
        fps: input.fps,
        aspectRatio: input.aspectRatio,
        scenesJson: input.scenes,
        sourceScriptId: input.sourceScriptId,
        narration: input.narration,
        productionStatus: input.productionStatus,
        finalVideoUrl: input.finalVideoUrl,
        estimatedCostUsd: input.estimatedCostUsd?.toString(),
      });
      return { id };
    }),

  /** 更新既有分鏡 */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: worldStoryboardInputSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldStoryboard(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const p = input.patch;
      await db.updateWorldStoryboard(input.id, {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.totalDurationSec !== undefined
          ? { totalDurationSec: p.totalDurationSec }
          : {}),
        ...(p.fps !== undefined ? { fps: p.fps } : {}),
        ...(p.aspectRatio !== undefined
          ? { aspectRatio: p.aspectRatio }
          : {}),
        ...(p.scenes !== undefined ? { scenesJson: p.scenes } : {}),
        ...(p.sourceScriptId !== undefined
          ? { sourceScriptId: p.sourceScriptId }
          : {}),
        ...(p.narration !== undefined ? { narration: p.narration } : {}),
        ...(p.productionStatus !== undefined
          ? { productionStatus: p.productionStatus }
          : {}),
        ...(p.finalVideoUrl !== undefined
          ? { finalVideoUrl: p.finalVideoUrl }
          : {}),
        ...(p.estimatedCostUsd !== undefined
          ? { estimatedCostUsd: p.estimatedCostUsd?.toString() }
          : {}),
      });
      return { ok: true };
    }),

  /** 刪除分鏡 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getWorldStoryboard(input.id);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.deleteWorldStoryboard(input.id);
      return { ok: true };
    }),

  /**
   * 自動生成「空白分鏡骨架」—— 從世界觀派生出基本時間軸，
   * 由前端 / 編劇接著手動補對白與圖楨。
   */
  seedSkeleton: protectedProcedure
    .input(
      z.object({
        worldId: z.number().int().positive(),
        totalDurationSec: z.number().int().min(5).max(60 * 60 * 6),
        sceneCount: z.number().int().min(1).max(60).optional(),
        aspectRatio: z.string().max(16).optional(),
        fps: z.number().int().min(1).max(120).optional(),
        autoSave: z.boolean().default(false),
        name: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const framework = await loadFramework(ctx.user.id, input.worldId);
      const skeleton = seedStoryboardSkeleton({
        framework,
        totalDurationSec: input.totalDurationSec,
        sceneCount: input.sceneCount,
        aspectRatio: input.aspectRatio,
        fps: input.fps,
      });
      if (input.name) skeleton.name = input.name;
      if (input.autoSave) {
        const id = await db.createWorldStoryboard({
          userId: ctx.user.id,
          worldId: input.worldId,
          name: skeleton.name,
          totalDurationSec: skeleton.totalDurationSec,
          fps: skeleton.fps,
          aspectRatio: skeleton.aspectRatio,
          scenesJson: skeleton.scenes,
          productionStatus: skeleton.productionStatus,
        });
        return { id, storyboard: { ...skeleton, id } };
      }
      return { id: null, storyboard: skeleton };
    }),

  /** 驗證時間軸合法性（不重疊、不超時、不漏 frame） */
  validate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const sb = rowToStoryboard(row);
      return { errors: validateStoryboardTimeline(sb) };
    }),

  /**
   * 編排動畫管線：對 storyboard 跑 planAnimationPipeline，
   * 回傳所有 render job 步驟、估時、估價，並把 plan 寫回 DB（pipelinePlanJson）。
   */
  planPipeline: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        skipRefine: z.boolean().optional(),
        skipVideo: z.boolean().optional(),
        persist: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const framework = await loadFramework(ctx.user.id, row.worldId);
      const sb = rowToStoryboard(row);
      const plan = planAnimationPipeline(sb, framework, {
        skipRefine: input.skipRefine,
        skipVideo: input.skipVideo,
      });
      if (input.persist) {
        await db.updateWorldStoryboard(input.id, {
          pipelinePlanJson: plan as unknown as Record<string, unknown>,
          estimatedCostUsd: plan.estimatedCostUsd?.toString(),
        });
      }
      return plan;
    }),

  /** 更新某個 step 的執行狀態（給渲染管線回寫進度用） */
  updateJob: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        stepId: z.string().min(1).max(128),
        status: z.enum([
          "queued",
          "running",
          "success",
          "failed",
          "skipped",
        ]),
        output: z.unknown().optional(),
        error: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const existingJobs =
        (row.jobsJson ?? {}) as Record<string, Record<string, unknown>>;
      existingJobs[input.stepId] = {
        ...(existingJobs[input.stepId] ?? {}),
        status: input.status,
        output: input.output,
        error: input.error,
        updatedAt: new Date().toISOString(),
      };
      await db.updateWorldStoryboard(input.id, {
        jobsJson: existingJobs,
      });
      return { ok: true };
    }),

  /** 把分鏡壓成 LLM-friendly 純文字（給 review / 對白生成 / 編劇潤稿用） */
  summarizeForPrompt: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const framework = await loadFramework(ctx.user.id, row.worldId);
      const sb = rowToStoryboard(row);
      return { summary: summarizeStoryboardForPrompt(sb, framework) };
    }),

  /**
   * 匯出「鏡頭表」—— CSV / JSON 兩種，給導演 / 動畫師外部協作用。
   * CSV 欄位：場序、起、訖、時長、場景、角色、表情、穿著、動作、對白、鏡頭、配樂
   */
  exportShotList: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        format: z.enum(["csv", "json"]).default("csv"),
      })
    )
    .query(async ({ ctx, input }) => {
      const row = await db.getWorldStoryboard(input.id);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const framework = await loadFramework(ctx.user.id, row.worldId);
      const sb = rowToStoryboard(row);

      if (input.format === "json") {
        return { mimeType: "application/json", body: JSON.stringify(sb, null, 2) };
      }

      // CSV
      const rows: string[] = [];
      rows.push(
        [
          "順序",
          "起秒",
          "訖秒",
          "場景",
          "角色",
          "表情",
          "穿著",
          "對白",
          "鏡頭",
          "配樂",
        ].join(",")
      );
      for (const sc of [...sb.scenes].sort(
        (a, b) => a.startSec - b.startSec
      )) {
        const worldScene = framework.scenes.find(
          s => s.id === sc.worldSceneId
        );
        const musicTheme = framework.musicThemes?.find(
          m =>
            m.id ===
            (sc.musicThemeId ??
              sc.audioClips.find(a => a.kind === "music")?.musicThemeId)
        );
        if (sc.characterBeats.length === 0) {
          rows.push(
            csvLine([
              String(sc.sequenceIndex + 1),
              String(sc.startSec),
              String(sc.endSec),
              worldScene?.name ?? "",
              "",
              "",
              "",
              "",
              sc.cameraDirection ?? "",
              musicTheme?.name ?? "",
            ])
          );
        }
        for (const beat of sc.characterBeats) {
          const c = framework.characters.find(
            ch => ch.id === beat.characterId
          );
          const expr = c?.expressions?.find(e => e.id === beat.expressionId);
          const outfit = c?.outfits?.find(o => o.id === beat.outfitId);
          rows.push(
            csvLine([
              String(sc.sequenceIndex + 1),
              String(sc.startSec + beat.startOffsetSec),
              String(sc.startSec + beat.startOffsetSec + beat.durationSec),
              worldScene?.name ?? "",
              c?.name ?? "",
              expr?.name ?? "",
              outfit?.name ?? "",
              beat.dialogue ?? "",
              sc.cameraDirection ?? "",
              musicTheme?.name ?? "",
            ])
          );
        }
      }
      return { mimeType: "text/csv", body: rows.join("\n") };
    }),
});

function csvLine(cols: string[]): string {
  return cols
    .map(c => {
      const v = c ?? "";
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    })
    .join(",");
}
