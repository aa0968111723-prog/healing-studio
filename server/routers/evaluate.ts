import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { invokeLLM, extractMessageJson } from "../_core/llm";
import { withTimeout } from "../services/director/templates";
import { extractJsonObjectFromText } from "../../shared/agent-plan-adapter";

// ─── Prompt Evaluation (LLM-as-a-Judge) ──────────────────────────────────────

export const evaluateRouter = router({
  prompt: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        modality: z
          .enum(["image", "video", "audio", "voice"])
          .default("image"),
      })
    )
    .mutation(async ({ input }) => {
      const result = await withTimeout(
        invokeLLM({
          runName: "prompt-judge",
          messages: [
            {
              role: "system",
              content: `你是一位專業的 AI 提示詞評估專家（LLM-as-a-Judge）。你的任務是對使用者的創作提示詞進行多維度評估。

評估維度（每項 0-20 分，總分 0-100）：
1. **主體清晰度 (Subject Clarity)**：主角/物件描述是否具體？
2. **動作與敘事 (Action & Narrative)**：是否有明確的動態或故事性？
3. **環境與場景 (Environment)**：背景場景是否有層次感？
4. **光影與色調 (Lighting & Tone)**：是否指定了光線、色溫或情緒色調？
5. **技術參數 (Technical Specs)**：是否包含鏡頭角度、構圖、解析度等專業指令？

模態：${input.modality}

你必須回傳 JSON，包含：
- score: 總分 (0-100)
- dimensions: 五個維度的個別分數
- strengths: 提示詞的優點（繁體中文，1-2 句）
- weaknesses: 提示詞的不足之處（繁體中文，1-2 句）
- suggestions: 具體的可執行優化建議陣列，每條建議必須包含：
  - label: 建議的簡短標題（繁體中文，6-15字，例如「加入暖色調光線」）
  - actionType: 動作類型，必須是以下之一：
    - "append_prompt": 在現有提示詞後追加內容
    - "replace_prompt": 替換整個提示詞
    - "add_negative": 加入負面提示詞
  - actionPayload: 要套用的實際英文內容（例如 "warm golden hour lighting, soft shadows"）
  - reason: 為什麼這個建議能改善提示詞（繁體中文，10-25字）
- optimizedPrompt: 優化後的完整提示詞（英文）

注意：suggestions 的 actionPayload 必須是可直接套用的英文提示詞片段，不是描述性文字。`,
            },
            { role: "user", content: input.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "prompt_evaluation",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  score: {
                    type: "integer",
                    description: "Total score 0-100",
                  },
                  dimensions: {
                    type: "object",
                    properties: {
                      subjectClarity: { type: "integer" },
                      actionNarrative: { type: "integer" },
                      environment: { type: "integer" },
                      lightingTone: { type: "integer" },
                      technicalSpecs: { type: "integer" },
                    },
                    required: [
                      "subjectClarity",
                      "actionNarrative",
                      "environment",
                      "lightingTone",
                      "technicalSpecs",
                    ],
                    additionalProperties: false,
                  },
                  strengths: { type: "string" },
                  weaknesses: { type: "string" },
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: {
                          type: "string",
                          description:
                            "Short label in Traditional Chinese, 6-15 chars",
                        },
                        actionType: {
                          type: "string",
                          enum: [
                            "append_prompt",
                            "replace_prompt",
                            "add_negative",
                          ],
                          description: "Type of action to apply",
                        },
                        actionPayload: {
                          type: "string",
                          description:
                            "English prompt fragment to apply directly",
                        },
                        reason: {
                          type: "string",
                          description:
                            "Why this improves the prompt, in Traditional Chinese, 10-25 chars",
                        },
                      },
                      required: [
                        "label",
                        "actionType",
                        "actionPayload",
                        "reason",
                      ],
                      additionalProperties: false,
                    },
                  },
                  optimizedPrompt: { type: "string" },
                },
                required: [
                  "score",
                  "dimensions",
                  "strengths",
                  "weaknesses",
                  "suggestions",
                  "optimizedPrompt",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        30_000,
        "提示詞評估"
      );
      // Fence-tolerant — see safety check rationale above.
      const parsed = extractMessageJson(
        result.choices[0]?.message?.content,
        extractJsonObjectFromText
      );
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return {
        score: 50,
        dimensions: {
          subjectClarity: 10,
          actionNarrative: 10,
          environment: 10,
          lightingTone: 10,
          technicalSpecs: 10,
        },
        strengths: "",
        weaknesses: "",
        suggestions: [],
        optimizedPrompt: input.prompt,
      };
    }),

  suggestChips: protectedProcedure
    .input(
      z.object({
        partial: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ input }) => {
      const result = await withTimeout(
        invokeLLM({
          runName: "inspiration-chips",
          messages: [
            {
              role: "system",
              content: `你是一位創意靈感助手。使用者正在輸入一個初步的創作靈感，你的任務是根據這個部分輸入，生成 5 個相關但更具體、更有想像力的延展靈感詞彙。

規則：
- 每個建議必須是繁體中文
- 每個建議 4~12 個字，簡潔有畫面感
- 建議應與使用者輸入相關但往不同方向延展
- 包含場景、風格、氛圍、細節等多元角度
- 不要重複使用者已輸入的文字

你必須回傳 JSON，包含一個 chips 陣列。`,
            },
            { role: "user", content: input.partial },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "inspiration_chips",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  chips: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "3-5 creative inspiration suggestions in Traditional Chinese",
                  },
                },
                required: ["chips"],
                additionalProperties: false,
              },
            },
          },
        }),
        15_000,
        "靈感建議"
      );
      // Fence-tolerant — see safety check rationale above.
      const parsed = extractMessageJson(
        result.choices[0]?.message?.content,
        extractJsonObjectFromText
      ) as { chips?: unknown } | null;
      if (parsed && Array.isArray(parsed.chips)) {
        const chips = (parsed.chips as unknown[])
          .filter((c): c is string => typeof c === "string")
          .slice(0, 5);
        return { chips };
      }
      return { chips: [] as string[] };
    }),
});
