import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { generationBus } from "./generationEvents";
import { newsRouter } from "./routers/news";
import { showcaseRouter } from "./routers/showcase";
import { senseRouter } from "./routers/sense";
import { brainRouter } from "./routers/brain";
import { getOrchestrator } from "./services/modelClients";
import { getVoiceCompiler } from "./services/voiceCompiler";
import { getAudioCompiler } from "./services/audioCompiler";
import { getVideoCompiler } from "./services/videoCompiler";

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

  const result = await withTimeout(invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位精英級 AI 提示詞編譯器。你的任務是將使用者的簡短描述擴展為一段優化的、敘事性的提示詞。

規則：
1. 必須使用正面解剖學約束（例如：「完美對稱的解剖結構、無瑕的比例」），絕對不使用負面提示
2. 融入氛圍描述：${vibeDescriptions}
3. 創意溫度：${payload.temperature}（0=保守精確，1=大膽創新）
4. 生成類型：${payload.generationType}
5. 輸出必須是一段流暢的英文敘事提示詞
6. 加入光線、構圖、色調等專業攝影/藝術指導
7. 確保人物描述包含：perfectly symmetrical anatomy, flawless proportions, natural pose${refContext}`,
      },
      { role: "user", content: payload.prompt },
    ],
  }), 30_000, "提示詞編譯");
  const content = result.choices[0]?.message?.content;
  const compiledPrompt = typeof content === "string" ? content : payload.prompt;
  return { compiledPrompt, visualWeight, controlNetParams };
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
    // Pre-flight: create job + deduct quota, return jobId for SSE connection
    prepareJob: protectedProcedure
      .input(z.object({
        generationType: z.enum(["image", "video", "audio", "voice", "multimodal"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        // Atomic quota deduction
        const deducted = await db.deductUserQuota(userId, 1);
        if (!deducted) {
          throw new TRPCError({ code: "FORBIDDEN", message: "生成配額已用完，請聯繫管理員補充配額。" });
        }
        const jobId = await db.createBackgroundJob({
          userId,
          jobType: input.generationType === "multimodal" ? "multimodal" : input.generationType,
          status: "processing",
          progress: 2,
          progressMessage: "準備中...",
        });
        // Emit initial thought chain nodes so SSE clients see them immediately
        const modalityLabel = input.generationType === "image" ? "圖像" : input.generationType === "video" ? "影片" : input.generationType === "audio" ? "音樂" : "語音";
        generationBus.emit(jobId, { type: "thought-update", node: { id: "safety", label: "安全檢查", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "compile", label: "提示詞編譯", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "weight", label: "視覺權重計算", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成`, status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "quota", label: "配額扣除", status: "completed", detail: "已扣除 1 次配額", timestamp: Date.now() } });
        generationBus.emit(jobId, { type: "thought-update", node: { id: "history", label: "歷史紀錄", status: "queued", detail: "等待中...", timestamp: 0 } });
        generationBus.emit(jobId, { type: "progress", progress: 2, message: "已建立任務，準備開始..." });
        return { jobId };
      }),

    multimodal: protectedProcedure
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
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const jobId = input.jobId;
        const stepTimestamps: Record<string, number> = { start: Date.now() };
        const modalityLabel = input.generationType === "image" ? "圖像" : input.generationType === "video" ? "影片" : input.generationType === "audio" ? "音樂" : "語音";

        // Safety pre-check (quota already deducted in prepareJob)
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
          // Refund the atomically deducted quota since no generation occurred
          await db.refundUserQuota(userId, 1);
          await db.createApiUsageLog({
            userId,
            requestType: "safety_check",
            apiProvider: "gemini_flash",
            responseStatus: "blocked",
            errorMessage: safetyResult.reason || "內容不符合安全規範",
            generationsDeducted: 0,
          });
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
              console.log(`[Vault] Injecting character ref from vault #${vaultChar.id}: ${vaultChar.name}`);
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
              console.log(`[Vault] Injecting scene ref from vault #${vaultScene.id}: ${vaultScene.name}`);
              input.vibeReferenceUrl = input.vibeReferenceUrl || vaultScene.imageUrl;
            }
          } catch (e) {
            console.warn("[Vault] Failed to load scene vault item:", e);
          }
        }

        // ── Fine-tuned model injection: append triggerWord to prompt ──
        let modelTriggerWord = "";
        if (input.fineTunedModelId) {
          try {
            const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
            if (ftModel) {
              console.log(`[Model] Injecting fine-tuned model #${ftModel.id}: ${ftModel.name}`);
              const config = ftModel.configJson as Record<string, unknown> | null;
              if (config && typeof config.triggerWord === "string" && config.triggerWord.trim()) {
                modelTriggerWord = config.triggerWord.trim();
                // Append trigger word to the user prompt so compileElitePrompt includes it
                input.prompt = `${input.prompt}, ${modelTriggerWord}`;
                console.log(`[Model] Appended triggerWord "${modelTriggerWord}" to prompt`);
              }
            }
          } catch (e) {
            console.warn("[Model] Failed to load fine-tuned model:", e);
          }
        }

        try {
          // Compile elite prompt with reference image awareness
          // ── Compile step ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "compile", label: "提示詞編譯", status: "processing", detail: "正在編譯提示詞...", timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "progress", progress: 15, message: "編譯提示詞中..." });
          stepTimestamps.compileStart = Date.now();
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
          await db.updateBackgroundJob(jobId, { progress: 30, progressMessage: "正在生成中..." });

          // ── Generate step ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成`, status: "processing", detail: `正在生成${modalityLabel}...`, timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "progress", progress: 40, message: `${modalityLabel}生成中...` });

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
            // Pass reference images to generateImage for style-guided generation
            const originalImages: Array<{ url?: string; mimeType?: string }> = [];
            if (input.styleReferenceUrl) {
              originalImages.push({ url: input.styleReferenceUrl, mimeType: "image/png" });
            }
            if (input.vibeReferenceUrl) {
              originalImages.push({ url: input.vibeReferenceUrl, mimeType: "image/png" });
            }

            const imageResult = await withTimeout(
              generateImage({
                prompt: compiledPrompt,
                ...(originalImages.length > 0 ? { originalImages } : {}),
              }),
              120_000,
              "圖片生成"
            );
            resultUrl = imageResult.url;
            resultData.imageUrl = imageResult.url;
            resultData.aspectRatio = input.aspectRatio;
            resultData.negativePrompt = input.negativePrompt;
            resultData.styleReferenceUrl = input.styleReferenceUrl;
            resultData.vibeReferenceUrl = input.vibeReferenceUrl;
          }

          // ── Video: Gemini Veo SDK (text-to-video) ──
          if (input.generationType === "video" || input.generationType === "multimodal") {
            try {
              const videoCompiler = getVideoCompiler();
              const videoCompiled = videoCompiler.compile({
                blocks: [{
                  id: "main",
                  category: "subject" as const,
                  label: "main subject",
                  prompt: compiledPrompt.substring(0, 120),
                }],
                freePrompt: compiledPrompt,
                targetDurationSec: input.videoDurationSeconds || 5,
                forceCameraMode: "dolly_in",
                firstFrameUrl: input.firstFrameUrl || undefined,
                lastFrameUrl: input.lastFrameUrl || undefined,
                aspectRatio: "16:9",
              });
              const videoPrompt = videoCompiled.prompt || compiledPrompt;
              console.log(`[Wave1] Video prompt compiled (${videoPrompt.length} chars), calling Gemini Veo SDK...`);

              // Get Gemini API Key
              const geminiKey = (await import("./_core/env.validated")).getApiKey("GEMINI_API_KEY");
              if (!geminiKey) {
                throw new Error("GEMINI_API_KEY 未設定，無法生成影片");
              }

              // Use @google/genai SDK for reliable Veo API access
              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI({ apiKey: geminiKey });

              // Step 1: Submit video generation
              generationBus.emit(jobId, { type: "progress", progress: 45, message: "正在提交 Veo 影片生成..." });
              let operation = await ai.models.generateVideos({
                model: "veo-2.0-generate-001",
                prompt: videoPrompt,
                config: {
                  aspectRatio: "16:9",
                  numberOfVideos: 1,
                  personGeneration: "allow_all" as any,
                },
              });
              console.log(`[Wave1] Gemini Veo operation started: ${operation.name}`);

              // Step 2: Poll operation until done (max 5 min)
              const MAX_POLL_MS = 300_000;
              const POLL_INTERVAL = 10_000;
              const pollStart = Date.now();

              while (!operation.done && Date.now() - pollStart < MAX_POLL_MS) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL));
                operation = await ai.operations.getVideosOperation({ operation });
                const elapsed = Math.round((Date.now() - pollStart) / 1000);
                const pct = Math.min(85, 45 + Math.round((elapsed / 300) * 40));
                generationBus.emit(jobId, { type: "progress", progress: pct, message: `影片生成中... (${elapsed}s)` });
                console.log(`[Wave1] Veo still generating... (${elapsed}s)`);
              }

              if (!operation.done) {
                throw new Error("Gemini Veo 影片生成超時（5分鐘）");
              }
              console.log(`[Wave1] Veo operation done after ${Math.round((Date.now() - pollStart) / 1000)}s`);

              // Step 3: Extract video and upload to S3
              const generatedVideos = operation.response?.generatedVideos || [];
              if (generatedVideos.length === 0) {
                throw new Error("Gemini Veo 未回傳影片結果");
              }

              const genVideo = generatedVideos[0];
              const videoData = genVideo.video;
              if (!videoData || !videoData.uri) {
                throw new Error("Gemini Veo 影片 URI 缺失");
              }

              // Download video bytes via the file URI
              generationBus.emit(jobId, { type: "progress", progress: 88, message: "正在下載影片並上傳至雲端..." });
              const downloadUrl = videoData.uri.includes("key=") ? videoData.uri : `${videoData.uri}${videoData.uri.includes("?") ? "&" : "?"}key=${geminiKey}`;
              const videoBytes = await fetch(downloadUrl).then((r) => {
                if (!r.ok) throw new Error(`影片下載失敗: ${r.status}`);
                return r.arrayBuffer();
              });

              const videoKey = `videos/${userId}/${jobId}-${Date.now()}.mp4`;
              const { url: videoUrl } = await storagePut(
                videoKey,
                Buffer.from(videoBytes),
                "video/mp4"
              );

              resultData.videoUrl = videoUrl;
              resultData.videoStatus = "completed";
              resultData.videoDuration = 8;
              if (!resultUrl) resultUrl = videoUrl;
              console.log(`[Wave1] Video generation completed (Gemini Veo SDK): ${videoUrl}`);
            } catch (videoErr: any) {
              console.error("[Wave1] Video generation failed:", videoErr);
              resultData.videoStatus = "video_generation_failed";
              resultData.videoError = videoErr instanceof Error ? videoErr.message : String(videoErr);
              // Check if it's a quota/billing issue
              const errMsg = String(videoErr?.message || videoErr);
              if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("billing") || errMsg.includes("RESOURCE_EXHAUSTED")) {
                resultData.videoError = "Gemini Veo API 配額不足或未啟用付費方案，請至 Google AI Studio 確認帳戶餘額後重試";
              }
            }
            resultData.videoPrompt = compiledPrompt;
            resultData.firstFrameUrl = input.firstFrameUrl;
            resultData.lastFrameUrl = input.lastFrameUrl;
            resultData.characterRefUrl = input.characterRefUrl;
            resultData.cameraMotion = input.cameraMotion;
          }

          // ── Audio: Gemini Lyria 3 Music Generation ──
          if (input.generationType === "audio" || input.generationType === "multimodal") {
            try {
              const audioCompiler = getAudioCompiler();
              const audioCompiled = audioCompiler.compile({
                blocks: [{
                  id: "main",
                  category: "genre" as const,
                  label: input.musicStyle || "ambient",
                  prompt: input.musicStyle || "ambient healing",
                }],
                freePrompt: compiledPrompt,
                targetDurationSec: input.audioDuration || 120,
                instrumental: input.isInstrumental ?? true,
                lyrics: input.lyrics || undefined,
              });

              // Build the music prompt
              let musicPrompt = audioCompiled.prompt || `${input.musicStyle || "ambient healing"}, ${compiledPrompt.substring(0, 200)}`;
              if (input.isInstrumental) {
                musicPrompt += ". Instrumental only, no vocals.";
              }
              if (input.lyrics) {
                musicPrompt += `\n\n${input.lyrics}`;
              }
              console.log(`[Wave1] Audio prompt compiled (${musicPrompt.length} chars), calling Gemini Lyria 3...`);

              // Get Gemini API Key
              const geminiKey = (await import("./_core/env.validated")).getApiKey("GEMINI_API_KEY");
              if (!geminiKey) {
                throw new Error("GEMINI_API_KEY 未設定，無法生成音樂");
              }

              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI({ apiKey: geminiKey });

              // Use Lyria 3 Clip (30s) for short, Lyria 3 Pro for longer
              const useProModel = (input.audioDuration || 30) > 35;
              const modelId = useProModel ? "lyria-3-pro-preview" : "lyria-3-clip-preview";
              console.log(`[Wave1] Using Lyria model: ${modelId}`);

              generationBus.emit(jobId, { type: "progress", progress: 45, message: `正在生成音樂 (${modelId})...` });

              const musicResponse = await withTimeout(
                ai.models.generateContent({
                  model: modelId,
                  contents: musicPrompt,
                  config: {
                    responseModalities: ["AUDIO", "TEXT"],
                  } as any,
                }),
                180_000,
                "Lyria 音樂生成"
              );

              // Parse response: extract audio data and lyrics
              let audioBuffer: Buffer | null = null;
              let audioMimeType = "audio/mp3";
              let generatedLyrics = "";

              const parts = musicResponse.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if ((part as any).text) {
                  generatedLyrics += (part as any).text + "\n";
                } else if ((part as any).inlineData) {
                  const inlineData = (part as any).inlineData;
                  audioBuffer = Buffer.from(inlineData.data, "base64");
                  audioMimeType = inlineData.mimeType || "audio/mp3";
                }
              }

              if (audioBuffer && audioBuffer.length > 0) {
                // If raw PCM, wrap in WAV header for browser playback
                if (audioMimeType.includes("L16") || audioMimeType.includes("pcm")) {
                  const sr = 24000, ch = 1, bps = 16;
                  const ds = audioBuffer.length;
                  const wh = Buffer.alloc(44);
                  wh.write("RIFF", 0); wh.writeUInt32LE(36 + ds, 4);
                  wh.write("WAVE", 8); wh.write("fmt ", 12);
                  wh.writeUInt32LE(16, 16); wh.writeUInt16LE(1, 20);
                  wh.writeUInt16LE(ch, 22); wh.writeUInt32LE(sr, 24);
                  wh.writeUInt32LE(sr * ch * bps / 8, 28);
                  wh.writeUInt16LE(ch * bps / 8, 32); wh.writeUInt16LE(bps, 34);
                  wh.write("data", 36); wh.writeUInt32LE(ds, 40);
                  audioBuffer = Buffer.concat([wh, audioBuffer]);
                  audioMimeType = "audio/wav";
                }
                const ext = audioMimeType.includes("wav") ? "wav" : "mp3";
                const audioKey = `music/${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const { url: audioUrl } = await storagePut(audioKey, audioBuffer, audioMimeType);
                resultData.audioUrl = audioUrl;
                resultData.audioStatus = "completed";
                resultData.audioTitle = generatedLyrics.substring(0, 100) || "Healing Music";
                resultData.generatedLyrics = generatedLyrics;
                if (!resultUrl) resultUrl = audioUrl;
                console.log(`[Wave1] Lyria music generation completed: ${audioUrl} (${audioBuffer.length} bytes)`);
              } else {
                resultData.audioStatus = "audio_generation_failed";
                resultData.audioError = "Gemini Lyria 未回傳音訊資料";
                console.warn("[Wave1] Lyria returned no audio data");
              }
            } catch (audioErr: any) {
              console.error("[Wave1] Audio generation failed:", audioErr);
              resultData.audioStatus = "audio_generation_failed";
              const errMsg = String(audioErr?.message || audioErr);
              if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
                resultData.audioError = "Gemini Lyria API 配額不足，請至 Google AI Studio 確認帳戶餘額後重試";
              } else {
                resultData.audioError = audioErr instanceof Error ? audioErr.message : String(audioErr);
              }
            }
            resultData.musicStyle = input.musicStyle || "ambient healing";
            resultData.isInstrumental = input.isInstrumental;
            resultData.lyrics = input.lyrics;
            resultData.audioDuration = input.audioDuration;
            resultData.audioEnergy = input.audioEnergy;
          }

          // ── Voice: Gemini TTS (Text-to-Speech) ──
          if (input.generationType === "voice") {
            try {
              const voiceCompiler = getVoiceCompiler();
              const voiceCompiled = voiceCompiler.compile({
                script: input.voiceText || input.prompt,
                moodBlock: input.voiceEmotionType ? {
                  blockId: "emotion-override",
                  label: input.voiceEmotionType,
                  prompt: input.voiceEmotionType,
                  isCustom: false,
                } : undefined,
                voiceId: input.voiceModelId || undefined,
                rateOverride: input.voiceSpeed ? `${Math.round(input.voiceSpeed * 100)}%` : undefined,
                enableHesitation: true,
              });
              const ttsText = voiceCompiled.plainText || input.voiceText || input.prompt;
              console.log(`[Wave1] Voice compiled: ${ttsText.length} chars, calling Gemini TTS...`);

              // Get Gemini API Key
              const geminiKey = (await import("./_core/env.validated")).getApiKey("GEMINI_API_KEY");
              if (!geminiKey) {
                throw new Error("GEMINI_API_KEY 未設定，無法生成語音");
              }

              const { GoogleGenAI } = await import("@google/genai");
              const ai = new GoogleGenAI({ apiKey: geminiKey });

              // Map emotion type to Gemini TTS voice
              const voiceMap: Record<string, string> = {
                "warm": "Kore",
                "calm": "Aoede",
                "cheerful": "Puck",
                "serious": "Charon",
                "gentle": "Leda",
                "energetic": "Fenrir",
                "soothing": "Enceladus",
                "clear": "Iapetus",
                "bright": "Zephyr",
                "smooth": "Algieba",
              };
              const voiceName = voiceMap[input.voiceEmotionType || ""] || "Kore";

              // Build TTS prompt with style instruction
              let ttsPrompt = ttsText;
              if (input.voiceEmotionType) {
                ttsPrompt = `Say in a ${input.voiceEmotionType} tone:\n${ttsText}`;
              }
              if (input.voiceSpeed && input.voiceSpeed !== 1.0) {
                const speedDesc = input.voiceSpeed < 0.8 ? "slowly" : input.voiceSpeed > 1.2 ? "quickly" : "at moderate pace";
                ttsPrompt = `Say ${speedDesc}:\n${ttsPrompt}`;
              }

              generationBus.emit(jobId, { type: "progress", progress: 50, message: `正在生成語音 (Gemini TTS, ${voiceName})...` });

              const ttsResponse = await withTimeout(
                ai.models.generateContent({
                  model: "gemini-2.5-flash-preview-tts",
                  contents: ttsPrompt,
                  config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: voiceName,
                        },
                      },
                    },
                  } as any,
                }),
                60_000,
                "Gemini TTS"
              );

              // Parse TTS response
              const ttsParts = ttsResponse.candidates?.[0]?.content?.parts || [];
              let voiceBuffer: Buffer | null = null;
              let voiceMimeType = "audio/wav";

              for (const part of ttsParts) {
                if ((part as any).inlineData) {
                  const inlineData = (part as any).inlineData;
                  voiceBuffer = Buffer.from(inlineData.data, "base64");
                  voiceMimeType = inlineData.mimeType || "audio/wav";
                }
              }

              if (voiceBuffer && voiceBuffer.length > 0) {
                // Gemini TTS returns raw PCM (audio/L16;codec=pcm;rate=24000)
                // Wrap in WAV header for browser playback
                if (voiceMimeType.includes("L16") || voiceMimeType.includes("pcm")) {
                  const sampleRate = 24000;
                  const numChannels = 1;
                  const bitsPerSample = 16;
                  const dataSize = voiceBuffer.length;
                  const wavHeader = Buffer.alloc(44);
                  wavHeader.write("RIFF", 0);
                  wavHeader.writeUInt32LE(36 + dataSize, 4);
                  wavHeader.write("WAVE", 8);
                  wavHeader.write("fmt ", 12);
                  wavHeader.writeUInt32LE(16, 16); // fmt chunk size
                  wavHeader.writeUInt16LE(1, 20);  // PCM format
                  wavHeader.writeUInt16LE(numChannels, 22);
                  wavHeader.writeUInt32LE(sampleRate, 24);
                  wavHeader.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
                  wavHeader.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
                  wavHeader.writeUInt16LE(bitsPerSample, 34);
                  wavHeader.write("data", 36);
                  wavHeader.writeUInt32LE(dataSize, 40);
                  voiceBuffer = Buffer.concat([wavHeader, voiceBuffer]);
                  voiceMimeType = "audio/wav";
                  console.log(`[Wave1] Wrapped PCM in WAV header (${voiceBuffer.length} bytes total)`);
                }
                const ext = voiceMimeType.includes("wav") ? "wav" : "mp3";
                const audioKey = `voice/${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const { url: voiceUrl } = await storagePut(audioKey, voiceBuffer, voiceMimeType);
                resultData.voiceUrl = voiceUrl;
                resultData.voiceStatus = "completed";
                resultData.voiceSsml = voiceCompiled.ssml;
                resultData.voiceEstimatedDuration = voiceCompiled.estimatedDurationSec;
                resultData.voiceEngine = "gemini-tts";
                resultData.voiceVoiceName = voiceName;
                if (!resultUrl) resultUrl = voiceUrl;
                console.log(`[Wave1] Gemini TTS completed: ${voiceUrl} (${voiceBuffer.length} bytes, voice: ${voiceName})`);
              } else {
                resultData.voiceStatus = "voice_generation_failed";
                resultData.voiceError = "Gemini TTS 未回傳音訊資料";
              }
            } catch (voiceErr: any) {
              console.error("[Wave1] Voice generation failed:", voiceErr);
              resultData.voiceStatus = "voice_generation_failed";
              const errMsg = String(voiceErr?.message || voiceErr);
              if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
                resultData.voiceError = "Gemini TTS API 配額不足，請至 Google AI Studio 確認帳戶餘額後重試";
              } else {
                resultData.voiceError = voiceErr instanceof Error ? voiceErr.message : String(voiceErr);
              }
            }
            resultData.voiceModelId = input.voiceModelId;
            resultData.voiceText = input.voiceText;
            resultData.voiceSpeed = input.voiceSpeed;
            resultData.voiceStability = input.voiceStability;
            resultData.voiceEmotionType = input.voiceEmotionType;
            resultData.voiceEmotionIntensity = input.voiceEmotionIntensity;
          }

          // ── Post-generation events ──
          stepTimestamps.generateDone = Date.now();
          const generateMs = stepTimestamps.generateDone - (stepTimestamps.compileDone || stepTimestamps.start);
          generationBus.emit(jobId, { type: "thought-update", node: { id: "generate", label: `${modalityLabel}生成`, status: resultUrl ? "completed" : "completed", detail: resultUrl ? `生成成功（${generateMs}ms）` : `已加入佇列（${generateMs}ms）`, timestamp: stepTimestamps.generateDone } });
          generationBus.emit(jobId, { type: "progress", progress: 70, message: "生成完成，處理後續..." });

          // ── Quota logging ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "quota", label: "配額扣除", status: "completed", detail: "扣除 1 次生成配額", timestamp: Date.now() } });
          generationBus.emit(jobId, { type: "progress", progress: 80, message: "配額已扣除" });

          // Quota was already atomically deducted before generation started.
          // Log usage
          await db.createApiUsageLog({
            userId,
            requestType: input.generationType === "image" ? "image_generation" :
              input.generationType === "video" ? "video_generation" :
              input.generationType === "audio" ? "audio_generation" :
              input.generationType === "voice" ? "voice_dubbing" : "image_generation",
            apiProvider: input.mode === "lightning" ? "gemini_flash" : "gemini_pro",
            tokensUsed: 1000,
            estimatedCostUsd: "0.005",
            responseStatus: "success",
            generationsDeducted: 1,
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
              visualWeight,
              controlNetParams,
              // ── Image-specific ──
              ...(input.generationType === "image" && {
                aspectRatio: input.aspectRatio,
                negativePrompt: input.negativePrompt,
                styleReferenceUrl: input.styleReferenceUrl,
                vibeReferenceUrl: input.vibeReferenceUrl,
              }),
              // ── Video-specific ──
              ...(input.generationType === "video" && {
                videoDurationSeconds: input.videoDurationSeconds,
                firstFrameUrl: input.firstFrameUrl,
                lastFrameUrl: input.lastFrameUrl,
                characterRefUrl: input.characterRefUrl,
                cameraMotion: input.cameraMotion,
              }),
              // ── Audio-specific ──
              ...(input.generationType === "audio" && {
                musicStyle: input.musicStyle,
                isInstrumental: input.isInstrumental,
                lyrics: input.lyrics,
                audioDuration: input.audioDuration,
                audioEnergy: input.audioEnergy,
              }),
              // ── Voice-specific ──
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

          // ── History saved event ──
          generationBus.emit(jobId, { type: "thought-update", node: { id: "history", label: "歷史紀錄", status: "completed", detail: "已儲存至生成歷史", timestamp: Date.now() } });
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
            { id: "quota", label: "配額扣除", status: "completed" as const, detail: "扣除 1 次生成配額", timestamp: Date.now() - 100 },
            { id: "history", label: "歷史紀錄", status: "completed" as const, detail: "已儲存至生成歷史", timestamp: Date.now() },
          ];

          // Emit final complete event via SSE
          generationBus.emit(jobId, { type: "complete", thoughtChain });
          // Clean up listeners after a short delay
          setTimeout(() => generationBus.cleanup(jobId), 2000);

          return { jobId, resultUrl, resultData, compiledPrompt, thoughtChain };
        } catch (error) {
          // Transactional integrity: refund quota on failure
          await db.refundUserQuota(userId, 1);
          const errMsg = error instanceof Error ? error.message : "生成失敗";
          const isTimeout = /超時|timeout|timed? ?out|ETIMEDOUT|aborted/i.test(errMsg);
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
    myAssets: protectedProcedure.query(async ({ ctx }) => {
      return db.getDigitalAssetsByUser(ctx.user.id);
    }),

    teamAssets: protectedProcedure.query(async () => {
      return db.getTeamSharedAssets();
    }),

    toggleVisibility: protectedProcedure
      .input(z.object({
        id: z.number(),
        visibility: z.enum(["private", "team_shared"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateDigitalAsset(input.id, { visibility: input.visibility });
        // Reward credits for sharing
        if (input.visibility === "team_shared") {
          await db.refundUserQuota(ctx.user.id, 2);
        }
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
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
      return db.getTeamSharedModels();
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        modelType: z.enum(["image_subject", "voice_clone", "style_lora"]).default("image_subject"),
        triggerWord: z.string().optional(),
        epochs: z.number().optional(),
        learningRate: z.number().optional(),
        batchSize: z.number().optional(),
        fileUrl: z.string().optional(),
        fileKey: z.string().optional(),
        datasetImages: z.array(z.object({
          url: z.string(),
          fileKey: z.string(),
          angle: z.enum(["front", "side", "back", "expression", "other"]),
          caption: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const configJson: Record<string, unknown> = {
          triggerWord: input.triggerWord,
          epochs: input.epochs ?? 20,
          learningRate: input.learningRate ?? 0.0001,
          batchSize: input.batchSize ?? 4,
          datasetImages: input.datasetImages,
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

        // 非同步啟動 LoRA 訓練（背景執行，不阻塞此 API 回應）
        if (input.datasetImages && input.datasetImages.length >= 3 && process.env.REPLICATE_API_TOKEN) {
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
        } else if (!process.env.REPLICATE_API_TOKEN) {
          console.warn(`[LoraTrainer] REPLICATE_API_TOKEN not set — model ${modelId} will remain queued`);
        }

        return { id: modelId, jobId };
      }),

    captionImages: protectedProcedure
      .input(z.object({
        images: z.array(z.object({
          url: z.string(),
          angle: z.enum(["front", "side", "back", "expression", "other"]),
        })),
      }))
      .mutation(async ({ input }) => {
        // Use LLM to generate captions for each image
        const captions: string[] = [];
        for (const img of input.images) {
          try {
            const result = await withTimeout(invokeLLM({
              messages: [
                {
                  role: "system",
                  content: "你是一位專業的圖片描述生成器。請為以下圖片生成一段簡短的英文描述（約 20-40 字），適合用於 LoRA 訓練的標註。描述應包含主體特徵、姿勢、表情、服裝等細節。",
                },
                {
                  role: "user",
                  content: [
                    { type: "text" as const, text: `角度：${img.angle}。請生成訓練標註描述。` },
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
        await db.updateFineTunedModel(input.id, { visibility: input.visibility });
        if (input.visibility === "team_shared") {
          await db.refundUserQuota(ctx.user.id, 3);
        }
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteFineTunedModel(input.id);
        return { success: true };
      }),
  }),

  // ─── Project Notes ────────────────────────────────────────────────────────

  notes: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getProjectNotesByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        content: z.string().optional(),
        scriptJson: z.any().optional(),
        noteType: z.enum(["note", "script", "calendar_event"]).default("note"),
        scheduledDate: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createProjectNote({
          userId: ctx.user.id,
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          noteType: input.noteType,
          scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : undefined,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        content: z.string().optional(),
        scriptJson: z.any().optional(),
        scheduledDate: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateProjectNote(input.id, {
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          ...(input.scheduledDate !== undefined
            ? { scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : null }
            : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
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
      .input(z.object({ itemType: z.enum(["character", "scene"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (input?.itemType) {
          return db.getVaultItemsByType(ctx.user.id, input.itemType);
        }
        return db.getVaultItemsByUser(ctx.user.id);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        itemType: z.enum(["character", "scene"]),
        imageUrl: z.string().min(1),
        fileKey: z.string().optional(),
        tags: z.array(z.string()).optional(),
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
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateVaultItem(input.id, {
          name: input.name,
          tags: input.tags,
          metadata: input.metadata,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteVaultItem(input.id);
        return { success: true };
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
        return db.getHistoryByUser(ctx.user.id, input?.limit ?? 50);
      }),

    bookmarked: protectedProcedure.query(async ({ ctx }) => {
      return db.getBookmarkedHistory(ctx.user.id);
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
      const costSummary = await db.getUserCostSummary(ctx.user.id);
      const recentLogs = await db.getUsageLogsByUser(ctx.user.id, 10);
      return {
        remainingGenerations: ctx.user.remainingGenerations,
        ...costSummary,
        recentLogs,
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
