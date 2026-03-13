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
}): Promise<string> {
  const vibeDescriptions = payload.vibeCardIds.join(", ");
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
7. 確保人物描述包含：perfectly symmetrical anatomy, flawless proportions, natural pose`,
      },
      { role: "user", content: payload.prompt },
    ],
  });
  const content = result.choices[0]?.message?.content;
  return typeof content === "string" ? content : payload.prompt;
}

// ─── CO-STAR Director AI ─────────────────────────────────────────────────────

async function runDirectorAI(messages: Array<{ role: string; content: string }>, saveToNotes: boolean, userId: number) {
  // Step 1: Use LLM for factual grounding (simulating Perplexity-like research)
  const researchResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位專業的研究助手。根據使用者的創意需求，提供相關的事實資料、趨勢和靈感參考。
用繁體中文回覆，提供具體、有用的資訊。`,
      },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
  });
  const researchContent = typeof researchResult.choices[0]?.message?.content === "string"
    ? researchResult.choices[0].message.content : "";

  // Step 2: Creative orchestration with CO-STAR framework
  const scriptResult = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是「導演 AI」，使用 CO-STAR 框架來創作結構化的多媒體腳本。

CO-STAR 框架：
- Context（背景）：場景的背景設定
- Situation（情境）：當前的情境描述
- Task（任務）：需要完成的創作任務
- Action（行動）：具體的執行步驟
- Result（結果）：預期的成果

基於以下研究資料，創作一個結構化的 JSON 腳本：
${researchContent}

輸出 JSON 格式必須包含：
- context, situation, task, action, result（CO-STAR 各欄位）
- visualPrompt：給 Veo 3.1 的視覺提示詞（英文，包含正面解剖學約束）
- audioScript：給 ElevenLabs 的語音腳本（繁體中文）
- musicVibe：給 Suno V5 的音樂風格描述（英文）`,
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
          },
          required: ["context", "situation", "task", "action", "result", "visualPrompt", "audioScript", "musicVibe"],
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
    script = { context: "", situation: "", task: "", action: "", result: "", visualPrompt: "", audioScript: "", musicVibe: "" };
  }

  // Save to project notes if requested
  if (saveToNotes && userId) {
    await db.createProjectNote({
      userId,
      title: `導演 AI 腳本 - ${new Date().toLocaleDateString("zh-TW")}`,
      content: researchContent,
      scriptJson: script,
      noteType: "script",
    });
  }

  return { research: researchContent, script };
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
        videoDurationSeconds: z.number().optional(),
        voiceModelId: z.string().optional(),
        musicStyle: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // Check quota
        const user = await db.getUserByOpenId(ctx.user.openId);
        if (!user || user.remainingGenerations <= 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "生成配額已用完，請聯繫管理員補充配額。" });
        }

        // Safety pre-check
        const safetyResult = await checkSafety(input.prompt);
        if (!safetyResult.safe) {
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
          // Compile elite prompt
          const compiledPrompt = await compileElitePrompt({
            prompt: input.prompt,
            vibeCardIds: input.vibeCardIds,
            temperature: input.temperature,
            generationType: input.generationType,
          });

          await db.updateBackgroundJob(jobId, { progress: 30, progressMessage: "正在生成中..." });

          // Generate based on type
          let resultUrl: string | undefined;
          let resultData: Record<string, unknown> = {};

          if (input.generationType === "image" || input.generationType === "multimodal") {
            const imageResult = await generateImage({ prompt: compiledPrompt });
            resultUrl = imageResult.url;
            resultData.imageUrl = imageResult.url;
          }

          // For video/audio/voice - we simulate the API call structure
          // In production, these would call Veo 3.1, Suno V5, ElevenLabs respectively
          if (input.generationType === "video" || input.generationType === "multimodal") {
            resultData.videoStatus = "video_generation_queued";
            resultData.videoPrompt = compiledPrompt;
            resultData.videoDuration = input.videoDurationSeconds || 8;
          }

          if (input.generationType === "audio" || input.generationType === "multimodal") {
            resultData.audioStatus = "audio_generation_queued";
            resultData.musicStyle = input.musicStyle || "ambient healing";
          }

          if (input.generationType === "voice") {
            resultData.voiceStatus = "voice_generation_queued";
            resultData.voiceModelId = input.voiceModelId;
          }

          // Deduct quota
          await db.deductUserQuota(userId, 1);

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

          // Update job
          await db.updateBackgroundJob(jobId, {
            status: "completed",
            progress: 100,
            progressMessage: "生成完成！",
            resultJson: resultData,
          });

          return { jobId, resultUrl, resultData, compiledPrompt };
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

  // ─── Director AI Chat ────────────────────────────────────────────────────

  director: router({
    chat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.string(),
          content: z.string(),
        })),
        saveToNotes: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        return runDirectorAI(input.messages, input.saveToNotes, ctx.user.id);
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
      }))
      .mutation(async ({ ctx, input }) => {
        const configJson = {
          triggerWord: input.triggerWord,
          epochs: input.epochs ?? 20,
          learningRate: input.learningRate ?? 0.0001,
          batchSize: input.batchSize ?? 4,
        };
        const id = await db.createFineTunedModel({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          modelType: input.modelType,
          fileUrl: input.fileUrl,
          fileKey: input.fileKey,
          configJson,
        });
        return { id };
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

  // ─── Admin Dashboard ──────────────────────────────────────────────────────

  admin: router({
    allUsers: adminProcedure.query(async () => {
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
