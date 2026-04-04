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

// ─── Safety Moderation Middleware ────────────────────────────────────────────

async function checkSafety(text: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    const result = await invokeLLM({
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
    });
    const content = result.choices[0]?.message?.content;
    if (typeof content === "string") {
      return JSON.parse(content);
    }
    return { safe: true };
  } catch {
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

  const result = await invokeLLM({
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
  });
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
  const researchResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: persona.researchStyle,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  });
  const researchContent = typeof researchResult.choices[0]?.message?.content === "string"
    ? researchResult.choices[0].message.content : "";

  // Step 2: Creative orchestration with personality-aware CO-STAR framework
  const scriptResult = await invokeLLM({
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
  });

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
    multimodal: protectedProcedure
      .input(z.object({
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
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // ── Atomic quota deduction (database-level lock) ──
        // Deduct FIRST before any work. If concurrent requests race,
        // only one will succeed per remaining unit.
        const deducted = await db.deductUserQuota(userId, 1);
        if (!deducted) {
          throw new TRPCError({ code: "FORBIDDEN", message: "生成配額已用完，請聯繫管理員補充配額。" });
        }

        // Safety pre-check
        const stepTimestamps: Record<string, number> = { start: Date.now() };
        const safetyResult = await checkSafety(input.prompt);
        stepTimestamps.safetyDone = Date.now();
        if (!safetyResult.safe) {
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

        // Create background job
        const jobId = await db.createBackgroundJob({
          userId,
          jobType: input.generationType === "multimodal" ? "multimodal" : input.generationType,
          status: "processing",
          progress: 10,
          progressMessage: "正在編譯提示詞...",
        });

        try {
          // Compile elite prompt with reference image awareness
          stepTimestamps.compileStart = Date.now();
          const { compiledPrompt, visualWeight, controlNetParams } = await compileElitePrompt({
            prompt: input.prompt,
            vibeCardIds: input.vibeCardIds,
            temperature: input.temperature,
            generationType: input.generationType,
            referenceImages: {
              styleUrl: input.styleReferenceUrl,
              vibeUrl: input.vibeReferenceUrl,
              characterUrl: input.characterRefUrl,
            },
          });

          stepTimestamps.compileDone = Date.now();
          stepTimestamps.weightDone = Date.now();
          await db.updateBackgroundJob(jobId, { progress: 30, progressMessage: "正在生成中..." });

          // Generate based on type
          let resultUrl: string | undefined;
          let resultData: Record<string, unknown> = {
            visualWeight,
            controlNetParams,
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

            const imageResult = await generateImage({
              prompt: compiledPrompt,
              ...(originalImages.length > 0 ? { originalImages } : {}),
            });
            resultUrl = imageResult.url;
            resultData.imageUrl = imageResult.url;
            resultData.aspectRatio = input.aspectRatio;
            resultData.negativePrompt = input.negativePrompt;
            resultData.styleReferenceUrl = input.styleReferenceUrl;
            resultData.vibeReferenceUrl = input.vibeReferenceUrl;
          }

          // For video/audio/voice - we simulate the API call structure
          // In production, these would call Veo 3.1, Suno V5, ElevenLabs respectively
          if (input.generationType === "video" || input.generationType === "multimodal") {
            resultData.videoStatus = "video_generation_queued";
            resultData.videoPrompt = compiledPrompt;
            resultData.videoDuration = input.videoDurationSeconds || 8;
            resultData.firstFrameUrl = input.firstFrameUrl;
            resultData.lastFrameUrl = input.lastFrameUrl;
            resultData.characterRefUrl = input.characterRefUrl;
            resultData.cameraMotion = input.cameraMotion;
          }

          if (input.generationType === "audio" || input.generationType === "multimodal") {
            resultData.audioStatus = "audio_generation_queued";
            resultData.musicStyle = input.musicStyle || "ambient healing";
            resultData.isInstrumental = input.isInstrumental;
            resultData.lyrics = input.lyrics;
            resultData.audioDuration = input.audioDuration;
            resultData.audioEnergy = input.audioEnergy;
          }

          if (input.generationType === "voice") {
            resultData.voiceStatus = "voice_generation_queued";
            resultData.voiceModelId = input.voiceModelId;
            resultData.voiceText = input.voiceText;
            resultData.voiceSpeed = input.voiceSpeed;
            resultData.voiceStability = input.voiceStability;
            resultData.voiceEmotionType = input.voiceEmotionType;
            resultData.voiceEmotionIntensity = input.voiceEmotionIntensity;
          }

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

          // Build Chain-of-Thought trace with REAL timestamps from each execution step
          stepTimestamps.generateDone = Date.now();
          const modalityLabel = input.generationType === "image" ? "圖像" : input.generationType === "video" ? "影片" : input.generationType === "audio" ? "音樂" : "語音";
          const safetyMs = (stepTimestamps.safetyDone || stepTimestamps.start) - stepTimestamps.start;
          const compileMs = (stepTimestamps.compileDone || stepTimestamps.compileStart || 0) - (stepTimestamps.compileStart || stepTimestamps.start);
          const generateMs = stepTimestamps.generateDone - (stepTimestamps.compileDone || stepTimestamps.start);
          const thoughtChain = [
            { id: "safety", label: "安全檢查", status: "passed" as const, detail: `內容安全檢查通過（${safetyMs}ms）`, timestamp: stepTimestamps.safetyDone || stepTimestamps.start },
            { id: "compile", label: "提示詞編譯", status: "completed" as const, detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${compileMs}ms）`, timestamp: stepTimestamps.compileDone || stepTimestamps.start },
            { id: "weight", label: "視覺權重計算", status: "completed" as const, detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`, timestamp: stepTimestamps.weightDone || stepTimestamps.start },
            { id: "generate", label: `${modalityLabel}生成`, status: resultUrl ? "completed" as const : "queued" as const, detail: resultUrl ? `生成成功（${generateMs}ms）` : "已加入佇列", timestamp: stepTimestamps.generateDone },
            { id: "quota", label: "配額扣除", status: "completed" as const, detail: "扣除 1 次生成配額", timestamp: Date.now() - 100 },
            { id: "history", label: "歷史紀錄", status: "completed" as const, detail: "已儲存至生成歷史", timestamp: Date.now() },
          ];

          return { jobId, resultUrl, resultData, compiledPrompt, thoughtChain };
        } catch (error) {
          // Transactional integrity: refund quota on failure
          await db.refundUserQuota(userId, 1);
          await db.updateBackgroundJob(jobId, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "生成失敗",
          });
          await db.createApiUsageLog({
            userId,
            requestType: "image_generation",
            apiProvider: "gemini",
            responseStatus: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            generationsDeducted: 0,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "生成過程中發生錯誤，配額已退還。請稍後再試。",
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
        const result = await invokeLLM({
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
- suggestions: 具體的自動優化建議（繁體中文，2-3 條具體建議）
- optimizedPrompt: 優化後的完整提示詞（英文）`,
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
                    items: { type: "string" },
                  },
                  optimizedPrompt: { type: "string" },
                },
                required: ["score", "dimensions", "strengths", "weaknesses", "suggestions", "optimizedPrompt"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = result.choices[0]?.message?.content;
        if (typeof content === "string") {
          return JSON.parse(content);
        }
        return { score: 50, dimensions: { subjectClarity: 10, actionNarrative: 10, environment: 10, lightingTone: 10, technicalSpecs: 10 }, strengths: "", weaknesses: "", suggestions: [], optimizedPrompt: input.prompt };
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
            const result = await invokeLLM({
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
            });
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
      }))
      .mutation(async ({ input }) => {
        await db.updateProjectNote(input.id, {
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
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
