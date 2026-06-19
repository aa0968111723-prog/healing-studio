/**
 * Director CO-STAR dual-engine pipeline.
 *
 * Step 1: Sonar / Perplexity research grounding (with throttle fallback
 *         to user's brainConfig model).
 * Step 2: CO-STAR creative orchestration with json_schema response.
 *
 * Extracted from server/routers/director.ts so the router stays thin
 * around tRPC procedures. The function takes everything via args (no
 * closure state), so this is a literal cut.
 */

import { invokeLLM, extractMessageText } from "../../_core/llm";
import * as db from "../../db";
import { buildMemoryContext } from "../ragMemory";
import {
  buildDirectorSystemPrompt,
  GENERATION_MODALITIES_KNOWLEDGE,
  WORKFLOW_KNOWLEDGE,
} from "../siteKnowledge";
import { DIRECTOR_PERSONALITY_PROMPTS } from "./personality";
import { withTimeout, extractMessageJson } from "./templates";

export type CoStarScript = {
  context: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  visualPrompt: string;
  audioScript: string;
  musicVibe: string;
  proactiveQuestion: string;
};

const EMPTY_COSTAR_SCRIPT: CoStarScript = {
  context: "",
  situation: "",
  task: "",
  action: "",
  result: "",
  visualPrompt: "",
  audioScript: "",
  musicVibe: "",
  proactiveQuestion: "",
};

function coerceCoStar(raw: unknown): CoStarScript {
  if (!raw || typeof raw !== "object") return EMPTY_COSTAR_SCRIPT;
  const obj = raw as Record<string, unknown>;
  const pick = (k: keyof CoStarScript) =>
    typeof obj[k] === "string" ? (obj[k] as string) : "";
  return {
    context: pick("context"),
    situation: pick("situation"),
    task: pick("task"),
    action: pick("action"),
    result: pick("result"),
    visualPrompt: pick("visualPrompt"),
    audioScript: pick("audioScript"),
    musicVibe: pick("musicVibe"),
    proactiveQuestion: pick("proactiveQuestion"),
  };
}

