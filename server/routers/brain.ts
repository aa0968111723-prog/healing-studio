/**
 * Brain Configuration Router
 * ────────────────────────────────────────────────────────────────────────────
 * CRUD 操作 user_ai_brain 表，提供大腦組態管理 API。
 * 不暴露任何 API Key。
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  userAiBrain,
  userModelSwitchLogs,
} from "../../drizzle/schema";
import {
  getHealthStatus,
  getHealthSnapshot,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
  type ReasoningBrainSlot,
  type GenerationEngineSlot,
} from "../middleware/brainContext";
import { TRPCError } from "@trpc/server";

// ═══════════════════════════════════════════════════════════════════════════
// Model Catalog (白皮書規格)
// ═══════════════════════════════════════════════════════════════════════════

/** 5 大推理大腦備選清單 */
export const REASONING_MODEL_CATALOG = {
  director: {
    label: "全站導演",
    description: "統籌創作流程、分鏡、敘事結構",
    options: [
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "gemini-pro", label: "Gemini Pro", tier: "standard" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "premium" },
      { value: "claude-3-opus", label: "Claude 3 Opus", tier: "premium" },
      { value: "gpt-4o", label: "GPT-4o", tier: "premium" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "standard" },
    ],
  },
  analyst: {
    label: "新聞過濾",
    description: "數據分析、趨勢洞察、新聞摘要",
    options: [
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Flash", tier: "fast" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "fast" },
      { value: "gpt-4o", label: "GPT-4o", tier: "standard" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "standard" },
    ],
  },
  storyteller: {
    label: "編譯器",
    description: "提示詞編譯、文案撰寫、故事展開",
    options: [
      { value: "gpt-4o", label: "GPT-4o", tier: "premium" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "premium" },
      { value: "claude-3-opus", label: "Claude 3 Opus", tier: "premium" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "standard" },
    ],
  },
  technician: {
    label: "光球語調",
    description: "VisualSoul 對話風格、OARS 語句生成",
    options: [
      { value: "gpt-4o", label: "GPT-4o", tier: "premium" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "fast" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "premium" },
      { value: "gemini-pro", label: "Gemini Pro", tier: "standard" },
    ],
  },
  curator: {
    label: "RAG 向量",
    description: "風格推薦、美學判斷、靈感策展",
    options: [
      { value: "gpt-4o", label: "GPT-4o", tier: "premium" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "fast" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "standard" },
    ],
  },
} as const;

