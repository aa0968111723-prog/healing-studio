/**
 * server/routers/aiModels.ts — AI 模型情報專區的唯讀 + admin tRPC router
 *
 * 端點：
 *   aiModels.list          — 回傳所有模型（含 enrichment）給前端 hub 渲染
 *   aiModels.getById       — 單一模型詳情（含 enrichment + factCheck sources）
 *   aiModels.researchStats — 取得自動研究 cron 狀態 / 覆蓋率
 *   aiModels.refreshOne    — admin 手動觸發單一模型的自動研究
 *   aiModels.refreshAll    — admin 觸發完整 catalog 重新研究（背景執行）
 *
 * 設計：
 *   - list / getById / researchStats 皆為 publicProcedure，未登入也可讀
 *   - refreshOne / refreshAll 為 adminProcedure（透過 tRPC 中間件保護）
 *   - 回傳結構穩定 — 即使 enrichment 未就緒，baseline 資料仍會回傳
 */

import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getEnrichedCatalog,
  getEnrichedModel,
  getResearchStats,
  getDiscoveries,
  researchAndFactCheckModel,
} from "../services/modelResearcher";
import {
  AI_MODELS_CATALOG,
  computeFactCheckStatus,
  FACT_CHECK_STALE_DAYS,
} from "../../shared/aiModelsCatalog";
import {
  triggerModelResearchRunNow,
  triggerStaleRefreshNow,
  triggerDiscoveryNow,
  getCronStatus,
} from "../jobs/modelCatalogResearchJob";

export const aiModelsRouter = router({
  /**
   * aiModels.list — 全部模型（baseline + 自動研究 enrichment）
   *
   * 輸入：可選的 modality / provider / tier 過濾。
   * 輸出：模型陣列 + meta（總數、stale 數、上次研究時間）。
   */
  list: publicProcedure
    .input(
      z
        .object({
          modality: z.string().optional(),
          provider: z.string().optional(),
          tier: z.string().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const all = getEnrichedCatalog();
      const filtered = all.filter(m => {
        if (
          input?.modality &&
          input.modality !== "all" &&
          m.modality !== input.modality
        ) {
          return false;
        }
        if (
          input?.provider &&
          input.provider !== "all" &&
          m.provider !== input.provider
        ) {
          return false;
        }
        if (input?.tier && input.tier !== "all" && m.tier !== input.tier) {
          return false;
        }
        return true;
      });

      const stats = getResearchStats();
      const staleCount = all.filter(
        m => computeFactCheckStatus(m.factCheck) === "stale"
      ).length;
      const verifiedCount = all.filter(
        m =>
          m.factCheck.status === "verified" ||
          m.factCheck.status === "auto-checked"
      ).length;

      return {
        models: filtered,
        meta: {
          total: all.length,
          shown: filtered.length,
          verifiedCount,
          staleCount,
          coverage: stats.coverage,
          lastResearchAt: stats.lastRunAt,
          staleThresholdDays: FACT_CHECK_STALE_DAYS,
        },
      };
    }),

  /**
   * aiModels.getById — 單一模型詳情（含完整 fact-check sources）
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().min(1).max(120) }))
    .query(({ input }) => {
      const model = getEnrichedModel(input.id);
      if (!model) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到模型：${input.id}`,
        });
      }
      return { model };
    }),

  /**
   * aiModels.researchStats — 取得自動研究的整體狀態
   */
  researchStats: publicProcedure.query(() => {
    const cron = getCronStatus();
    return {
      ...cron,
      totalModels: AI_MODELS_CATALOG.length,
    };
  }),

  /**
   * aiModels.refreshOne — admin 觸發單一模型的自動研究（同步）
   */
  refreshOne: adminProcedure
    .input(
      z.object({
        id: z.string().min(1).max(120),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await researchAndFactCheckModel(input.id, {
        force: input.force ?? true,
        userId: ctx.user?.id ?? null,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.reason ?? "Research failed",
        });
      }
      return { model: result.model };
    }),

  /**
   * aiModels.refreshAll — admin 觸發完整 catalog 重新研究（背景執行）
   */
  refreshAll: adminProcedure.mutation(async () => {
    const result = await triggerModelResearchRunNow();
    if (!result.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.message,
      });
    }
    return { message: result.message };
  }),

  /**
   * aiModels.refreshStale — admin 只查核 stale / pending / error 的模型
   * 用於日常維護，比 refreshAll 便宜很多。
   */
  refreshStale: adminProcedure.mutation(async () => {
    const result = await triggerStaleRefreshNow();
    if (!result.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.message,
      });
    }
    return { message: result.message };
  }),

  /**
   * aiModels.discoveries — 本期由 discovery cron 找到的新模型 / 新論文 /
   * 既有模型更新；公開讀取。
   */
  discoveries: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(40).optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const { items, stats } = getDiscoveries(input?.limit ?? 20);
      return {
        items,
        stats,
      };
    }),

  /**
   * aiModels.runDiscovery — admin 立即跑一次 discovery（找新模型 / 新論文）
   */
  runDiscovery: adminProcedure.mutation(async () => {
    const result = await triggerDiscoveryNow();
    if (!result.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.message,
      });
    }
    return { message: result.message };
  }),
});