export async function runDirectorAI(
  messages: Array<{ role: string; content: string }>,
  saveToNotes: boolean,
  userId: number,
  personality: "calm" | "creative" | "technical" = "creative",
  brainConfig?: {
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string | null;
  },
  /**
   * AIDV-152：可選的世界框架摘要。由 caller（director.chat）在旗標開啟且
   * 成功載入專案/世界觀時組好字串傳入；未傳入時行為與既往位元相同（系統
   * 提示詞不變、回應路徑不變）。
   */
  worldContext?: string
) {
  const persona =
    DIRECTOR_PERSONALITY_PROMPTS[personality] ??
    DIRECTOR_PERSONALITY_PROMPTS.creative;
  const fullDirectorPrompt = buildDirectorSystemPrompt(personality);

  // AIDV-152：世界框架脈絡段落。未傳 worldContext 時 = 空字串，下方
  // 字串模板原樣等於改動前（位元相同）。
  const worldSection =
    worldContext && worldContext.trim()
      ? `\n\n【世界框架一致性】\n${worldContext}\n請讓所有建議與上述世界框架（角色／場景／風格／時代）保持一致。`
      : "";

  // Build RAG memory context for this user (gracefully degrade if unavailable)
  let memoryContext = "";
  try {
    const lastUserMsg =
      [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (lastUserMsg) {
      memoryContext = await buildMemoryContext(userId, lastUserMsg);
    }
  } catch {
    // RAG unavailable — continue without memory
  }

  const memorySection = memoryContext
    ? `\n\n【用戶歷史偏好記憶】\n${memoryContext}\n請參考用戶的歷史偏好來調整建議。`
    : "";

  // Step 1: Factual grounding with personality-aware research style + full platform knowledge
  //
  // 「靈感 / 時事 / 社群偏好」深度整合：研究階段優先用 Perplexity Sonar
  // Reasoning Pro（內建 web grounding）。Sonar 會自動拉取最新趨勢、社群
  // 喜好、流行視覺風格、近期熱門模型等即時情報，再交給 Step 2 的創作
  // 階段去編排成 CO-STAR 腳本。Sonar 不可用時自動降回原本的 brainConfig。
  //
  // 為什麼用 Sonar 而非 brainConfig：
  //   - brainConfig 通常是 Claude / Gemini，知識截止日期固定，無法回答
  //     「現在抖音流行什麼濾鏡」「2026 年 4 月哪些 AI 圖像模型最熱」這類
  //     即時問題
  //   - Sonar 的 search_results / citations 直接附帶可點擊來源，創作者
  //     可以追溯「為什麼導演 AI 提這個風格」
  //
  // Throttle / Feature flag：透過 perplexityThrottle 統一管控（env:
  // ENABLE_PERPLEXITY、ENABLE_PERPLEXITY_DIRECTOR_RESEARCH、per-user 與全站
  // rate limits）。被節流時自動降回 brainConfig，導演 AI 仍可運作。
  const { checkAndConsumePerplexity } = await import(
    "../perplexityThrottle"
  );
  const apiKeyAvailable = Boolean(
    process.env.PERPLEXITY_API_KEY?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim()
  );
  const throttleCheck = apiKeyAvailable
    ? checkAndConsumePerplexity({
        feature: "director_research",
        userId,
      })
    : { allowed: false as const };
  const sonarAvailable = apiKeyAvailable && throttleCheck.allowed;
  const researchModel = sonarAvailable
    ? "perplexity/sonar-pro"
    : brainConfig?.model;
  const researchResult = await withTimeout(
    invokeLLM({
      runName: "director-research",
      model: researchModel,
      // Sonar 推理本身已有溫度控制，這裡用較低溫度確保事實穩定。若 fallback
      // 到 brainConfig 仍套用 brain 設定。
      temperature: sonarAvailable ? 0.2 : brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${persona.researchStyle}

你深入了解 Healing Studio 平台所有生成模型和工具：
${GENERATION_MODALITIES_KNOWLEDGE}
${WORKFLOW_KNOWLEDGE}
${memorySection}${worldSection}

【即時靈感調查任務】
回答時若涉及：
  - 流行視覺風格 / 攝影風格 / 色彩趨勢 / 字體風格
  - 當前社群（IG / TikTok / Threads / 抖音 / Pinterest / X）熱門題材
  - 近期 AI 模型發表（Flux、Sora、Nano Banana、ElevenLabs 等更新）
  - 文化時事 / 節慶 / 新聞 / 季節性題材
請直接引用真實的網路來源（你已具備 web search 能力），讓創作有當下感。
回覆中以「來源：[標題](URL)」附上引用，方便 Step 2 創作階段沿用。`,
        },
        ...messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    }),
    // gemini-2.5-pro with thinking on a "plan a 30s video" prompt routinely
    // takes 25-45s. The previous 30s ceiling caused frequent
    // "導演AI研究 回應超時" 500s in production. Bump to 90s; the underlying
    // `invokeLLM` already enforces the env-driven LLM_TIMEOUT_SECONDS
    // (default 60) and a thinking-budget-aware AbortSignal, so this wrapper
    // is the per-stage failsafe rather than the primary timeout.
    90_000,
    "導演AI研究"
  );
  const researchContent = extractMessageText(
    researchResult.choices[0]?.message?.content
  );

  // Step 2: Creative orchestration with CO-STAR framework + full director knowledge
  const scriptResult = await withTimeout(
    invokeLLM({
      runName: "director-costar-generate",
      model: brainConfig?.model,
      temperature: brainConfig?.temperature,
      topP: brainConfig?.topP,
      systemPrompt: brainConfig?.systemPrompt,
      messages: [
        {
          role: "system",
          content: `${fullDirectorPrompt}${worldSection}

基於以下研究資料，創作一個結構化的 JSON 腳本：
${researchContent}
${persona.proactiveHint}

輸出 JSON 格式必須包含：
- context, situation, task, action, result（CO-STAR 各欄位）
- visualPrompt：視覺提示詞（英文，包含推薦模型名稱和正面解剖學約束）
- audioScript：語音腳本（繁體中文，標明推薦的 TTS 模型）
- musicVibe：音樂風格描述（英文，標明推薦的音樂模型）
- proactiveQuestion：主動向使用者提出的引導性問題（繁體中文，根據使用者描述中缺少的元素提問）`,
        },
        ...messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "costar_script",
          strict: true,
          schema: {
            type: "object",
            properties: {
              context: { type: "string" },
              situation: { type: "string" },
              task: { type: "string" },
              action: { type: "string" },
              result: { type: "string" },
              visualPrompt: { type: "string" },
              audioScript: { type: "string" },
              musicVibe: { type: "string" },
              proactiveQuestion: { type: "string" },
            },
            required: [
              "context",
              "situation",
              "task",
              "action",
              "result",
              "visualPrompt",
              "audioScript",
              "musicVibe",
              "proactiveQuestion",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
    45_000,
    "導演AI創作"
  );

  // content 可能是 string 或 Array<TextContent | ...>。先抽出純文字再走
  // extractJsonObjectFromText，避免 array 形式被誤當成 parsed JSON object
  // 而導致 CO-STAR 欄位全部變空。
  const parsedScript = extractMessageJson(
    scriptResult.choices[0]?.message?.content
  );
  // Gemini's json_object mode occasionally wraps the payload in ```json
  // fences or prepends a one-line preamble; extractJsonObjectFromText falls
  // back to fenced/embedded extraction so the user still sees a populated
  // CO-STAR card instead of an empty one. We then coerce the loosely-typed
  // result back to the strict CO-STAR shape so the tRPC inferred return
  // type stays the same as before this hardening.
  const coerced: CoStarScript = coerceCoStar(parsedScript);
  // 若解析失敗，coerceCoStar(null) 會回傳全空的 EMPTY_COSTAR_SCRIPT。此時不要把空腳本
  // 當成有效結果送給前端，否則 chat onSuccess 會渲染一張完全空白的
  // 「CO-STAR 腳本已生成」表格給使用者看。
  const isAllEmpty =
    !coerced.context &&
    !coerced.situation &&
    !coerced.task &&
    !coerced.action &&
    !coerced.result &&
    !coerced.visualPrompt &&
    !coerced.audioScript &&
    !coerced.musicVibe &&
    !coerced.proactiveQuestion;
  const script: CoStarScript | null = isAllEmpty ? null : coerced;

  // Save to project notes if requested
  if (saveToNotes && userId && script) {
    await db.createProjectNote({
      userId,
      title: `導演 AI 腳本 (${personality}) - ${new Date().toLocaleDateString("zh-TW")}`,
      content: researchContent,
      scriptJson: script,
      noteType: "script",
    });
  }

  return { research: researchContent, script, personality };
}
