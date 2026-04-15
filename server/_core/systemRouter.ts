import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getEngineStatus } from "./llmRouter";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z
        .object({
          timestamp: z.number().min(0, "timestamp cannot be negative"),
        })
        .optional()
    )
    .query(() => ({
      ok: true,
      ts: Date.now(),
    })),

  /**
   * 查詢目前 LLM 引擎狀態
   * 回傳：當前引擎名稱、可用引擎列表、缺少的 API Key、優化建議
   */
  engineStatus: publicProcedure.query(() => {
    return getEngineStatus();
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
