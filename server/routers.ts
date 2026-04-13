import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, brainProcedure, router } from "./_core/trpc";
import { isDemoMode } from "./_core/googleAuth";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
// imageGeneration.ts no longer used directly — all 4 modalities go through falDispatcher
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { generationBus } from "./generationEvents";
import { newsRouter } from "./routers/news";
import { showcaseRouter } from "./routers/showcase";
import { senseRouter } from "./routers/sense";
import { brainRouter } from "./routers/brain";
import { proStudioRouter } from "./routers/proStudio";
import { imageStudioRouter } from "./routers/imageStudio";
import { videoStudioRouter } from "./routers/videoStudio";
import { learnHubRouter } from "./routers/learnHub";
import { loraTrainerRouter } from "./routers/loraTrainer";
import { getOrchestrator } from "./services/modelClients";
// voiceCompiler, audioCompiler, videoCompiler are no longer used — all modalities route through falDispatcher
import { buildMemoryContext, upsertMemory } from "./services/ragMemory";
import {
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
} from "./services/modelPricing";
import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  resolveFalEnginesFromRow,
  DEFAULT_FAL_ENGINES,
  estimateGenerationPoints,
} from "./services/falDispatcher";
import { eq } from "drizzle-orm";
import { userAiBrain } from "../drizzle/schema";
import { getDb } from "./db";

// ─── Dev-only debug logger (no-ops in production) ─────────────────────────
const isDev = process.env.NODE_ENV !== "production";
const debug = isDev ? console.log : () => {};  // eslint-disable-line no-console

// ─── Timeout Utility ────────────────────────────────────────────────────────

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within
 * the specified duration, it rejects with a descriptive timeout error.
 * This ensures external API calls (LLM, image gen, etc.) don't hang forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "API"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`));
    }, ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// ─── Safety Moderation Middleware ────────────────────────────────────────────

async function checkSafety(text: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    const result = await withTimeout(invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一個內容安全審核助手。請判斷以下內容是否安全、適當。
如果內容包含 NSFW、暴力、仇恨言論或其他不當內容，回覆 JSON: {"safe": false, "reason": "原因"}
如果內容安全，回覆 JSON: {"safe": true}
只回覆 JSON，不要其他文字。`,
        },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "safety_check",
          strict: true,
          schema: {
            type: "object",
            properties: {
              safe: { type: "boolean" },
              reason: { type: "string", description: "Reason if not safe" },
            },
            required: ["safe", "reason"],
            additionalProperties: false,
          },
        },
      },
    }), 15_000, "安全檢查");
    const content = result.choices[0]?.message?.content;
    if (typeof content === "string") {
      return JSON.parse(content);
    }
    return { safe: true };
  } catch {
    // On timeout or error, default to safe to avoid blocking user
    return { safe: true };
  }
}

// ─── Elite Prompt Compiler ───────────────────────────────────────────────────

async function compileElitePrompt(payload: {
  prompt: string;
  vibeCardIds: string[];
  temperature: number;
  generationType: string;
  referenceImages?: { styleUrl?: string | null; vibeUrl?: string | null; characterUrl?: string | null };
  memoryContext?: string; // Phase 14 RAG 記憶注入
  // ── AI 大腦組態注入（來自 ctx.brain）────────────────────
  brainModel?: string;       // storyteller/director model override
  brainTemperature?: number; // storyteller.temperature
  brainTopP?: number;        // storyteller.topP
}): Promise<{ compiledPrompt: string; visualWeight: number; controlNetParams: Record<string, unknown> }> {
  const vibeDescriptions = payload.vibeCardIds.join(", ");

  // ── Visual Weight Calculation ──
  // When reference images are provided, calculate a visual weight factor
  // that adjusts how strongly the reference influences the generation
  const refImages = payload.referenceImages || {};
  const hasStyleRef = !!refImages.styleUrl;
  const hasVibeRef = !!refImages.vibeUrl;
  const hasCharRef = !!refImages.characterUrl;
  const refCount = [hasStyleRef, hasVibeRef, hasCharRef].filter(Boolean).length;

  // Visual weight: 0.0 (no refs) to 1.0 (all refs provided)
  // Each reference type contributes differently:
  //   style: 0.4, vibe: 0.3, character: 0.3
  const visualWeight = (hasStyleRef ? 0.4 : 0) + (hasVibeRef ? 0.3 : 0) + (hasCharRef ? 0.3 : 0);

  // ControlNet-compatible parameters for downstream model integration
  const controlNetParams: Record<string, unknown> = {
    enabled: refCount > 0,
    styleWeight: hasStyleRef ? 0.65 : 0,
    vibeWeight: hasVibeRef ? 0.5 : 0,
    characterWeight: hasCharRef ? 0.75 : 0,
    totalVisualWeight: visualWeight,
    referenceMode: refCount === 0 ? "none" : refCount === 1 ? "single" : "multi",
  };

  // Build reference context for the LLM
  const refContext = refCount > 0
    ? `\n\n參考圖片資訊：\n- 風格參考：${hasStyleRef ? "已提供（權重 0.65）" : "無"}\n- 氛圍參考：${hasVibeRef ? "已提供（權重 0.5）" : "無"}\n- 角色參考：${hasCharRef ? "已提供（權重 0.75）" : "無"}\n- 綜合視覺權重：${visualWeight.toFixed(2)}\n請在提示詞中加入 "maintaining visual consistency with reference" 等指令。`
    : "";

  const memorySection = payload.memoryContext || "";
  // Effective temperature: prefer brain-injected value, fallback to input.temperature
  const effectiveTemperature = payload.brainTemperature ?? payload.temperature;
  try {
    const result = await withTimeout(invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位精英級 AI 提示詞編譯器。你的任務是將使用者的簡短描述擴展為一段優化的、敘事性的提示詞。

規則：
1. 必須使用正面解剖學約束（例如：「完美對稱的解剖結構、無瑕的比例」），絕對不使用負面提示
2. 融入氛圍描述：${vibeDescriptions}
3. 創意溫度：${effectiveTemperature}（0=保守精確，1=大膽創新）
4. 生成類型：${payload.generationType}
5. 輸出必須是一段流暢的英文敘事提示詞
6. 加入光線、構圖、色調等專業攝影/藝術指導
7. 確保人物描述包含：perfectly symmetrical anatomy, flawless proportions, natural pose${refContext}${memorySection}`,
        },
        { role: "user", content: payload.prompt },
      ],
      // Inject brain model & parameters when available
      ...(payload.brainModel ? { model: payload.brainModel } : {}),
      ...(payload.brainTemperature !== undefined ? { temperature: payload.brainTemperature } : {}),
      ...(payload.brainTopP !== undefined ? { topP: payload.brainTopP } : {}),
    }), 30_000, "提示詞編譯");
    const content = result.choices[0]?.message?.content;
    const compiledPrompt = typeof content === "string" ? content : payload.prompt;
    return { compiledPrompt, visualWeight, controlNetParams };
  } catch {
    // LLM unavailable (e.g., no GEMINI_API_KEY in demo mode) — gracefully fall back to original prompt
    return { compiledPrompt: payload.prompt, visualWeight, controlNetParams };
  }
}

// ─── CO-STAR Director AI ─────────────────────────────────────────────────────

// ─── Personality System Prompts ──────────────────────────────────────────────

const PERSONALITY_PROMPTS: Record<string, { researchStyle: string; directorStyle: string; proactiveHint: string }> = {
  calm: {
    researchStyle: `你是一位沉穩而深思熟慮的研究助手。你重視邏輯、結構與可行性。
風格特點：
- 先分析可行性，再提供建議
- 用「我建議我們先...」「從結構上來看...」等引導式語氣
- 提供完整的利弊分析
- 使用繁體中文，語氣平穩而專業`,
    directorStyle: `你是「導演 AI」，一位沉穩型創意導演。你重視邏輯性與敘事結構。
風格：
- 先確認使用者的核心意圖，再展開創作
- 強調敘事的完整性與情緒弧線
- 用「我們可以這樣思考...」的引導方式
- 腳本結構嚴謹，每個元素都有明確目的`,
    proactiveHint: `

【主動介入規則】
當使用者的描述不夠具體時，你必須主動提問：
- 「您的目標觀眾是誰？這會影響我們的敘事節奏。」
- 「您希望傳達的核心情緒是什麼？平靜、振奮、或是思考？」
- 「從結構上看，我建議我們先確定 X，再處理 Y。」`,
  },
  creative: {
    researchStyle: `你是一位充滿靈感的創意研究助手。你重視氛圍、情緒與視覺衝擊力。
風格特點：
- 用豐富的意象和比喻來描述靈感
- 主動提供意想不到的角度和組合
- 用「想像一下...」「如果我們讓...」等啓發式語氣
- 使用繁體中文，語氣熱情而富有感染力`,
    directorStyle: `你是「導演 AI」，一位創意型藝術導演。你重視氛圍、情緒和視覺衝擊力。
風格：
- 用感性的語言描繪畫面，讓使用者「看見」最終成果
- 大膽提出意想不到的創意組合
- 用「想像一下這個畫面...」「如果我們加入...」
- 腳本充滿藝術性，強調視覺美感與情緒渡染`,
    proactiveHint: `

【主動介入規則】
當使用者的描述缺乏情緒或氛圍時，你必須主動引導：
- 「想像一下，如果我們加入 X 的元素，整個畫面會變得更有張力。」
- 「我覺得這裡缺少一個情緒高潮點——你希望觀眾在哪個瞬間屏住呼吸？」
- 「讓我用一個比喻來幫你金化這個構想...」`,
  },
  technical: {
    researchStyle: `你是一位技術導向的研究助手。你重視參數精確度、技術可行性與最佳實踐。
風格特點：
- 提供具體的技術參數建議（解析度、幀率、編碼格式）
- 分析不同模型/工具的技術限制
- 用「建議使用 X 參數，因為...」等專業語氣
- 使用繁體中文，語氣精確而專業`,
    directorStyle: `你是「導演 AI」，一位技術型導演。你重視參數精確度與技術最佳實踐。
風格：
- 為每個創作決策提供技術理由
- 具體建議解析度、幀率、編碼格式、模型參數
- 用「技術上建議...」「根據模型特性...」等語氣
- 腳本包含具體的技術參數與模型配置建議`,
    proactiveHint: `

【主動介入規則】
當使用者缺少技術參數時，你必須主動提問：
- 「您希望的輸出解析度是多少？1080p 還是 4K？這會影響我們的模型選擇。」
- 「目前缺少鏡頭運動參數——建議加入 dolly zoom 或 tracking shot 來增強動態感。」
- 「技術上，您的描述適合使用 ControlNet depth + canny 雙層控制，要我幫您配置嗎？」`,
  },
};

