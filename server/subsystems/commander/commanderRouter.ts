/**
 * commander / commanderRouter — M1-B createIntent Skeleton
 * ────────────────────────────────────────────────────────────────────────────
 * 任務總指揮入口 tRPC router。第一版只記錄創作意圖（createIntent 寫一筆 pending
 * orchestration run），並提供 getRun / listRunsByProject 查詢。所有 procedure 皆
 * protected，權限檢查在 commanderService 內完成；不呼叫任何外部 AI / 工具 API。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createIntent,
  getRun,
  listRunsByProject,
} from "./commanderService";
import { CommanderAccessError, ORCHESTRATION_MODES } from "./contracts";

function mapAccessError(error: unknown): never {
  if (error instanceof CommanderAccessError) {
    throw new TRPCError({
      code: error.reason === "forbidden" ? "FORBIDDEN" : "NOT_FOUND",
      message: error.message,
    });
  }
  throw error;
}

const createIntentInputSchema = z.object({
  projectId: z.number().int().positive().nullable().optional(),
  teamId: z.number().int().positive().nullable().optional(),
  mode: z.enum(ORCHESTRATION_MODES),
  intent: z.string().trim().min(1).max(4000),
});

export const commanderRouter = router({
  /**
   * 記錄一次創作意圖，建立 pending orchestration run。
   * 不呼叫外部模型；未帶 projectId 時 run 標記為無 project context。
   */
  createIntent: protectedProcedure
    .input(createIntentInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createIntent({
          userId: ctx.user.id,
          projectId: input.projectId ?? null,
          teamId: input.teamId ?? null,
          mode: input.mode,
          intent: input.intent,
        });
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 取得單筆 run（僅限擁有者）。 */
  getRun: protectedProcedure
    .input(z.object({ runId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRun(ctx.user.id, input.runId);
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 列出某專案的 runs（僅限專案擁有者）。 */
  listRunsByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        limit: z.number().int().positive().max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listRunsByProject(
          ctx.user.id,
          input.projectId,
          input.limit ?? 50,
        );
      } catch (error) {
        mapAccessError(error);
      }
    }),
});
