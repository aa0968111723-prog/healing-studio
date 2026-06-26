import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM, extractMessageText } from "../_core/llm";
import { withTimeout } from "../services/director/templates";
import {
  buildOrbGuideStepPrompt,
  parseOrbGuideStepReply,
  type OrbGuideStepContext,
} from "../../shared/agent-actions";

// ─── OrbGuide（Phase 3d-hybrid：規則 skeleton + LLM 軟化/補選項/跳題） ────
//
// OrbGuidePanel 每走到一題就呼叫 step 一次，讓 MiniMax M2.7 把開場白
// 軟化、視情境補選項、必要時建議跳題。LLM 任何異常 → 回空，前端就會
// 繼續用規則端的 stock text，不影響流程。

export const orbGuideRouter = router({
  step: protectedProcedure
    .input(
      z.object({
        intent: z.string().min(1).max(32),
        intentLabel: z.string().min(1).max(40),
        targetLabel: z.string().min(1).max(40),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        answeredSoFar: z
          .array(
            z.object({
              questionId: z.string().max(32),
              value: z.string().max(64),
              label: z.string().max(32).optional(),
            })
          )
          .max(8)
          .default([]),
        currentQuestion: z
          .object({
            id: z.string().max(32),
            stockText: z.string().max(120),
            stockOptions: z
              .array(
                z.object({
                  label: z.string().max(24),
                  value: z.string().max(64),
                  emoji: z.string().max(4),
                })
              )
              .max(8),
          })
          .optional(),
        isFinalStep: z.boolean().default(false),
        stockOrbMessage: z.string().max(160).optional(),
        stockPromptHint: z.string().max(320).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // 需求調整：光球助手優先走 Gemini API，失敗或未設定則自動降級。
      const enginePreference = "gemini" as const;

      const ctx: OrbGuideStepContext = {
        intent: input.intent,
        intentLabel: input.intentLabel,
        targetLabel: input.targetLabel,
        personality: input.personality,
        answeredSoFar: input.answeredSoFar,
        currentQuestion: input.currentQuestion,
        isFinalStep: input.isFinalStep,
        stockOrbMessage: input.stockOrbMessage,
        stockPromptHint: input.stockPromptHint,
      };

      const systemPrompt = buildOrbGuideStepPrompt(ctx);

      try {
        const result = await withTimeout(
          invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: "請只回 JSON，欄位照規格。",
              },
            ],
            preferEngine: enginePreference,
            runName: "orb-guide-step",
            maxTokens: 512,
            response_format: { type: "json_object" },
          }),
          8_000,
          "光球引導"
        );
        const raw = extractMessageText(result.choices[0]?.message?.content);
        return parseOrbGuideStepReply(raw, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[OrbGuide] step rewrite failed, falling back:", msg);
        // 回空物件 → 前端會沿用 stock
        return {};
      }
    }),
});
