import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { MODEL_PRICING_CATALOG } from "../services/modelPricing";

// ─── 財財 (accountant) 工具：對前端 / 光球都開放的四個唯讀 endpoint ─────────
//
// 為什麼放在 tRPC：
//   1. agentToolExecutor 已經有 server-side dispatch（accountant.* tools），但
//      ① 客戶端有時想直接顯示「這次會花多少」卡片，不一定要透過 LLM 中轉
//      ② BackgroundTasksContext 的 lookupExpensiveModel 需要一個前端可呼叫的
//         入口拿真實 catalog 資料（取代硬編碼 EXPENSIVE_MODEL_HINTS）
//   2. 共享同一個 server/services/spiritTools/accountantTools 實作 — 把
//      LLM 工具呼叫與 tRPC 客戶端呼叫對齊到同一份 ground truth。
//
// 所有 endpoint 都是唯讀，不扣款 / 不寫 DB，所以 estimate / compare / savings
// 用 publicProcedure（無需登入也能算）；usage 用 protectedProcedure 因為要
// 看使用者個人 apiUsageLogs。

export const accountantRouter = router({
  estimate: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        durationSec: z.number().nonnegative().optional(),
        charCount: z.number().nonnegative().optional(),
        imageCount: z.number().nonnegative().optional(),
        trainingSteps: z.number().nonnegative().optional(),
      })
    )
    .query(async ({ input }) => {
      const { estimateCost } = await import("../services/spiritTools/accountantTools");
      return estimateCost(input);
    }),

  compare: publicProcedure
    .input(
      z.object({
        category: z.string().min(1),
        durationSec: z.number().nonnegative().optional(),
        charCount: z.number().nonnegative().optional(),
        imageCount: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(10).optional(),
      })
    )
    .query(async ({ input }) => {
      const { compareModels } = await import("../services/spiritTools/accountantTools");
      // Validate category against catalog like the LLM dispatcher does —
      // otherwise an unknown enum silently returns an empty list.
      const knownCategories = new Set(
        Object.values(MODEL_PRICING_CATALOG).map(p => p.category)
      );
      if (!knownCategories.has(input.category as never)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown category: ${input.category}`,
        });
      }
      return compareModels({
        category: input.category as Parameters<typeof compareModels>[0]["category"],
        durationSec: input.durationSec,
        charCount: input.charCount,
        imageCount: input.imageCount,
        limit: input.limit,
      });
    }),

  usage: protectedProcedure.query(async ({ ctx }) => {
    const { getMonthlyUsage } = await import("../services/spiritTools/accountantTools");
    return getMonthlyUsage(ctx.user.id);
  }),

  savings: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        durationSec: z.number().nonnegative().optional(),
        charCount: z.number().nonnegative().optional(),
        imageCount: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(5).optional(),
      })
    )
    .query(async ({ input }) => {
      const { suggestSavings } = await import("../services/spiritTools/accountantTools");
      return suggestSavings(input);
    }),
});