async function runDirectorAI(
  messages: Array<{ role: string; content: string }>,
  saveToNotes: boolean,
  userId: number,
  personality: "calm" | "creative" | "technical" = "creative",
) {
  const persona = PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.creative;

  // Step 1: Use LLM for factual grounding with personality-aware research style
  const researchResult = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: persona.researchStyle,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  }), 30_000, "導演AI研究");
  const researchContent = typeof researchResult.choices[0]?.message?.content === "string"
    ? researchResult.choices[0].message.content : "";

  // Step 2: Creative orchestration with personality-aware CO-STAR framework
  const scriptResult = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `${persona.directorStyle}

使用 CO-STAR 框架來創作結構化的多媒體腳本。

CO-STAR 框架：
- Context（背景）：場景的背景設定
- Situation（情境）：當前的情境描述
- Task（任務）：需要完成的創作任務
- Action（行動）：具體的執行步驟
- Result（結果）：預期的成果

基於以下研究資料，創作一個結構化的 JSON 腳本：
${researchContent}
${persona.proactiveHint}

輸出 JSON 格式必須包含：
- context, situation, task, action, result（CO-STAR 各欄位）
- visualPrompt：給 Veo 3.1 的視覺提示詞（英文，包含正面解剖學約束）
- audioScript：給 ElevenLabs 的語音腳本（繁體中文）
- musicVibe：給 Suno V5 的音樂風格描述（英文）
- proactiveQuestion：主動向使用者提出的引導性問題（繁體中文，根據使用者描述中缺少的元素提問）`,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
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
          required: ["context", "situation", "task", "action", "result", "visualPrompt", "audioScript", "musicVibe", "proactiveQuestion"],
          additionalProperties: false,
        },
      },
    },
  }), 45_000, "導演AI創作");

  const scriptContent = scriptResult.choices[0]?.message?.content;
  let script;
  try {
    script = typeof scriptContent === "string" ? JSON.parse(scriptContent) : scriptContent;
  } catch {
    script = { context: "", situation: "", task: "", action: "", result: "", visualPrompt: "", audioScript: "", musicVibe: "", proactiveQuestion: "" };
  }

  // Save to project notes if requested
  if (saveToNotes && userId) {
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

// ─── Router Definition ───────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  // ─── Homepage Public APIs (Read-only, LOD Pagination) ──────────────────
  news: newsRouter,
  showcase: showcaseRouter,
  sense: senseRouter,
  brain: brainRouter,
  proStudio: proStudioRouter,
  imageStudio: imageStudioRouter,
  videoStudio: videoStudioRouter,
  learnHub: learnHubRouter,
  loraTrainer: loraTrainerRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Generation ──────────────────────────────────────────────────────────

  generate: router({
    /**
     * Pre-flight: load brain config → estimate points → deduct → create job
     *
     * 點數計費規則（1 USD ≈ 100 pts）：
     *  - 讀取使用者 AI 大腦組態，取得各模態選定的引擎
     *  - 依 MODEL_PRICING_CATALOG 精確估算本次任務點數
     *  - SELECT FOR UPDATE 原子扣點，不足則拒絕並顯示友善錯誤
     *  - 傳回 jobId、引擎名稱、點數明細供前端顯示
     */
    prepareJob: protectedProcedure
      .input(z.object({
        generationType: z.enum(["image", "video", "audio", "voice", "multimodal"]),
        durationSec: z.number().optional(),
        charCount: z.number().optional(),
        overrideEngine: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const demoMode = isDemoMode();

        // ── Step 1: 讀取使用者大腦組態 ──
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch { /* fallback to defaults */ }

        const falEngines = resolveFalEnginesFromRow(brainRow);

        // ── Step 2: 選定本次任務的引擎 ──
        const modalityEngineMap: Record<string, string> = {
          image:      input.overrideEngine ?? String(brainRow?.imageEngine ?? falEngines.textToImage),
          video:      input.overrideEngine ?? String(brainRow?.videoEngine ?? falEngines.textToVideo),
          audio:      input.overrideEngine ?? String(brainRow?.audioEngine ?? falEngines.textToAudio),
          voice:      input.overrideEngine ?? String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
          multimodal: input.overrideEngine ?? String(brainRow?.imageEngine ?? falEngines.textToImage),
        };
        const selectedEngine = modalityEngineMap[input.generationType] ?? "gemini/imagen-3";

        // ── Step 3: 按模型成本估算點數 ──
        const estimate = estimatePoints(selectedEngine, {
          durationSec: input.durationSec,
          charCount: input.charCount,
        });
        const pointsCost = estimate.totalPoints; // 最少 1 pt

        // ── Step 4: 原子扣點（Demo 模式跳過） ──
        let deduction = { success: true, remainingBefore: 999, remainingAfter: 999 };
        if (!demoMode) {
          deduction = await db.deductUserPoints(userId, pointsCost);
          if (!deduction.success) {
            const remaining = deduction.remainingBefore;
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `積分不足（需要 ${pointsCost} pts，剩餘 ${remaining} pts）。請至設定頁面查看積分或聯繫管理員。`,
            });
          }
        }

        // ── Step 5: 建立背景任務（Demo 模式使用假 jobId） ──
        let jobId: number;
        if (demoMode) {
          jobId = Date.now() % 2147483647; // 用時間戳作為 demo jobId
        } else {
          jobId = await db.createBackgroundJob({
            userId,
            jobType: input.generationType === "multimodal" ? "multimodal" : input.generationType,
            status: "processing",
            progress: 2,
            progressMessage: "準備中...",
          });
        }

        // ── Step 6: 推送初始思維鏈節點（含積分明細） ──
        const modalityLabel = input.generationType === "image" ? "圖像" : input.generationType === "video" ? "影片" : input.generationType === "audio" ? "音樂" : "語音";
        const pricing = getModelPricing(selectedEngine);
        const engineLabel = pricing?.label ?? selectedEngine;

        generationBus.emit(jobId, { type: "thought-update", node: { id: "safety", label: "安全檢查", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "compile", label: "提示詞編譯", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "weight", label: "視覺權重計算", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成（${engineLabel}）`, status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: {
          id: "quota",
          label: "積分扣除",
          status: "completed",
          detail: `扣除 ${pointsCost} pts ｜ ${estimate.breakdown} ｜ 引擎：${engineLabel} ｜ 剩餘：${deduction.remainingAfter} pts`,
          timestamp: Date.now(),
        }});
        generationBus.emit(jobId, { type: "thought-update", node: { id: "history", label: "歷史紀錄", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "progress", progress: 2, message: `任務已建立 ｜ ${engineLabel} ｜ ${pointsCost} pts` });

        return {
          jobId,
          selectedEngine,
          engineLabel,
          pointsCost,
          pointsBreakdown: estimate.breakdown,
          remainingPoints: deduction.remainingAfter,
        };
      }),

    /**
     * 查詢本次生成的點數預估（不扣點，供前端顯示費用預覽）
     */
    estimateCost: protectedProcedure
      .input(z.object({
        generationType: z.enum(["image", "video", "audio", "voice"]),
        durationSec: z.number().optional(),
        charCount: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch { /* fallback */ }

        const falEngines = resolveFalEnginesFromRow(brainRow);
        const modalityEngineMap: Record<string, string> = {
          image: String(brainRow?.imageEngine ?? falEngines.textToImage),
          video: String(brainRow?.videoEngine ?? falEngines.textToVideo),
          audio: String(brainRow?.audioEngine ?? falEngines.textToAudio),
          voice: String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
        };
        const engineId = modalityEngineMap[input.generationType];
        const estimate = estimatePoints(engineId, {
          durationSec: input.durationSec,
          charCount: input.charCount,
        });
        const pricingInfo = getModelPricing(engineId);
        const availability = checkModelAvailability(engineId);

        return {
          generationType: input.generationType,
          engineId,
          engineLabel: pricingInfo?.label ?? engineId,
          provider: pricingInfo?.provider ?? "unknown",
          tier: pricingInfo?.tier ?? "standard",
          pointsCost: estimate.totalPoints,
          pointsBreakdown: estimate.breakdown,
          unit: pricingInfo?.unit ?? "每次",
          available: availability.available,
          availabilityNote: !availability.available ? availability.reason : undefined,
        };
      }),

    multimodal: brainProcedure
      .input(z.object({
        jobId: z.number(), // from prepareJob
        prompt: z.string().min(1),
        generationType: z.enum(["image", "video", "audio", "voice", "multimodal"]),
        mode: z.enum(["lightning", "deep_precision"]),
        vibeCardIds: z.array(z.string()),
        temperature: z.number().min(0).max(1),
        seed: z.number().optional(),
        // Image workspace params
        aspectRatio: z.string().optional(),
        negativePrompt: z.string().optional(),
        styleReferenceUrl: z.string().nullable().optional(),
        vibeReferenceUrl: z.string().nullable().optional(),
        // Video workspace params
        videoDurationSeconds: z.number().optional(),
        firstFrameUrl: z.string().nullable().optional(),
        lastFrameUrl: z.string().nullable().optional(),
        characterRefUrl: z.string().nullable().optional(),
        cameraMotion: z.object({
          pan: z.number(),
          zoom: z.number(),
          tilt: z.number(),
        }).optional(),
        // Audio workspace params
        musicStyle: z.string().optional(),
        isInstrumental: z.boolean().optional(),
        lyrics: z.string().optional(),
        audioDuration: z.number().optional(),
        audioEnergy: z.number().optional(),
        // Voice workspace params
        voiceModelId: z.string().optional(),
        voiceText: z.string().optional(),
        voiceSpeed: z.number().optional(),
        voiceStability: z.number().optional(),
        voiceEmotionType: z.string().optional(),
        voiceEmotionIntensity: z.number().optional(),
        // Vault & Model injection params
        vaultCharacterId: z.number().optional(),
        vaultSceneId: z.number().optional(),
        fineTunedModelId: z.number().optional(),
        // LoRA weight for reference-guided generation
        loraWeight: z.number().min(0).max(1).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const jobId = input.jobId;
        const demoMode = isDemoMode();
        const stepTimestamps: Record<string, number> = { start: Date.now() };
        const modalityLabel = input.generationType === "image" ? "圖像" : input.generationType === "video" ? "影片" : input.generationType === "audio" ? "音樂" : "語音";

        // ── Load brain config to get selected engines for this generation ──
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch { /* use defaults */ }
        const falEngines = resolveFalEnginesFromRow(brainRow);

        // Resolve which engine was selected for this modality (from brain config)
        const _resolvedImageEngine  = String(brainRow?.imageEngine  ?? falEngines.textToImage);
        const _resolvedVideoEngine  = String(brainRow?.videoEngine  ?? falEngines.textToVideo);
        const _resolvedAudioEngine  = String(brainRow?.audioEngine  ?? falEngines.textToAudio);
        const _resolvedVoiceEngine  = String(brainRow?.voiceEngine  ?? falEngines.textToSpeech);
        const _falTextToImageEngine = falEngines.textToImage;
        const _falTextToVideoEngine = falEngines.textToVideo;
        const _falTextToAudioEngine = falEngines.textToAudio;
        const _falTextToSpeechEngine = falEngines.textToSpeech;

        // Estimate real cost for this generation (for api usage log)
        const _genModelId = input.generationType === "video" ? _resolvedVideoEngine
          : input.generationType === "audio" ? _resolvedAudioEngine
          : input.generationType === "voice" ? _resolvedVoiceEngine
          : _resolvedImageEngine;
        const _genEstimate = estimatePoints(_genModelId, {
          durationSec: input.videoDurationSeconds ?? (input.generationType === "audio" ? (input as any).audioDuration : undefined),
          charCount: input.voiceText?.length,
        });
        const _genPricing = getModelPricing(_genModelId);
        const _genEngineLabel = _genPricing?.label ?? _genModelId;

        // Safety pre-check (points already deducted in prepareJob)
        generationBus.emit(jobId, { type: "thought-update", node: { id: "safety", label: "安全檢查", status: "processing", detail: "正在驗證內容安全...", timestamp: Date.now() } });
        generationBus.emit(jobId, { type: "progress", progress: 5, message: "安全檢查中..." });

        const safetyResult = await checkSafety(input.prompt);
        stepTimestamps.safetyDone = Date.now();
        const safetyMs = stepTimestamps.safetyDone - stepTimestamps.start;
        generationBus.emit(jobId, { type: "thought-update", node: { id: "safety", label: "安全檢查", status: "passed", detail: `內容安全檢查通過（${safetyMs}ms）`, timestamp: stepTimestamps.safetyDone } });
        generationBus.emit(jobId, { type: "progress", progress: 10, message: "安全檢查通過" });
        if (!safetyResult.safe) {
          // Emit error via SSE before throwing
          generationBus.emit(jobId, { type: "thought-update", node: { id: "safety", label: "安全檢查", status: "error", detail: safetyResult.reason || "內容不符合安全規範", timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "error", message: safetyResult.reason || "內容不符合安全規範" });
          setTimeout(() => generationBus.cleanup(jobId), 2000);
          // Refund the points since no generation occurred
          if (!demoMode) {
            await db.refundUserPoints(userId, _genEstimate.totalPoints);
            await db.createApiUsageLog({
              userId,
              requestType: "safety_check",
              apiProvider: "gemini_flash",
              responseStatus: "blocked",
              errorMessage: safetyResult.reason || "內容不符合安全規範",
              generationsDeducted: 0,
            });
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `小兔子提醒你：${safetyResult.reason || "這個內容可能不太適合哦，請試試其他描述吧！"}`,
          });
        }

        // ── Vault injection: resolve vault items to image URLs ──
        if (input.vaultCharacterId) {
          try {
            const vaultChar = await db.getVaultItem(input.vaultCharacterId);
            if (vaultChar && vaultChar.imageUrl) {
              debug(`[Vault] Injecting character ref from vault #${vaultChar.id}: ${vaultChar.name}`);
              // For video: override characterRefUrl; for image: override styleReferenceUrl
              if (input.generationType === "video") {
                input.characterRefUrl = input.characterRefUrl || vaultChar.imageUrl;
                input.firstFrameUrl = input.firstFrameUrl || vaultChar.imageUrl;
              } else {
                input.styleReferenceUrl = input.styleReferenceUrl || vaultChar.imageUrl;
              }
            }
          } catch (e) {
            console.warn("[Vault] Failed to load character vault item:", e);
          }
        }
        if (input.vaultSceneId) {
          try {
            const vaultScene = await db.getVaultItem(input.vaultSceneId);
            if (vaultScene && vaultScene.imageUrl) {
              debug(`[Vault] Injecting scene ref from vault #${vaultScene.id}: ${vaultScene.name}`);
              input.vibeReferenceUrl = input.vibeReferenceUrl || vaultScene.imageUrl;
            }
          } catch (e) {
            console.warn("[Vault] Failed to load scene vault item:", e);
          }
        }

        // ── Fine-tuned model injection: append triggerWord + inject LoRA URL ──
        let modelTriggerWord = "";
        let fineTunedLoraUrl: string | undefined;
        if (input.fineTunedModelId) {
          try {
            const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
            if (ftModel) {
              debug(`[Model] Injecting fine-tuned model #${ftModel.id}: ${ftModel.name} (status=${ftModel.status})`);
              if (ftModel.status !== "ready") {
                throw new TRPCError({ code: "BAD_REQUEST", message: `模型「${ftModel.name}」尚未訓練完成（狀態：${ftModel.status}），請等待訓練完畢再使用` });
              }
              const config = ftModel.configJson as Record<string, unknown> | null;
              if (config && typeof config.triggerWord === "string" && config.triggerWord.trim()) {
                modelTriggerWord = config.triggerWord.trim();
                // Prepend trigger word so it appears prominently in compiled prompt
                input.prompt = `${modelTriggerWord}, ${input.prompt}`;
                debug(`[Model] Prepended triggerWord "${modelTriggerWord}" to prompt`);
              }
              // Extract the trained LoRA weights URL (used for fal.ai sdLora endpoint)
              if (ftModel.trainedLoraUrl) {
                fineTunedLoraUrl = ftModel.trainedLoraUrl;
                debug(`[Model] Will inject LoRA weights URL: ${fineTunedLoraUrl}`);
              } else if (ftModel.fileUrl && (ftModel.fileUrl.endsWith(".safetensors") || ftModel.fileUrl.endsWith(".tar") || ftModel.fileUrl.includes("replicate"))) {
                fineTunedLoraUrl = ftModel.fileUrl;
                debug(`[Model] Will inject LoRA fileUrl as weights: ${fineTunedLoraUrl}`);
              }
              // Increment usage count asynchronously
              db.incrementModelUsage(ftModel.id).catch(() => {});
            }
          } catch (e) {
            if (e instanceof TRPCError) throw e;
            console.warn("[Model] Failed to load fine-tuned model:", e);
          }
        }

        try {
          // ── Phase 14: RAG 記憶檢索（非阻塞，失敗不影響生成）────────────
          let memoryContext = "";
          try {
            memoryContext = await Promise.race([
              buildMemoryContext(userId, input.prompt),
              new Promise<string>((resolve) => setTimeout(() => resolve(""), 3000)), // 3s 超時
            ]);
          } catch {
            // RAG 失敗靜默降級
          }

          // Compile elite prompt with reference image awareness
          // ── Compile step ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "compile", label: "提示詞編譯", status: "processing", detail: "正在編譯提示詞...", timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "progress", progress: 15, message: "編譯提示詞中..." });
          stepTimestamps.compileStart = Date.now();
          // ── Read AI Brain storyteller config for prompt compilation ──
          const storytellerBrain = ctx.brain?.getBrain?.("storyteller");
          const { compiledPrompt, visualWeight, controlNetParams } = await withTimeout(
            compileElitePrompt({
              prompt: input.prompt,
              vibeCardIds: input.vibeCardIds,
              temperature: input.temperature,
              generationType: input.generationType,
              referenceImages: {
                styleUrl: input.styleReferenceUrl,
                vibeUrl: input.vibeReferenceUrl,
                characterUrl: input.characterRefUrl,
              },
              memoryContext, // Phase 14 RAG 記憶注入
              // Inject brain configuration for model & sampling parameters
              brainModel: storytellerBrain?.enabled ? storytellerBrain.model : undefined,
              brainTemperature: storytellerBrain?.enabled ? storytellerBrain.temperature : undefined,
              brainTopP: storytellerBrain?.enabled ? storytellerBrain.topP : undefined,
            }),
            30_000,
            "提示詞編譯"
          );

          stepTimestamps.compileDone = Date.now();
          stepTimestamps.weightDone = Date.now();
          const compileMs = stepTimestamps.compileDone - stepTimestamps.compileStart;
          generationBus.emit(jobId, { type: "thought-update", node: { id: "compile", label: "提示詞編譯", status: "completed", detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${compileMs}ms）`, timestamp: stepTimestamps.compileDone, tokens: compiledPrompt.length } });
          generationBus.emit(jobId, { type: "thought-update", node: { id: "weight", label: "視覺權重計算", status: "completed", detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`, timestamp: stepTimestamps.weightDone, confidence: visualWeight } });
          generationBus.emit(jobId, { type: "progress", progress: 30, message: "提示詞編譯完成" });
          if (!demoMode) await db.updateBackgroundJob(jobId, { progress: 30, progressMessage: "正在生成中..." });

          // ── Generate step ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成`, status: "processing", detail: `正在生成${modalityLabel}...`, timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "progress", progress: 40, message: `${modalityLabel}生成中...` });

          // ── Demo mode sample assets (used as fallback when real API fails) ──
          const DEMO_SAMPLE_ASSETS = {
            image: [
              "https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=1024&q=80",
              "https://images.unsplash.com/photo-1686002359940-6a51b0d64f68?w=1024&q=80",
              "https://images.unsplash.com/photo-1700669113058-f9c9c2e862b0?w=1024&q=80",
              "https://images.unsplash.com/photo-1704458590483-6d9db5f6e5b3?w=1024&q=80",
            ],
            video: [
              "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
              "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
              "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
            ],
            audio: [
              "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
              "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
            ],
            voice: [
              "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
            ],
          };
          const getDemoAsset = (type: "image" | "video" | "audio" | "voice") => {
            const arr = DEMO_SAMPLE_ASSETS[type];
            return arr[Math.floor(Math.random() * arr.length)];
          };

          // Generate based on type
          let resultUrl: string | undefined;
          let resultData: Record<string, unknown> = {
            visualWeight,
            controlNetParams,
            ...(input.fineTunedModelId && { modelUsed: { id: input.fineTunedModelId, triggerWord: modelTriggerWord } }),
            ...(input.vaultCharacterId && { vaultCharacterId: input.vaultCharacterId }),
            ...(input.vaultSceneId && { vaultSceneId: input.vaultSceneId }),
          };

          if (input.generationType === "image" || input.generationType === "multimodal") {
            // ── Image: fal.ai Flux Pro (真實 API，無 Forge 依賴) ──
            generationBus.emit(jobId, { type: "progress", progress: 42, message: "正在呼叫 fal.ai Flux 生成圖片..." });
            const refImageUrl = input.styleReferenceUrl || input.vibeReferenceUrl || undefined;
            let imageUrl: string | undefined;
            try {
              // If user selected a fine-tuned LoRA model and we have the weights URL,
              // route to the sdLora / lora model instead of the standard T2I engine.
              const imageModelId = fineTunedLoraUrl
                ? "fal-ai/lora"
                : (refImageUrl ? falEngines.imageToImage : falEngines.textToImage);
              const imageDispatch = await withTimeout(
                dispatchImageGeneration({
                  modelId: imageModelId,
                  prompt: compiledPrompt,
                  negativePrompt: input.negativePrompt,
                  imageUrl: refImageUrl,
                  aspectRatio: input.aspectRatio,
                  seed: input.seed,
                  // Inject LoRA weights URL + scale when fine-tuned model selected
                  ...(fineTunedLoraUrl && {
                    loraUrl: fineTunedLoraUrl,
                    loraScale: input.loraWeight ?? 0.8,
                  }),
                }),
                150_000,
                "圖片生成"
              );
              if (imageDispatch.success) {
                imageUrl = (imageDispatch.data as any)?.images?.[0]?.url
                  ?? (imageDispatch.data as any)?.image?.url
                  ?? (imageDispatch.data as any)?.url as string | undefined;
                debug(`[Fal] Image generation completed: ${imageUrl} (${imageDispatch.durationMs}ms, model: ${imageDispatch.modelId})`);
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `圖片生成失敗（fal.ai ${imageDispatch.modelId}）：${imageDispatch.error || "未知錯誤"}`,
                });
              }
            } catch (err) {
              if (!demoMode) throw err;
              // Demo mode: fall back to sample image
              debug(`[Demo] Image generation failed, using sample asset. Error: ${err}`);
            }
            // Demo mode fallback: use sample image if no URL was obtained
            if (!imageUrl && demoMode) {
              imageUrl = getDemoAsset("image");
              generationBus.emit(jobId, { type: "progress", progress: 60, message: "（示範模式）已載入範例圖片" });
            } else if (!imageUrl) {
              if (!demoMode) await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "fal.ai 圖片生成未回傳有效 URL，請稍後再試",
              });
            }
            resultUrl = imageUrl;
            resultData.imageUrl = imageUrl;
            resultData.aspectRatio = input.aspectRatio;
            resultData.negativePrompt = input.negativePrompt;
            resultData.styleReferenceUrl = input.styleReferenceUrl;
            resultData.vibeReferenceUrl = input.vibeReferenceUrl;
            resultData.imageModel = demoMode ? "demo-sample" : falEngines.textToImage;
          }

          // ── Video: fal.ai Kling (真實 API，無 Gemini Veo 依賴) ──
          if (input.generationType === "video" || input.generationType === "multimodal") {
            generationBus.emit(jobId, { type: "progress", progress: 45, message: "正在呼叫 fal.ai Kling 生成影片..." });
            const videoModelId = input.firstFrameUrl
              ? falEngines.imageToVideo
              : falEngines.textToVideo;
            let videoUrl: string | undefined;
            try {
              const videoDispatch = await withTimeout(
                dispatchVideoGeneration({
                  modelId: videoModelId,
                  prompt: compiledPrompt,
                  imageUrl: input.firstFrameUrl || input.characterRefUrl || undefined,
                  durationSec: input.videoDurationSeconds || 5,
                  aspectRatio: input.aspectRatio || "16:9",
                  seed: input.seed,
                }),
                300_000,
                "影片生成"
              );
              if (videoDispatch.success) {
                videoUrl = (videoDispatch.data as any)?.video?.url
                  ?? (videoDispatch.data as any)?.videos?.[0]?.url
                  ?? (videoDispatch.data as any)?.url as string | undefined;
                debug(`[Fal] Video generation completed: ${videoUrl} (${videoDispatch.durationMs}ms, model: ${videoDispatch.modelId})`);
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `影片生成失敗（fal.ai ${videoDispatch.modelId}）：${videoDispatch.error || "未知錯誤"}`,
                });
              }
            } catch (err) {
              if (!demoMode) throw err;
              // Demo mode: fall back to sample video
              debug(`[Demo] Video generation failed, using sample asset. Error: ${err}`);
            }
            // Demo mode fallback: use sample video if no URL was obtained
            if (!videoUrl && demoMode) {
              videoUrl = getDemoAsset("video");
              generationBus.emit(jobId, { type: "progress", progress: 65, message: "（示範模式）已載入範例影片" });
            } else if (!videoUrl) {
              if (!demoMode) await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "fal.ai 影片生成未回傳有效 URL，請稍後再試",
              });
            }
            resultData.videoUrl = videoUrl;
            resultData.videoStatus = "completed";
            resultData.videoDuration = input.videoDurationSeconds || 5;
            resultData.videoModel = demoMode ? "demo-sample" : videoModelId;
            resultData.videoPrompt = compiledPrompt;
            resultData.firstFrameUrl = input.firstFrameUrl;
            resultData.lastFrameUrl = input.lastFrameUrl;
            resultData.characterRefUrl = input.characterRefUrl;
            resultData.cameraMotion = input.cameraMotion;
            if (!resultUrl) resultUrl = videoUrl;
          }

          // ── Audio: fal.ai stable-audio (真實 API，無 Gemini Lyria 依賴) ──
          if (input.generationType === "audio" || input.generationType === "multimodal") {
            generationBus.emit(jobId, { type: "progress", progress: 45, message: "正在呼叫 fal.ai 生成音樂..." });
            // Build music prompt from style + compiled prompt
            let musicPrompt = compiledPrompt;
            if (input.musicStyle) {
              musicPrompt = `${input.musicStyle}, ${compiledPrompt}`;
            }
            if (input.isInstrumental) {
              musicPrompt += ". Instrumental only, no vocals.";
            }
            if (input.lyrics) {
              musicPrompt += `\n\nLyrics:\n${input.lyrics}`;
            }
            let audioUrl: string | undefined;
            try {
              const audioDispatch = await withTimeout(
                dispatchAudioGeneration({
                  modelId: falEngines.textToAudio,
                  prompt: musicPrompt,
                  durationSec: input.audioDuration || 30,
                  seed: input.seed,
                }),
                180_000,
                "音樂生成"
              );
              if (audioDispatch.success) {
                audioUrl = (audioDispatch.data as any)?.audio?.url
                  ?? (audioDispatch.data as any)?.audio_url
                  ?? (audioDispatch.data as any)?.url as string | undefined;
                debug(`[Fal] Audio generation completed: ${audioUrl} (${audioDispatch.durationMs}ms, model: ${audioDispatch.modelId})`);
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `音樂生成失敗（fal.ai ${audioDispatch.modelId}）：${audioDispatch.error || "未知錯誤"}`,
                });
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Audio generation failed, using sample asset. Error: ${err}`);
            }
            if (!audioUrl && demoMode) {
              audioUrl = getDemoAsset("audio");
              generationBus.emit(jobId, { type: "progress", progress: 65, message: "（示範模式）已載入範例音樂" });
            } else if (!audioUrl) {
              if (!demoMode) await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fal.ai 音樂生成未回傳有效 URL，請稍後再試" });
            }
            resultData.audioUrl = audioUrl;
            resultData.audioStatus = "completed";
            resultData.audioTitle = input.musicStyle || "Healing Music";
            resultData.audioModel = demoMode ? "demo-sample" : falEngines.textToAudio;
            resultData.musicStyle = input.musicStyle || "ambient healing";
            resultData.isInstrumental = input.isInstrumental;
            resultData.lyrics = input.lyrics;
            resultData.audioDuration = input.audioDuration;
            resultData.audioEnergy = input.audioEnergy;
            if (!resultUrl) resultUrl = audioUrl;
          }

          // ── Voice: fal.ai playai-tts (真實 API，無 Gemini TTS 依賴) ──
          if (input.generationType === "voice") {
            generationBus.emit(jobId, { type: "progress", progress: 50, message: "正在呼叫 fal.ai TTS 生成語音..." });
            const ttsText = input.voiceText || input.prompt;
            // Map emotion to fal.ai playai voice IDs
            const voiceIdMap: Record<string, string> = {
              "warm":     "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
              "calm":     "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json",
              "cheerful": "s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
              "serious":  "s3://voice-cloning-zero-shot/820da3d2-3a3b-42e7-8d14-a0e2bed3c4f3/original/manifest.json",
              "gentle":   "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
              "energetic":"s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
            };
            const falVoiceId = input.voiceModelId
              || voiceIdMap[input.voiceEmotionType || ""]
              || "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json";
            let voiceUrl: string | undefined;
            try {
              const voiceDispatch = await withTimeout(
                dispatchTTS({
                  modelId: falEngines.textToSpeech,
                  text: ttsText,
                  voiceId: falVoiceId,
                  speed: input.voiceSpeed,
                  charCount: ttsText.length,
                }),
                90_000,
                "語音生成"
              );
              if (voiceDispatch.success) {
                voiceUrl = (voiceDispatch.data as any)?.audio?.url
                  ?? (voiceDispatch.data as any)?.audio_url
                  ?? (voiceDispatch.data as any)?.url as string | undefined;
                debug(`[Fal] Voice generation completed: ${voiceUrl} (${voiceDispatch.durationMs}ms, model: ${voiceDispatch.modelId})`);
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `語音生成失敗（fal.ai ${voiceDispatch.modelId}）：${voiceDispatch.error || "未知錯誤"}`,
                });
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Voice generation failed, using sample asset. Error: ${err}`);
            }
            if (!voiceUrl && demoMode) {
              voiceUrl = getDemoAsset("voice");
              generationBus.emit(jobId, { type: "progress", progress: 65, message: "（示範模式）已載入範例語音" });
            } else if (!voiceUrl) {
              if (!demoMode) await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fal.ai 語音生成未回傳有效 URL，請稍後再試" });
            }
            resultData.voiceUrl = voiceUrl;
            resultData.voiceStatus = "completed";
            resultData.voiceEngine = "fal-tts";
            resultData.voiceModel = demoMode ? "demo-sample" : falEngines.textToSpeech;
            resultData.voiceModelId = input.voiceModelId;
            resultData.voiceText = input.voiceText;
            resultData.voiceSpeed = input.voiceSpeed;
            resultData.voiceStability = input.voiceStability;
            resultData.voiceEmotionType = input.voiceEmotionType;
            resultData.voiceEmotionIntensity = input.voiceEmotionIntensity;
            if (!resultUrl) resultUrl = voiceUrl;
          }

          // ── Post-generation events ──
          stepTimestamps.generateDone = Date.now();
          const generateMs = stepTimestamps.generateDone - (stepTimestamps.compileDone || stepTimestamps.start);
          generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成`, status: resultUrl ? "completed" : "completed", detail: resultUrl ? `生成成功（${generateMs}ms）` : `已加入佇列（${generateMs}ms）`, timestamp: stepTimestamps.generateDone } });
          generationBus.emit(jobId, { type: "progress", progress: 70, message: "生成完成，處理後續..." });

          // ── Points logging ──
          stepTimestamps.quotaDone = Date.now();
          generationBus.emit(jobId, { type: "thought-update", node: {
            id: "quota",
            label: "積分扣除",
            status: "completed",
            detail: `扣除 ${_genEstimate.totalPoints} pts | ${_genEstimate.breakdown} | 引擎：${_genEngineLabel}`,
            timestamp: stepTimestamps.quotaDone,
          }});
          generationBus.emit(jobId, { type: "progress", progress: 80, message: `積分已扣除 ${_genEstimate.totalPoints} pts` });

          // Points were already atomically deducted in prepareJob.
          // Log real usage with actual model cost.
          if (!demoMode) {
            await db.createApiUsageLog({
              userId,
              requestType: input.generationType === "image" ? "image_generation" :
                input.generationType === "video" ? "video_generation" :
                input.generationType === "audio" ? "audio_generation" :
                input.generationType === "voice" ? "voice_dubbing" : "image_generation",
              apiProvider: _genPricing?.provider ?? (input.mode === "lightning" ? "gemini_flash" : "gemini_pro"),
              tokensUsed: _genEstimate.totalPoints * 200,
              estimatedCostUsd: (_genEstimate.totalPoints / 100).toFixed(4),
              responseStatus: "success",
              generationsDeducted: _genEstimate.totalPoints,
            });

            // Save to asset library
            if (resultUrl) {
              await db.createDigitalAsset({
                userId,
                title: input.prompt.substring(0, 100),
                assetType: input.generationType === "multimodal" ? "image" : input.generationType,
                fileUrl: resultUrl,
                promptUsed: input.prompt,
              });
            }

            // Save to generation history
            await db.createHistoryEntry({
              userId,
              modality: input.generationType === "multimodal" ? "image" : input.generationType as "image" | "video" | "audio" | "voice",
              prompt: input.prompt,
              compiledPrompt,
              parameterSnapshot: {
                mode: input.mode,
                temperature: input.temperature,
                vibeCardIds: input.vibeCardIds,
                seed: input.seed,
                loraWeight: input.loraWeight,
                visualWeight,
                controlNetParams,
                ...(input.fineTunedModelId && { fineTunedModelId: input.fineTunedModelId }),
                ...(input.vaultCharacterId && { vaultCharacterId: input.vaultCharacterId }),
                ...(input.vaultSceneId && { vaultSceneId: input.vaultSceneId }),
                ...(input.generationType === "image" && {
                  aspectRatio: input.aspectRatio,
                  negativePrompt: input.negativePrompt,
                  styleReferenceUrl: input.styleReferenceUrl,
                  vibeReferenceUrl: input.vibeReferenceUrl,
                }),
                ...(input.generationType === "video" && {
                  videoDurationSeconds: input.videoDurationSeconds,
                  firstFrameUrl: input.firstFrameUrl,
                  lastFrameUrl: input.lastFrameUrl,
                  characterRefUrl: input.characterRefUrl,
                  cameraMotion: input.cameraMotion,
                }),
                ...(input.generationType === "audio" && {
                  musicStyle: input.musicStyle,
                  isInstrumental: input.isInstrumental,
                  lyrics: input.lyrics,
                  audioDuration: input.audioDuration,
                  audioEnergy: input.audioEnergy,
                }),
                ...(input.generationType === "voice" && {
                  voiceModelId: input.voiceModelId,
                  voiceText: input.voiceText,
                  voiceSpeed: input.voiceSpeed,
                  voiceStability: input.voiceStability,
                  voiceEmotionType: input.voiceEmotionType,
                  voiceEmotionIntensity: input.voiceEmotionIntensity,
                }),
              },
              resultUrl: resultUrl || undefined,
              thumbnailUrl: resultUrl || undefined,
              costCredits: 1,
            });

            // Update job
            await db.updateBackgroundJob(jobId, {
              status: "completed",
              progress: 100,
              progressMessage: "生成完成！",
              resultJson: resultData,
            });
          }

          // ── Phase 14: RAG 記憶向量化（非同步，不阻塞回應）──────────────
          upsertMemory({
            userId,
            generationId: jobId,
            prompt: input.prompt,
            generationType: input.generationType,
            resultSummary: resultUrl ? `成功生成 ${input.generationType}` : undefined,
            vibeCardIds: input.vibeCardIds,
          }).catch(() => { /* 靜默降級 */ });

          // ── History saved event ──
          stepTimestamps.historyDone = Date.now();
          generationBus.emit(jobId, { type: "thought-update", node: { id: "history", label: "歷史紀錄", status: "completed", detail: "已儲存至生成歷史", timestamp: stepTimestamps.historyDone } });
          generationBus.emit(jobId, { type: "progress", progress: 95, message: "歷史紀錄已儲存" });

          // Build final Chain-of-Thought trace with REAL timestamps from each execution step
          const finalSafetyMs = (stepTimestamps.safetyDone || stepTimestamps.start) - stepTimestamps.start;
          const finalCompileMs = (stepTimestamps.compileDone || stepTimestamps.compileStart || 0) - (stepTimestamps.compileStart || stepTimestamps.start);
          const finalGenerateMs = stepTimestamps.generateDone - (stepTimestamps.compileDone || stepTimestamps.start);
          const thoughtChain = [
            { id: "safety", label: "安全檢查", status: "passed" as const, detail: `內容安全檢查通過（${finalSafetyMs}ms）`, timestamp: stepTimestamps.safetyDone || stepTimestamps.start },
            { id: "compile", label: "提示詞編譯", status: "completed" as const, detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${finalCompileMs}ms）`, timestamp: stepTimestamps.compileDone || stepTimestamps.start },
            { id: "weight", label: "視覺權重計算", status: "completed" as const, detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`, timestamp: stepTimestamps.weightDone || stepTimestamps.start },
            { id: "generate", label: `${modalityLabel}生成`, status: resultUrl ? "completed" as const : "completed" as const, detail: resultUrl ? `生成成功（${finalGenerateMs}ms）` : `已加入佇列（${finalGenerateMs}ms）`, timestamp: stepTimestamps.generateDone },
            { id: "quota", label: "配額扣除", status: "completed" as const, detail: "扣除 1 次生成配額", timestamp: stepTimestamps.quotaDone || Date.now() },
            { id: "history", label: "歷史紀錄", status: "completed" as const, detail: "已儲存至生成歷史", timestamp: stepTimestamps.historyDone || Date.now() },
          ];

          // Emit final complete event via SSE
          generationBus.emit(jobId, { type: "complete", thoughtChain });
          // Clean up listeners after a short delay
          setTimeout(() => generationBus.cleanup(jobId), 2000);

          return { jobId, resultUrl, resultData, compiledPrompt, thoughtChain };
        } catch (error) {
          // Transactional integrity: refund points on generation failure
          const errMsg = error instanceof Error ? error.message : "生成失敗";
          const isTimeout = /超時|timeout|timed? ?out|ETIMEDOUT|aborted/i.test(errMsg);
          if (!demoMode) {
            await db.refundUserPoints(userId, _genEstimate.totalPoints);
            await db.updateBackgroundJob(jobId, {
              status: "failed",
              errorMessage: errMsg,
            });
            await db.createApiUsageLog({
              userId,
              requestType: "image_generation",
              apiProvider: "gemini",
              responseStatus: "failed",
              errorMessage: errMsg,
              generationsDeducted: 0,
            });
          }
          // Emit error via SSE so the frontend can update thought chain
          generationBus.emit(jobId, {
            type: "thought-update",
            node: { id: "error", label: "錯誤", status: "error" as const, detail: errMsg, timestamp: Date.now() },
          });
          generationBus.emit(jobId, { type: "error", message: errMsg });
          setTimeout(() => generationBus.cleanup(jobId), 2000);
          // Zero-Anxiety: friendly message emphasizing no credits were deducted
          const userMessage = isTimeout
            ? "AI 服務回應超時，我們並未扣除您的積分，請稍後重試"
            : "AI 服務連線稍微異常，我們並未扣除您的積分，請稍後重試";
          throw new TRPCError({
            code: isTimeout ? "TIMEOUT" as any : "INTERNAL_SERVER_ERROR",
            message: userMessage,
          });
        }
      }),

    jobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        return db.getBackgroundJob(input.jobId);
      }),

    myJobs: protectedProcedure.query(async ({ ctx }) => {
      return db.getJobsByUser(ctx.user.id);
    }),
  }),

  // ─── Prompt Evaluation (LLM-as-a-Judge) ──────────────────────────────────

  evaluate: router({
    prompt: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1),
        modality: z.enum(["image", "video", "audio", "voice"]).default("image"),
      }))
      .mutation(async ({ input }) => {
        const result = await withTimeout(invokeLLM({
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
                  score: { type: "integer", description: "Total score 0-100" },
                  dimensions: {
                    type: "object",
                    properties: {
                      subjectClarity: { type: "integer" },
                      actionNarrative: { type: "integer" },
                      environment: { type: "integer" },
                      lightingTone: { type: "integer" },
                      technicalSpecs: { type: "integer" },
                    },
                    required: ["subjectClarity", "actionNarrative", "environment", "lightingTone", "technicalSpecs"],
                    additionalProperties: false,
                  },
                  strengths: { type: "string" },
                  weaknesses: { type: "string" },
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Short label in Traditional Chinese, 6-15 chars" },
                        actionType: { type: "string", enum: ["append_prompt", "replace_prompt", "add_negative"], description: "Type of action to apply" },
                        actionPayload: { type: "string", description: "English prompt fragment to apply directly" },
                        reason: { type: "string", description: "Why this improves the prompt, in Traditional Chinese, 10-25 chars" },
                      },
                      required: ["label", "actionType", "actionPayload", "reason"],
                      additionalProperties: false,
                    },
                  },
                  optimizedPrompt: { type: "string" },
                },
                required: ["score", "dimensions", "strengths", "weaknesses", "suggestions", "optimizedPrompt"],
                additionalProperties: false,
              },
            },
          },
        }), 30_000, "提示詞評估");
        const content = result.choices[0]?.message?.content;
        if (typeof content === "string") {
          return JSON.parse(content);
        }
        return { score: 50, dimensions: { subjectClarity: 10, actionNarrative: 10, environment: 10, lightingTone: 10, technicalSpecs: 10 }, strengths: "", weaknesses: "", suggestions: [], optimizedPrompt: input.prompt };
      }),

    suggestChips: protectedProcedure
      .input(z.object({
        partial: z.string().min(1).max(50),
      }))
      .mutation(async ({ input }) => {
        const result = await withTimeout(invokeLLM({
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
                    description: "3-5 creative inspiration suggestions in Traditional Chinese",
                  },
                },
                required: ["chips"],
                additionalProperties: false,
              },
            },
          },
        }), 15_000, "靈感建議");
        const content = result.choices[0]?.message?.content;
        if (typeof content === "string") {
          const parsed = JSON.parse(content);
          return { chips: (parsed.chips || []).slice(0, 5) };
        }
        return { chips: [] };
      }),
  }),

  // ─── Director AI Chat ────────────────────────────────────────────────────

  director: router({
    chat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.string(),
          content: z.string(),
        })),
        saveToNotes: z.boolean().default(false),
        personality: z.enum(["calm", "creative", "technical"]).default("creative"),
      }))
      .mutation(async ({ ctx, input }) => {
        return runDirectorAI(input.messages, input.saveToNotes, ctx.user.id, input.personality);
      }),
  }),

  // ─── Assets ──────────────────────────────────────────────────────────────

  assets: router({
    myAssets: protectedProcedure
      .input(z.object({
        assetType: z.enum(["image", "video", "audio", "voice", "script", "zip_bundle", "all"]).default("all"),
        search: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        try {
          const all = await db.getDigitalAssetsByUser(ctx.user.id);
          let result = all;
          if (input?.assetType && input.assetType !== "all") {
            result = result.filter(a => a.assetType === input.assetType);
          }
          if (input?.search) {
            const q = input.search.toLowerCase();
            result = result.filter(a =>
              a.title.toLowerCase().includes(q) ||
              (a.description || "").toLowerCase().includes(q) ||
              (a.promptUsed || "").toLowerCase().includes(q)
            );
          }
          return result;
        } catch {
          return [];
        }
      }),

    teamAssets: protectedProcedure
      .input(z.object({
        assetType: z.enum(["image", "video", "audio", "voice", "script", "zip_bundle", "all"]).default("all"),
        search: z.string().optional(),
      }).optional())
      .query(async ({ ctx: _ctx, input }) => {
        try {
          const all = await db.getTeamSharedAssets();
          let result = all;
          if (input?.assetType && input.assetType !== "all") {
            result = result.filter(a => a.assetType === input.assetType);
          }
          if (input?.search) {
            const q = input.search.toLowerCase();
            result = result.filter(a =>
              a.title.toLowerCase().includes(q) ||
              (a.description || "").toLowerCase().includes(q) ||
              (a.promptUsed || "").toLowerCase().includes(q)
            );
          }
          return result;
        } catch {
          return [];
        }
      }),

    // ── 手動上傳資產（已上傳至 S3 後呼叫此端點登記）──────────────────────
    upload: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(500).optional(),
        assetType: z.enum(["image", "video", "audio", "voice", "script", "zip_bundle"]),
        fileUrl: z.string().url(),
        fileKey: z.string(),
        mimeType: z.string().optional(),
        fileSizeBytes: z.number().optional(),
        thumbnailUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createDigitalAsset({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          assetType: input.assetType,
          fileUrl: input.fileUrl,
          fileKey: input.fileKey,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes,
          thumbnailUrl: input.thumbnailUrl,
        });
        return { id };
      }),

    // ── 更新資產資訊 ──────────────────────────────────────────────────────
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        const updates: Record<string, unknown> = {};
        if (input.title) updates.title = input.title;
        if (input.description !== undefined) updates.description = input.description;
        await db.updateDigitalAsset(input.id, updates as Parameters<typeof db.updateDigitalAsset>[1]);
        return { success: true };
      }),

    toggleVisibility: protectedProcedure
      .input(z.object({
        id: z.number(),
        visibility: z.enum(["private", "team_shared"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        await db.updateDigitalAsset(input.id, { visibility: input.visibility });
        // Reward credits for sharing
        if (input.visibility === "team_shared") {
          await db.refundUserQuota(ctx.user.id, 2);
        }
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        await db.deleteDigitalAsset(input.id);
        return { success: true };
      }),
  }),

  // ─── Fine-Tuned Models ────────────────────────────────────────────────────

  models: router({
    myModels: protectedProcedure.query(async ({ ctx }) => {
      return db.getFineTunedModelsByUser(ctx.user.id);
    }),

    teamModels: protectedProcedure.query(async () => {
      try {
        return await db.getTeamSharedModels();
      } catch {
        return [];
      }
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        // Only allow access to own or team-shared models
        if (model.userId !== ctx.user.id && model.visibility !== "team_shared") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
        }
        return model;
      }),

    // ── 取得訓練任務狀態（輪詢用）────────────────────────────────────────
    trainingStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getBackgroundJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任務不存在" });
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
        }
        return {
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          progressMessage: job.progressMessage,
          resultJson: job.resultJson as Record<string, unknown> | null,
          errorMessage: job.errorMessage,
          updatedAt: job.updatedAt,
        };
      }),

    // ── 同步 Replicate 狀態（主動拉取 Replicate prediction 最新狀態）────
    syncReplicateStatus: protectedProcedure
      .input(z.object({ modelId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.modelId);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        if (model.status === "ready" || model.status === "failed") {
          return { status: model.status, message: "已是最終狀態" };
        }

        const predictionId = model.replicatePredictionId ||
          (model.configJson as Record<string, unknown> | null)?.predictionId as string | undefined;

        if (!predictionId) {
          return { status: model.status, message: "尚無 Replicate prediction ID" };
        }

        if (!process.env.REPLICATE_API_TOKEN) {
          return { status: model.status, message: "REPLICATE_API_TOKEN 未設定" };
        }

        try {
          const Replicate = (await import("replicate")).default;
          const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
          const prediction = await replicate.predictions.get(predictionId) as {
            status: string;
            output?: unknown;
            error?: unknown;
          };

          if (prediction.status === "succeeded") {
            const outputUrl = typeof prediction.output === "string"
              ? prediction.output
              : Array.isArray(prediction.output) ? (prediction.output as string[])[0] : null;

            await db.updateFineTunedModel(input.modelId, {
              status: "ready",
              trainedLoraUrl: outputUrl || undefined,
              fileUrl: outputUrl || model.fileUrl || undefined,
            });
            return { status: "ready", loraUrl: outputUrl, message: "訓練完成！" };
          } else if (prediction.status === "failed" || prediction.status === "canceled") {
            await db.updateFineTunedModel(input.modelId, { status: "failed" });
            return { status: "failed", message: `Replicate 任務 ${prediction.status}` };
          }
          return { status: "training", message: `Replicate 狀態：${prediction.status}` };
        } catch (e: any) {
          return { status: model.status, message: `同步失敗：${e.message}` };
        }
      }),

    // ── 重新訓練（重新提交已失敗的模型）──────────────────────────────────
    retrain: protectedProcedure
      .input(z.object({ modelId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.modelId);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        if (model.status === "training") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "模型正在訓練中" });
        }
        if (!process.env.REPLICATE_API_TOKEN) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "REPLICATE_API_TOKEN 未設定，無法訓練" });
        }

        const config = model.configJson as Record<string, unknown> | null;
        const imageUrls = (config?.datasetImages as Array<{ url: string }> | undefined)?.map(i => i.url) ?? [];
        if (imageUrls.length < 3) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "訓練圖片不足（至少 3 張）" });
        }

        // Reset status
        await db.updateFineTunedModel(input.modelId, { status: "pending", trainedLoraUrl: undefined });

        const jobId = await db.createBackgroundJob({
          userId: ctx.user.id,
          jobType: "model_training",
          status: "queued",
          progress: 0,
          progressMessage: "重新訓練任務已加入佇列",
          resultJson: { modelId: input.modelId, modelName: model.name },
        });

        import("./services/loraTrainer").then(({ runLoraTrainingJob }) => {
          runLoraTrainingJob({
            userId: ctx.user.id,
            modelId: input.modelId,
            jobId,
            modelName: model.name,
            triggerWord: (config?.triggerWord as string) || "",
            epochs: (config?.epochs as number) ?? 20,
            learningRate: (config?.learningRate as number) ?? 0.0001,
            imageUrls,
          }).catch(err => {
            console.error(`[LoraTrainer] Retrain job failed for model ${input.modelId}:`, err);
          });
        });

        return { jobId, message: "重新訓練已啟動" };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        modelType: z.enum(["image_subject", "voice_clone", "style_lora"]).default("image_subject"),
        triggerWord: z.string().max(50).optional(),
        epochs: z.number().min(5).max(100).optional(),
        learningRate: z.number().min(0.00001).max(0.01).optional(),
        batchSize: z.number().min(1).max(8).optional(),
        fileUrl: z.string().optional(),
        fileKey: z.string().optional(),
        datasetImages: z.array(z.object({
          url: z.string(),
          fileKey: z.string(),
          angle: z.enum(["front", "side", "back", "expression", "other"]),
          caption: z.string().optional(),
        })).min(3).max(30).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const configJson = {
          triggerWord: input.triggerWord || "",
          epochs: input.epochs ?? 20,
          learningRate: input.learningRate ?? 0.0001,
          batchSize: input.batchSize ?? 4,
          steps: Math.min(Math.max((input.epochs ?? 20) * 30, 200), 2000),
          datasetImages: input.datasetImages ?? [],
        };

        // Create the model record
        const modelId = await db.createFineTunedModel({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          modelType: input.modelType,
          fileUrl: input.datasetImages?.[0]?.url || input.fileUrl,
          fileKey: input.datasetImages?.[0]?.fileKey || input.fileKey,
          configJson,
        });

        // Create a background job for training
        const jobId = await db.createBackgroundJob({
          userId: ctx.user.id,
          jobType: "model_training",
          status: "queued",
          progress: 0,
          progressMessage: "訓練任務已加入佇列",
          resultJson: { modelId, modelName: input.name },
        });

        if (!process.env.REPLICATE_API_TOKEN) {
          console.warn(`[LoraTrainer] REPLICATE_API_TOKEN not set — model ${modelId} will remain queued`);
        } else if (input.datasetImages && input.datasetImages.length >= 3) {
          // 非同步啟動 LoRA 訓練（背景執行，不阻塞此 API 回應）
          import("./services/loraTrainer").then(({ runLoraTrainingJob }) => {
            runLoraTrainingJob({
              userId: ctx.user.id,
              modelId,
              jobId,
              modelName: input.name,
              triggerWord: input.triggerWord || "",
              epochs: input.epochs ?? 20,
              learningRate: input.learningRate ?? 0.0001,
              imageUrls: input.datasetImages!.map(img => img.url),
            }).catch(err => {
              console.error(`[LoraTrainer] Background job failed for model ${modelId}:`, err);
            });
          });
        }

        return { id: modelId, jobId };
      }),

    captionImages: protectedProcedure
      .input(z.object({
        images: z.array(z.object({
          url: z.string(),
          angle: z.enum(["front", "side", "back", "expression", "other"]),
        })).max(30),
      }))
      .mutation(async ({ input }) => {
        const captions: string[] = [];
        for (const img of input.images) {
          try {
            const result = await withTimeout(invokeLLM({
              messages: [
                {
                  role: "system",
                  content: "You are a professional image captioner for LoRA training datasets. Generate a concise English description (20-40 words) that captures the subject's appearance, pose, expression, and clothing. Be specific and descriptive. Only output the caption text, nothing else.",
                },
                {
                  role: "user",
                  content: [
                    { type: "text" as const, text: `Angle: ${img.angle}. Generate a training caption for this image.` },
                    { type: "image_url" as const, image_url: { url: img.url } },
                  ],
                },
              ],
            }), 20_000, "圖片標註");
            const content = result.choices[0]?.message?.content;
            captions.push(typeof content === "string" ? content.trim() : `${img.angle} view of the subject`);
          } catch {
            captions.push(`${img.angle} view of the subject`);
          }
        }
        return { captions };
      }),

    toggleVisibility: protectedProcedure
      .input(z.object({
        id: z.number(),
        visibility: z.enum(["private", "team_shared"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        await db.updateFineTunedModel(input.id, { visibility: input.visibility });
        if (input.visibility === "team_shared") {
          // Reward 3 quota for sharing a ready model
          if (model.status === "ready") await db.refundUserQuota(ctx.user.id, 3);
        }
        return { success: true };
      }),

    // ── 更新模型資訊（名稱、描述、觸發詞）──────────────────────────────────
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        triggerWord: z.string().max(50).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.triggerWord !== undefined) {
          // Update triggerWord in configJson
          const config = (model.configJson as Record<string, unknown>) || {};
          updates.configJson = { ...config, triggerWord: input.triggerWord };
        }
        await db.updateFineTunedModel(input.id, updates as Partial<typeof model>);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        await db.deleteFineTunedModel(input.id);
        return { success: true };
      }),

    // ── 增加使用計數（生成時呼叫）────────────────────────────────────────
    incrementUsage: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.incrementModelUsage(input.id);
        return { success: true };
      }),
  }),

  // ─── Project Notes ────────────────────────────────────────────────────────

  notes: router({
    list: protectedProcedure
      .input(z.object({
        noteType: z.enum(["note", "script", "calendar_event", "all"]).default("all"),
        search: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const all = await db.getProjectNotesByUser(ctx.user.id);
        let result = all;
        if (input?.noteType && input.noteType !== "all") {
          result = result.filter(n => n.noteType === input.noteType);
        }
        if (input?.search) {
          const q = input.search.toLowerCase();
          result = result.filter(n =>
            n.title.toLowerCase().includes(q) ||
            (n.content || "").toLowerCase().includes(q)
          );
        }
        if (input?.tags && input.tags.length > 0) {
          result = result.filter(n => {
            const noteTags = (n.tags as string[] | null) || [];
            return input.tags!.some(t => noteTags.includes(t));
          });
        }
        return result;
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(255),
        content: z.string().optional(),
        scriptJson: z.any().optional(),
        noteType: z.enum(["note", "script", "calendar_event"]).default("note"),
        scheduledDate: z.number().optional(),
        tags: z.array(z.string().max(32)).max(10).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createProjectNote({
          userId: ctx.user.id,
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          noteType: input.noteType,
          scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
          tags: input.tags,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        content: z.string().optional(),
        scriptJson: z.any().optional(),
        scheduledDate: z.number().nullable().optional(),
        tags: z.array(z.string().max(32)).max(10).optional(),
        noteType: z.enum(["note", "script", "calendar_event"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const note = await db.getProjectNote(input.id);
        if (!note || note.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
        }
        await db.updateProjectNote(input.id, {
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          noteType: input.noteType,
          tags: input.tags,
          ...(input.scheduledDate !== undefined
            ? { scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : null }
            : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const note = await db.getProjectNote(input.id);
        if (!note || note.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
        }
        await db.deleteProjectNote(input.id);
        return { success: true };
      }),
  }),

  // ─── Feedback ─────────────────────────────────────────────────────────────

  feedback: router({
    myFeedbacks: protectedProcedure.query(async ({ ctx }) => {
      return db.getFeedbacksByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        category: z.enum(["bug", "feature_request", "quality_issue", "general"]).default("general"),
        priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createFeedbackReport({
          userId: ctx.user.id,
          ...input,
        });
        // Notify owner about new feedback
        const categoryLabels: Record<string, string> = {
          bug: "錯誤回報",
          feature_request: "功能詢問",
          quality_issue: "品質問題",
          general: "一般意見",
        };
        try {
          const { notifyOwner } = await import("./_core/notification");
          await notifyOwner({
            title: `新${categoryLabels[input.category] || "回饋"}：${input.title}`,
            content: `來自 ${ctx.user.name || "匿名使用者"}\n類別：${categoryLabels[input.category] || input.category}\n優先級：${input.priority}\n\n${input.description || "(無詳細說明)"}`,
          });
        } catch { /* notification is best-effort */ }
        return { id };
      }),

    // Admin only
    all: adminProcedure.query(async () => {
      return db.getAllFeedbacks();
    }),

    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["open", "in_progress", "resolved", "closed"]),
      }))
      .mutation(async ({ input }) => {
        await db.updateFeedbackStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  // ─── Consistency Vault ──────────────────────────────────────────────────────

  vault: router({
    list: protectedProcedure
      .input(z.object({
        itemType: z.enum(["character", "scene"]).optional(),
        search: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        let items = input?.itemType
          ? await db.getVaultItemsByType(ctx.user.id, input.itemType)
          : await db.getVaultItemsByUser(ctx.user.id);

        if (input?.search) {
          const q = input.search.toLowerCase();
          items = items.filter(v =>
            v.name.toLowerCase().includes(q) ||
            ((v.tags as string[] | null) || []).some(t => t.toLowerCase().includes(q))
          );
        }
        if (input?.tags && input.tags.length > 0) {
          items = items.filter(v => {
            const vTags = (v.tags as string[] | null) || [];
            return input.tags!.some(t => vTags.includes(t));
          });
        }
        return items;
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(128),
        itemType: z.enum(["character", "scene"]),
        imageUrl: z.string().min(1),
        fileKey: z.string().optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createVaultItem({
          userId: ctx.user.id,
          name: input.name,
          itemType: input.itemType,
          imageUrl: input.imageUrl,
          fileKey: input.fileKey,
          tags: input.tags,
          metadata: input.metadata,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(128).optional(),
        tags: z.array(z.string().max(32)).max(20).optional(),
        imageUrl: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "保險庫項目不存在" });
        }
        await db.updateVaultItem(input.id, {
          name: input.name,
          tags: input.tags,
          imageUrl: input.imageUrl,
          metadata: input.metadata,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "保險庫項目不存在" });
        }
        await db.deleteVaultItem(input.id);
        return { success: true };
      }),

    // ── 同步至資產庫（保存庫項目另存為數位資產）──────────────────────────
    exportToAssets: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "保險庫項目不存在" });
        }
        const assetId = await db.createDigitalAsset({
          userId: ctx.user.id,
          title: `[保險庫] ${item.name}`,
          description: `從一致性保險庫匯出 (${item.itemType})`,
          assetType: "image",
          fileUrl: item.imageUrl,
          fileKey: item.fileKey || "",
        });
        return { assetId };
      }),
  }),

  // ─── Director Preferences ─────────────────────────────────────────────────

  directorPreferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return db.getDirectorPreferences(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        personality: z.enum(["calm", "creative", "technical"]).optional(),
        preferredFormat: z.enum(["co-star", "sslcm", "selcm", "free"]).optional(),
        customSystemPrompt: z.string().optional(),
        preferencesJson: z.record(z.string(), z.unknown()).optional(),
        onboardingSteps: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertDirectorPreferences(ctx.user.id, input);
        return { id };
      }),
  }),

  // ─── Generation History ───────────────────────────────────────────────────

  history: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ ctx, input }) => {
        try {
          return await db.getHistoryByUser(ctx.user.id, input?.limit ?? 50);
        } catch {
          return [];
        }
      }),

    bookmarked: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.getBookmarkedHistory(ctx.user.id);
      } catch {
        return [];
      }
    }),

    toggleBookmark: protectedProcedure
      .input(z.object({
        id: z.number(),
        isBookmarked: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        await db.updateHistoryEntry(input.id, { isBookmarked: input.isBookmarked });
        return { success: true };
      }),

    rate: protectedProcedure
      .input(z.object({
        id: z.number(),
        rating: z.number().min(1).max(5),
      }))
      .mutation(async ({ input }) => {
        await db.updateHistoryEntry(input.id, { userRating: input.rating });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteHistoryEntry(input.id);
        return { success: true };
      }),
  }),

  // ─── AI 光球聊天（含上下文） ──────────────────────────────────────────────

  ai: router({
    chat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
        personality: z.enum(["calm", "creative", "technical"]).default("creative"),
        context: z.string().optional(), // current page / modality context
      }))
      .mutation(async ({ input }) => {
        const systemPromptMap: Record<string, string> = {
          calm: "你是「光球」，一位溫柔、沉穩的 AI 創作夥伴。你用繁體中文回覆，說話簡短有溫度，像是老朋友陪伴在身旁。你了解 AI 多媒體創作（圖片、影片、音樂、語音），能根據使用者的情緒和需求給出貼心的創作建議。",
          creative: "你是「光球」，一位活潑、充滿創意的 AI 創作夥伴。你用繁體中文回覆，語氣輕快有活力，喜歡用比喻和想像力來激發靈感。你熟悉各種 AI 生成技術，能把使用者的想法轉化成具體的創作提示詞建議。",
          technical: "你是「光球」，一位精準、理性的 AI 技術顧問。你用繁體中文回覆，說話直接有條理，擅長把技術細節解釋得淺顯易懂。你精通 AI 圖像、影片、音頻生成的技術參數，能給出精確的優化建議。",
        };
        const systemPrompt = systemPromptMap[input.personality] ?? systemPromptMap.creative;
        const contextNote = input.context
          ? `\n\n【當前使用者情境：${input.context}】`
          : "";

        const result = await withTimeout(invokeLLM({
          messages: [
            { role: "system", content: systemPrompt + contextNote },
            ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          ],
        }), 20_000, "光球聊天");

        const reply = typeof result.choices[0]?.message?.content === "string"
          ? result.choices[0].message.content
          : "抱歉，我剛才走神了。你說什麼？";

        return { reply };
      }),
  }),

  // ─── Subscription Plans ───────────────────────────────────────────────────

  plans: router({
    list: publicProcedure.query(async () => {
      return db.getActivePlans();
    }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getPlanById(input.id);
      }),
  }),
  // ─── Custom Blocks ─────────────────────────────────────────────────────────

  customBlocks: router({
    list: protectedProcedure
      .input(z.object({ modality: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return db.getCustomBlocksByUser(ctx.user.id, input?.modality);
      }),

    create: protectedProcedure
      .input(z.object({
        modality: z.enum(["image", "video", "audio", "voice"]),
        category: z.string().min(1),
        label: z.string().min(1).max(128),
        prompt: z.string().min(1).max(512),
        emoji: z.string().max(8).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createCustomBlock({
          userId: ctx.user.id,
          modality: input.modality,
          category: input.category,
          label: input.label,
          prompt: input.prompt,
          emoji: input.emoji,
        });
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteCustomBlock(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Block Combos ──────────────────────────────────────────────────────────

  blockCombos: router({
    list: protectedProcedure
      .input(z.object({ modality: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return db.getBlockCombosByUser(ctx.user.id, input?.modality);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        modality: z.enum(["image", "video", "audio", "voice"]),
        blockIds: z.array(z.string()),
        customBlockIds: z.array(z.number()).optional(),
        vibeCardIds: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createBlockCombo({
          userId: ctx.user.id,
          name: input.name,
          modality: input.modality,
          blockIds: input.blockIds,
          customBlockIds: input.customBlockIds,
          vibeCardIds: input.vibeCardIds,
        });
        return { id };
      }),

    rename: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.renameBlockCombo(input.id, ctx.user.id, input.name);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteBlockCombo(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Admin Dashboard ────────────────────────────────────────────────────────

  admin: router({    allUsers: adminProcedure.query(async () => {
      return db.getAllUsers();
    }),

    updateQuota: adminProcedure
      .input(z.object({
        userId: z.number(),
        amount: z.number().min(0),
      }))
      .mutation(async ({ input }) => {
        await db.updateUserQuota(input.userId, input.amount);
        return { success: true };
      }),

    usageLogs: adminProcedure
      .input(z.object({ limit: z.number().default(100) }))
      .query(async ({ input }) => {
        return db.getAllUsageLogs(input.limit);
      }),

    teamCostSummary: adminProcedure.query(async () => {
      return db.getTeamCostSummary();
    }),
  }),

  // ─── User Profile & Settings ───────────────────────────────────────────────

  profile: router({
    updateQuotaJson: protectedProcedure
      .input(z.object({
        image: z.number().min(0),
        video: z.number().min(0),
        audio: z.number().min(0),
        voice: z.number().min(0),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserQuotaJson(ctx.user.id, input);
        return { success: true };
      }),

    updateOnboarding: protectedProcedure
      .input(z.object({ done: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserOnboarding(ctx.user.id, input.done);
        return { success: true };
      }),
  }),

  // ─── System Settings ──────────────────────────────────────────────────────

  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const settings = await db.getSystemSettings(ctx.user.id);
      if (!settings) {
        // Return sensible defaults if no row exists yet
        return {
          uiTheme: "system" as const,
          accentColor: "violet",
          fontScale: "medium" as const,
          reducedMotion: false,
          sidebarCollapsed: false,
          analyticsConsent: false,
          crashReportConsent: false,
          shareUsageData: false,
          showProfilePublicly: false,
          autoBackupEnabled: true,
          backupFrequency: "weekly" as const,
          backupRetentionDays: 30,
          lastBackupAt: null,
          defaultModality: "image" as const,
          defaultCreativeMode: "balanced" as const,
          autoSaveHistory: true,
          nsfwFilter: true,
          emailNotifications: true,
          generationCompleteNotify: true,
          weeklyDigestEnabled: false,
          locale: "zh-TW",
          timezone: "Asia/Taipei",
          extraSettings: null,
        };
      }
      return settings;
    }),

    update: protectedProcedure
      .input(z.object({
        uiTheme: z.enum(["system", "light", "dark"]).optional(),
        accentColor: z.string().max(32).optional(),
        fontScale: z.enum(["small", "medium", "large"]).optional(),
        reducedMotion: z.boolean().optional(),
        sidebarCollapsed: z.boolean().optional(),
        analyticsConsent: z.boolean().optional(),
        crashReportConsent: z.boolean().optional(),
        shareUsageData: z.boolean().optional(),
        showProfilePublicly: z.boolean().optional(),
        autoBackupEnabled: z.boolean().optional(),
        backupFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
        backupRetentionDays: z.number().min(1).max(365).optional(),
        defaultModality: z.enum(["image", "video", "audio", "voice"]).optional(),
        defaultCreativeMode: z.enum(["balanced", "creative", "precise"]).optional(),
        autoSaveHistory: z.boolean().optional(),
        nsfwFilter: z.boolean().optional(),
        emailNotifications: z.boolean().optional(),
        generationCompleteNotify: z.boolean().optional(),
        weeklyDigestEnabled: z.boolean().optional(),
        locale: z.string().max(16).optional(),
        timezone: z.string().max(64).optional(),
        extraSettings: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertSystemSettings(ctx.user.id, input);
        return { id, success: true };
      }),
  }),

  // ─── User Dashboard ───────────────────────────────────────────────────────

  dashboard: router({
    myStats: protectedProcedure.query(async ({ ctx }) => {
      const [costSummary, recentLogs, modalityBreakdown, dailyTrend] = await Promise.all([
        db.getUserCostSummary(ctx.user.id),
        db.getUsageLogsByUser(ctx.user.id, 10),
        db.getUserModalityBreakdown(ctx.user.id),
        db.getUserDailyTrend(ctx.user.id),
      ]);
      return {
        remainingGenerations: ctx.user.remainingGenerations,
        ...costSummary,
        recentLogs,
        modalityBreakdown: modalityBreakdown.map(r => ({
          requestType: r.requestType,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
        })),
        dailyTrend: dailyTrend.map(r => ({
          date: r.date,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
          totalTokens: r.totalTokens,
        })),
      };
    }),

    myUsageLogs: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        return db.getUsageLogsByUser(ctx.user.id, input.limit);
      }),
  }),
});

export type AppRouter = typeof appRouter;