/** 4 大生成引擎備選清單 */
export const GENERATION_ENGINE_CATALOG = {
  imageEngine: {
    label: "圖片引擎",
    description: "AI 圖像生成",
    options: [
      { value: "flux-pro", label: "Flux Pro (dev)", tier: "premium" },
      { value: "flux-schnell", label: "Flux Schnell", tier: "fast" },
      { value: "stable-diffusion-xl", label: "SDXL 1.0", tier: "standard" },
      { value: "dall-e-3", label: "DALL·E 3", tier: "premium" },
      { value: "midjourney-v6", label: "Midjourney V6", tier: "premium" },
    ],
  },
  videoEngine: {
    label: "影片引擎",
    description: "AI 影片生成",
    options: [
      { value: "kling-v1-5", label: "Veo 3.1 (Kling)", tier: "premium" },
      { value: "kling-v1", label: "Kling V1", tier: "standard" },
      { value: "runway-gen3", label: "Luma (Runway Gen3)", tier: "premium" },
      { value: "minimax-video", label: "MiniMax Video", tier: "standard" },
    ],
  },
  audioEngine: {
    label: "音樂引擎",
    description: "AI 音樂/音效生成",
    options: [
      { value: "suno-v4", label: "Suno V4", tier: "premium" },
      { value: "suno-v3.5", label: "Suno V3.5", tier: "standard" },
      { value: "udio-v1", label: "Udio V1", tier: "standard" },
    ],
  },
  voiceEngine: {
    label: "配音引擎",
    description: "AI 語音合成",
    options: [
      { value: "elevenlabs-v2", label: "ElevenLabs V2", tier: "premium" },
      { value: "elevenlabs-v1", label: "ElevenLabs V1", tier: "standard" },
      { value: "azure-tts", label: "Azure TTS", tier: "standard" },
    ],
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

export const brainRouter = router({
  /** 取得模型目錄（不需要登入） */
  catalog: protectedProcedure.query(() => ({
    reasoning: REASONING_MODEL_CATALOG,
    generation: GENERATION_ENGINE_CATALOG,
  })),

  /** 取得使用者的大腦組態 */
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫不可用" });

    const rows = await db
      .select()
      .from(userAiBrain)
      .where(eq(userAiBrain.userId, ctx.user.id))
      .limit(1);

    const row = rows[0] ?? null;

    // 組裝回傳結構（不暴露任何 API Key）
    const reasoningSlots: ReasoningBrainSlot[] = ["director", "analyst", "storyteller", "technician", "curator"];
    const engineSlots: GenerationEngineSlot[] = ["imageEngine", "videoEngine", "audioEngine", "voiceEngine"];

    const reasoning: Record<string, unknown> = {};
    for (const slot of reasoningSlots) {
      const defaults = DEFAULT_REASONING_BRAINS[slot];
      const model = row ? String((row as any)[`${slot}Model`] ?? defaults.model) : defaults.model;
      reasoning[slot] = {
        model,
        temperature: row ? Number((row as any)[`${slot}Temperature`] ?? defaults.temperature) : defaults.temperature,
        topP: row ? Number((row as any)[`${slot}TopP`] ?? defaults.topP) : defaults.topP,
        systemPrompt: row ? (row as any)[`${slot}SystemPrompt`] ?? null : null,
        enabled: row ? Boolean((row as any)[`${slot}Enabled`] ?? true) : true,
        healthy: getHealthStatus(model),
      };
    }

    const generation: Record<string, unknown> = {};
    for (const slot of engineSlots) {
      const defaults = DEFAULT_GENERATION_ENGINES[slot];
      const engine = row ? String((row as any)[slot] ?? defaults.engine) : defaults.engine;
      generation[slot] = {
        engine,
        params: row ? (row as any)[`${slot}Params`] ?? null : null,
        enabled: row ? Boolean((row as any)[`${slot}Enabled`] ?? true) : true,
        healthy: getHealthStatus(engine),
      };
    }

    return {
      hasCustomConfig: row !== null,
      reasoning,
      generation,
    };
  }),

  /** 更新使用者的大腦組態（upsert） */
  upsert: protectedProcedure
    .input(
      z.object({
        // 推理大腦
        directorModel: z.string().optional(),
        directorTemperature: z.number().min(0).max(1).optional(),
        directorTopP: z.number().min(0).max(1).optional(),
        directorSystemPrompt: z.string().nullable().optional(),
        directorEnabled: z.boolean().optional(),
        analystModel: z.string().optional(),
        analystTemperature: z.number().min(0).max(1).optional(),
        analystTopP: z.number().min(0).max(1).optional(),
        analystSystemPrompt: z.string().nullable().optional(),
        analystEnabled: z.boolean().optional(),
        storytellerModel: z.string().optional(),
        storytellerTemperature: z.number().min(0).max(1).optional(),
        storytellerTopP: z.number().min(0).max(1).optional(),
        storytellerSystemPrompt: z.string().nullable().optional(),
        storytellerEnabled: z.boolean().optional(),
        technicianModel: z.string().optional(),
        technicianTemperature: z.number().min(0).max(1).optional(),
        technicianTopP: z.number().min(0).max(1).optional(),
        technicianSystemPrompt: z.string().nullable().optional(),
        technicianEnabled: z.boolean().optional(),
        curatorModel: z.string().optional(),
        curatorTemperature: z.number().min(0).max(1).optional(),
        curatorTopP: z.number().min(0).max(1).optional(),
        curatorSystemPrompt: z.string().nullable().optional(),
        curatorEnabled: z.boolean().optional(),
        // 生成引擎
        imageEngine: z.string().optional(),
        imageEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
        imageEngineEnabled: z.boolean().optional(),
        videoEngine: z.string().optional(),
        videoEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
        videoEngineEnabled: z.boolean().optional(),
        audioEngine: z.string().optional(),
        audioEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
        audioEngineEnabled: z.boolean().optional(),
        voiceEngine: z.string().optional(),
        voiceEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
        voiceEngineEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫不可用" });

      // Build update set from non-undefined fields
      const updateSet: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          // Convert temperature/topP numbers to string for decimal columns
          if (key.endsWith("Temperature") || key.endsWith("TopP")) {
            updateSet[key] = String(value);
          } else {
            updateSet[key] = value;
          }
        }
      }

      if (Object.keys(updateSet).length === 0) {
        return { success: true, message: "無變更" };
      }

      // Upsert
      const existing = await db
        .select({ id: userAiBrain.id })
        .from(userAiBrain)
        .where(eq(userAiBrain.userId, ctx.user.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(userAiBrain)
          .set(updateSet)
          .where(eq(userAiBrain.userId, ctx.user.id));
      } else {
        await db.insert(userAiBrain).values({
          userId: ctx.user.id,
          ...updateSet,
        } as any);
      }

      return { success: true, message: "大腦組態已更新" };
    }),

  /** 切換單一模型/引擎（含日誌記錄） */
  switchModel: protectedProcedure
    .input(
      z.object({
        brainSlot: z.string(),
        fromModel: z.string(),
        toModel: z.string(),
        reason: z.string().optional(),
        switchSource: z.enum(["manual", "soul_recommendation", "auto_fallback", "ab_test"]).default("manual"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫不可用" });

      // 寫入切換日誌
      await db.insert(userModelSwitchLogs).values({
        userId: ctx.user.id,
        brainSlot: input.brainSlot as any,
        fromModel: input.fromModel,
        toModel: input.toModel,
        reason: input.reason ?? `手動切換 ${input.brainSlot}`,
        switchSource: input.switchSource as any,
      } as any);

      // 更新對應的模型欄位
      const updateField = input.brainSlot.endsWith("Engine")
        ? input.brainSlot
        : `${input.brainSlot}Model`;

      await db
        .update(userAiBrain)
        .set({ [updateField]: input.toModel } as any)
        .where(eq(userAiBrain.userId, ctx.user.id));

      return { success: true };
    }),

  /** 取得所有引擎的健康狀態 */
  healthStatus: protectedProcedure.query(() => {
    const snapshot = getHealthSnapshot();

    // 為目錄中的所有模型提供健康狀態
    const allModels = new Set<string>();

    for (const slot of Object.values(REASONING_MODEL_CATALOG)) {
      for (const opt of slot.options) {
        allModels.add(opt.value);
      }
    }
    for (const slot of Object.values(GENERATION_ENGINE_CATALOG)) {
      for (const opt of slot.options) {
        allModels.add(opt.value);
      }
    }

    const status: Record<string, { healthy: boolean; consecutiveFailures: number; lastError?: string }> = {};
    for (const model of Array.from(allModels)) {
      const cached = snapshot[model];
      status[model] = {
        healthy: cached ? cached.healthy : getHealthStatus(model),
        consecutiveFailures: cached?.consecutiveFailures ?? 0,
        lastError: cached?.lastError,
      };
    }

    return status;
  }),
});
