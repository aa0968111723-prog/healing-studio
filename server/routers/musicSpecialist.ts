import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";

// ─── 音音 (music-specialist) 工具：對前端 / 光球都開放的諮詢 endpoint ─────
//
// 為什麼放在 tRPC（與 accountant.* 同一理由）：
//   1. agentToolExecutor 已經有 server-side dispatch（musicSpecialist.* tools），
//      但前端的 ProStudio / OrbCreationStage 也想直接：
//        ① 在使用者填 mood + duration 時即時顯示「推薦引擎 + 預估點數」卡片
//        ② 在 BGM 模板選擇 UI 列出所有 engine（依 capability 過濾）
//        ③ 在「最近作品」面板抓使用者之前做過的音檔（getRecentAssets）
//      不需要每個 UI 元件都包一層 LLM，這四個 endpoint 共享 musicSpecialistTools
//      的同一份實作，與 LLM tool dispatch 的回值對齊。
//   2. estimate / list / recommend 屬唯讀且不需 user-specific 資訊，用
//      publicProcedure；getRecent 需要 userId，用 protectedProcedure。

export const musicSpecialistRouter = router({
  recommendEngine: publicProcedure
    .input(
      z.object({
        capability: z.enum([
          "music-vocals",
          "music-instrumental",
          "music-loop",
          "music-ambient",
          "sfx",
          "stems",
          "isolation",
          "merge",
        ]),
        durationSec: z.number().nonnegative().optional(),
        needsVocals: z.boolean().optional(),
        prioritizeBudget: z.boolean().optional(),
        excludeModelIds: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      const { recommendEngine } = await import(
        "../services/spiritTools/musicSpecialistTools"
      );
      return recommendEngine(input);
    }),

  buildPrompt: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        mood: z.string().optional(),
        genre: z.string().optional(),
        instruments: z.array(z.string()).optional(),
        bpm: z.number().int().positive().optional(),
        seamlessLoop: z.boolean().optional(),
        references: z.string().optional(),
        lyrics: z.string().optional(),
        durationSec: z.number().nonnegative().optional(),
      })
    )
    .query(async ({ input }) => {
      const { buildPrompt } = await import(
        "../services/spiritTools/musicSpecialistTools"
      );
      return buildPrompt(input);
    }),

  estimateCost: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        durationSec: z.number().nonnegative().optional(),
      })
    )
    .query(async ({ input }) => {
      const { estimateMusicCost } = await import(
        "../services/spiritTools/musicSpecialistTools"
      );
      return estimateMusicCost(input);
    }),

  listEngines: publicProcedure
    .input(
      z
        .object({
          capability: z
            .enum([
              "music-vocals",
              "music-instrumental",
              "music-loop",
              "music-ambient",
              "sfx",
              "stems",
              "isolation",
              "merge",
            ])
            .optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const { listEngines } = await import(
        "../services/spiritTools/musicSpecialistTools"
      );
      return listEngines(input ?? {});
    }),

  getRecentAssets: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { getRecentAudioAssets } = await import(
        "../services/spiritTools/musicSpecialistTools"
      );
      return getRecentAudioAssets(ctx.user.id, input?.limit);
    }),
});
