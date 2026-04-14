/**
 * Brain Configuration Router
 * ────────────────────────────────────────────────────────────────────────────
 * CRUD 操作 user_ai_brain 表，提供大腦組態管理 API。
 * 不暴露任何 API Key。
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  getAlerts,
  dismissAlert,
  getErrorTraces,
  recordErrorTrace,
  resolveErrorTrace,
  getProposals,
  createReflectionProposal,
  approveProposal,
  rejectProposal,
  webSearch,
  getResearchResults,
  addResearchToLearnHub,
  getAccuracyTests,
  runAccuracyTest,
  runAllAccuracyTests,
  getSystemSummary,
} from "../services/brainAutoRepair";
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
import {
  FAL_MODEL_CATALOG,
  FAL_CATEGORY_LABELS,
  type FalCategory,
} from "../services/falModels";
import { ELEVENLABS_TTS_MODELS } from "../services/elevenLabsExtended";
import {
  MODEL_PRICING_CATALOG,
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  getAllPricingByCategory,
  pointsToUsd,
} from "../services/modelPricing";
import { resolveFalEnginesFromRow, DEFAULT_FAL_ENGINES } from "../services/falDispatcher";
import {
  getAutoRepairConfig,
  setAutoRepairEnabled,
  setMonitorInterval,
} from "../jobs/apiHealthMonitor";

// ═══════════════════════════════════════════════════════════════════════════
// Model Catalog (白皮書規格)
// ═══════════════════════════════════════════════════════════════════════════

/** 5 大推理大腦備選清單（含 Vertex AI 模型） */
export const REASONING_MODEL_CATALOG = {
  director: {
    label: "全站導演",
    description: "統籌創作流程、分鏡、敘事結構",
    options: [
      // ── Gemini / Vertex AI ──
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro ✦", tier: "premium" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", tier: "fast" },
      // ── Vertex AI 模型 ──
      { value: "vertex/gemini-2.5-pro", label: "Vertex Gemini 2.5 Pro 🔷", tier: "premium" },
      { value: "vertex/llama-3.2-90b", label: "Vertex Llama 3.2 90B", tier: "premium" },
    ],
  },
  analyst: {
    label: "新聞過濾",
    description: "數據分析、趨勢洞察、新聞摘要",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      { value: "vertex/gemini-2.5-flash", label: "Vertex Gemini 2.5 Flash 🔷", tier: "fast" },
      { value: "vertex/llama-3.1-405b", label: "Vertex Llama 3.1 405B", tier: "premium" },
    ],
  },
  storyteller: {
    label: "編譯器",
    description: "提示詞編譯、文案撰寫、故事展開",
    options: [
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro ✦", tier: "premium" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "vertex/gemini-2.5-pro", label: "Vertex Gemini 2.5 Pro 🔷", tier: "premium" },
      { value: "vertex/mistral-nemo", label: "Vertex Mistral NeMo", tier: "standard" },
    ],
  },
  technician: {
    label: "光球語調",
    description: "VisualSoul 對話風格、OARS 語句生成",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", tier: "fast" },
      { value: "vertex/gemini-2.5-flash", label: "Vertex Gemini 2.5 Flash 🔷", tier: "fast" },
    ],
  },
  curator: {
    label: "RAG 向量",
    description: "風格推薦、美學判斷、靈感策展",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "premium" },
      { value: "vertex/gemini-2.5-pro", label: "Vertex Gemini 2.5 Pro 🔷", tier: "premium" },
    ],
  },
} as const;

/** 生成引擎備選清單（圖片/影片/音頻/語音 + Gemini + ElevenLabs 完整目錄） */
export const GENERATION_ENGINE_CATALOG = {
  imageEngine: {
    label: "圖片引擎",
    description: "AI 圖像生成（文字轉圖像）",
    options: [
      // ── Fal.ai ──
      { value: "fal/flux-pro-1.1", label: "Flux Pro 1.1 ✦", tier: "premium" },
      { value: "fal/flux-dev", label: "Flux Dev", tier: "premium" },
      { value: "fal/flux-schnell", label: "Flux Schnell ⚡", tier: "fast" },
      { value: "fal/sd3-medium", label: "Stable Diffusion 3", tier: "standard" },
      { value: "fal/ideogram-v2", label: "Ideogram V2", tier: "premium" },
      { value: "fal/aura-flow", label: "AuraFlow", tier: "standard" },
      // ── Gemini Imagen ──
      { value: "gemini/imagen-3", label: "Imagen 3 (Gemini) 🔵", tier: "premium" },
      { value: "gemini/imagen-3-fast", label: "Imagen 3 Fast (Gemini) ⚡", tier: "fast" },
      // ── Vertex Imagen ──
      { value: "vertex/imagen-3", label: "Imagen 3 (Vertex) 🔷", tier: "premium" },
    ],
  },
  videoEngine: {
    label: "影片引擎",
    description: "AI 影片生成（文字/圖片轉視頻）",
    options: [
      // ── Fal.ai 文字轉影片 ──
      { value: "fal/kling-v2.1-pro-t2v", label: "Kling V2.1 Pro ✦", tier: "premium" },
      { value: "fal/kling-v1.5-pro-t2v", label: "Kling V1.5 Pro", tier: "premium" },
      { value: "fal/minimax-t2v", label: "MiniMax Hailuo", tier: "standard" },
      { value: "fal/luma-dream-machine-t2v", label: "Luma Dream Machine", tier: "premium" },
      { value: "fal/wan-t2v-v2.1", label: "WAN T2V 2.1", tier: "standard" },
      { value: "fal/cogvideox-5b-t2v", label: "CogVideoX 5B", tier: "standard" },
      // ── Fal.ai 圖片轉影片 ──
      { value: "fal/kling-v2.1-pro-i2v", label: "Kling V2.1 i2v ✦", tier: "premium" },
      { value: "fal/runway-gen3-i2v", label: "Runway Gen3 Turbo i2v", tier: "premium" },
      // ── Gemini Veo ──
      { value: "gemini/veo-2", label: "Veo 2 (Gemini) 🔵", tier: "premium" },
      { value: "gemini/veo-3", label: "Veo 3 Preview (Gemini) 🔵", tier: "premium" },
    ],
  },
  audioEngine: {
    label: "音樂引擎",
    description: "AI 音樂/音效生成",
    options: [
      // ── Suno ──
      { value: "suno-v4", label: "Suno V4 ✦", tier: "premium" },
      { value: "suno-v3.5", label: "Suno V3.5", tier: "standard" },
      // ── Fal.ai 音頻 ──
      { value: "fal/stable-audio", label: "Stable Audio (Fal)", tier: "premium" },
      { value: "fal/musicgen", label: "MusicGen (Meta)", tier: "standard" },
      { value: "fal/ace-step", label: "ACE-Step", tier: "premium" },
      { value: "fal/audioldm2", label: "AudioLDM 2", tier: "standard" },
      // ── Gemini Lyria ──
      { value: "gemini/lyria-2", label: "Lyria 2 (Gemini) 🔵", tier: "premium" },
      { value: "gemini/musicfx", label: "MusicFX (Gemini) 🔵", tier: "standard" },
      // ── ElevenLabs ──
      { value: "elevenlabs/music", label: "ElevenLabs Music 🎵", tier: "premium" },
      { value: "elevenlabs/sound-effects", label: "ElevenLabs 音效 🎵", tier: "standard" },
    ],
  },
  voiceEngine: {
    label: "配音引擎",
    description: "AI 語音合成（文字轉語音）",
    options: [
      // ── ElevenLabs ──
      { value: "elevenlabs/eleven-v3", label: "ElevenLabs V3 ✦", tier: "premium" },
      { value: "elevenlabs/multilingual-v2", label: "ElevenLabs Multilingual V2", tier: "premium" },
      { value: "elevenlabs/turbo-v2.5", label: "ElevenLabs Turbo V2.5 ⚡", tier: "fast" },
      { value: "elevenlabs/flash-v2.5", label: "ElevenLabs Flash V2.5 ⚡", tier: "fast" },
      // ── Fal.ai TTS ──
      { value: "fal/metavoice-v1", label: "MetaVoice V1 (Fal)", tier: "premium" },
      { value: "fal/playai-tts", label: "PlayAI TTS (Fal)", tier: "premium" },
      { value: "fal/kokoro", label: "Kokoro TTS (Fal) ⚡", tier: "fast" },
      { value: "fal/orpheus-tts", label: "Orpheus TTS (Fal)", tier: "standard" },
      { value: "fal/dia-tts", label: "Dia TTS (Fal)", tier: "standard" },
      // ── Gemini TTS ──
      { value: "gemini/tts-flash", label: "Gemini TTS Flash 🔵 ⚡", tier: "fast" },
      { value: "gemini/tts-pro", label: "Gemini TTS Pro 🔵", tier: "premium" },
    ],
  },
} as const;

/** Fal.ai 16大類專用引擎（可在大腦設定中為特定任務指定） */
export const FAL_TASK_ENGINE_CATALOG = {
  imageTo3d: {
    label: "影像轉3D",
    description: "從圖片生成3D模型",
    options: [
      { value: "fal/trellis", label: "Trellis 3D ✦", tier: "premium" },
      { value: "fal/triposr", label: "TripoSR ⚡", tier: "standard" },
      { value: "fal/zero123plus", label: "Zero123++", tier: "standard" },
      { value: "fal/stable-zero123", label: "Stable Zero123", tier: "standard" },
      { value: "fal/mv-adapter", label: "MV-Adapter", tier: "premium" },
    ],
  },
  imageToImage: {
    label: "影像到影像",
    description: "圖片風格轉換/超解析度",
    options: [
      { value: "fal/flux-dev-i2i", label: "Flux Dev i2i ✦", tier: "premium" },
      { value: "fal/sd3-medium-i2i", label: "SD3 Medium i2i", tier: "standard" },
      { value: "fal/ip-adapter-faceid", label: "IP-Adapter FaceID", tier: "premium" },
      { value: "fal/controlnet-union", label: "ControlNet Union", tier: "standard" },
      { value: "fal/aura-sr", label: "AuraSR 超解析度 ⚡", tier: "fast" },
      { value: "fal/rembg", label: "RemBG 去背 ⚡", tier: "fast" },
    ],
  },
  textTo3d: {
    label: "文字轉3D",
    description: "從文字描述生成3D模型",
    options: [
      { value: "fal/meshy-4", label: "Meshy 4 ✦", tier: "premium" },
      { value: "fal/hyper3d-rodin", label: "Hyper3D Rodin", tier: "premium" },
      { value: "fal/shap-e", label: "Shap-E", tier: "standard" },
      { value: "fal/dreamgaussian", label: "DreamGaussian", tier: "standard" },
      { value: "fal/fantasia3d", label: "Fantasia3D", tier: "premium" },
    ],
  },
  videoToAudio: {
    label: "視訊轉音訊",
    description: "為影片生成配樂音效",
    options: [
      { value: "fal/mmaudio-v2", label: "MMAudio V2 ✦", tier: "premium" },
      { value: "fal/stable-audio-v2a", label: "Stable Audio v2a", tier: "standard" },
      { value: "fal/audioldm2-v2a", label: "AudioLDM2 v2a", tier: "standard" },
      { value: "fal/sync-lipsync", label: "Sync Lipsync", tier: "premium" },
      { value: "fal/elevenlabs-sound", label: "ElevenLabs 音效", tier: "standard" },
    ],
  },
  videoToText: {
    label: "影片轉文字",
    description: "影片語音轉錄/內容分析",
    options: [
      { value: "fal/whisper", label: "Whisper ✦", tier: "standard" },
      { value: "fal/wizper", label: "Wizper ⚡", tier: "fast" },
      { value: "fal/any-llm-video", label: "Any LLM 影片分析", tier: "premium" },
      { value: "fal/llava-next-video", label: "LLaVA-Next 影片", tier: "standard" },
    ],
  },
  videoToVideo: {
    label: "影片對影片",
    description: "影片風格轉換/增強",
    options: [
      { value: "fal/kling-v2.1-v2v", label: "Kling V2.1 V2V ✦", tier: "premium" },
      { value: "fal/wan-v2v", label: "WAN V2V", tier: "standard" },
      { value: "fal/cogvideox-v2v", label: "CogVideoX V2V", tier: "standard" },
      { value: "fal/topaz-video", label: "Topaz 超解析度", tier: "premium" },
      { value: "fal/stable-video-upscaler", label: "SVD 超解析度", tier: "standard" },
    ],
  },
  training: {
    label: "模型訓練",
    description: "LoRA/DreamBooth 微調訓練",
    options: [
      { value: "fal/flux-lora-fast", label: "Flux LoRA 快速訓練 ✦", tier: "premium" },
      { value: "fal/flux-lora-portrait", label: "Flux LoRA 人像", tier: "premium" },
      { value: "fal/dreambooth-flux", label: "DreamBooth Flux", tier: "premium" },
      { value: "fal/sd3-lora", label: "SD3 LoRA", tier: "standard" },
      { value: "fal/cogvideox-lora", label: "CogVideoX LoRA", tier: "premium" },
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
    /** Fal.ai 16大類任務引擎（每類 5-6 模型） */
    falTasks: Object.fromEntries(
      (Object.keys(FAL_MODEL_CATALOG) as FalCategory[]).map((cat) => [
        cat,
        {
          label: FAL_CATEGORY_LABELS[cat],
          description: FAL_MODEL_CATALOG[cat][0]?.description ?? "",
          options: FAL_MODEL_CATALOG[cat].map((m) => ({
            value: m.modelId,
            label: m.label,
            tier: m.tier,
            description: m.description,
            inputSchema: m.inputSchema,
            outputSchema: m.outputSchema,
          })),
        },
      ])
    ) as Record<FalCategory, {
      label: string;
      description: string;
      options: Array<{
        value: string;
        label: string;
        tier: string;
        description: string;
        inputSchema: Record<string, boolean | undefined>;
        outputSchema: Record<string, boolean | undefined>;
      }>;
    }>,
    /** ElevenLabs TTS 模型目錄 */
    elevenLabsModels: ELEVENLABS_TTS_MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      tier: m.tier,
      description: m.description,
      supportsEmotionTags: m.supportsEmotionTags,
      supportsMultiSpeaker: m.supportsMultiSpeaker,
      languages: m.languages,
    })),
  })),

  /** 取得使用者的大腦組態 */
  get: protectedProcedure.query(async ({ ctx }) => {
    // Demo mode (no DB): return defaults
    let row: Record<string, unknown> | null = null;
    try {
      const db = await getDb();
      if (db) {
        const rows = await db
          .select()
          .from(userAiBrain)
          .where(eq(userAiBrain.userId, ctx.user.id))
          .limit(1);
        row = (rows[0] ?? null) as Record<string, unknown> | null;
      }
    } catch { /* fallback to defaults */ }

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
        // Fal.ai 16大類任務引擎
        falImageTo3dEngine: z.string().optional(),
        falImageToImageEngine: z.string().optional(),
        falImageToJsonEngine: z.string().optional(),
        falImageToVideoEngine: z.string().optional(),
        falJsonEngine: z.string().optional(),
        falLlmEngine: z.string().optional(),
        falTextTo3dEngine: z.string().optional(),
        falTextToAudioEngine: z.string().optional(),
        falTextToImageEngine: z.string().optional(),
        falTextToJsonEngine: z.string().optional(),
        falTextToSpeechEngine: z.string().optional(),
        falTextToVideoEngine: z.string().optional(),
        falTrainingEngine: z.string().optional(),
        falVideoToAudioEngine: z.string().optional(),
        falVideoToTextEngine: z.string().optional(),
        falVideoToVideoEngine: z.string().optional(),
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

  /**
   * 取得當前大腦組態各模態的引擎選擇 + 詳細點數費率
   * 供 Studio 頁面顯示「本次生成預估費用」
   */
  pricingSummary: protectedProcedure
    .input(z.object({
      durationSec: z.number().optional(),
      charCount: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      // Demo mode (no DB): use default engines
      let brainRow: Record<string, unknown> | null = null;
      try {
        const db = await getDb();
        if (db) {
          const rows = await db
            .select()
            .from(userAiBrain)
            .where(eq(userAiBrain.userId, userId))
            .limit(1);
          brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
        }
      } catch { /* fallback to defaults */ }
      const falEngines = resolveFalEnginesFromRow(brainRow);

      // 四模態引擎
      const imageEngine  = String(brainRow?.imageEngine  ?? falEngines.textToImage);
      const videoEngine  = String(brainRow?.videoEngine  ?? falEngines.textToVideo);
      const audioEngine  = String(brainRow?.audioEngine  ?? falEngines.textToAudio);
      const voiceEngine  = String(brainRow?.voiceEngine  ?? falEngines.textToSpeech);

      const buildEntry = (modelId: string, durationSec?: number, charCount?: number) => {
        const p = getModelPricing(modelId);
        const est = estimatePoints(modelId, { durationSec, charCount });
        const avail = checkModelAvailability(modelId);
        return {
          modelId,
          label: p?.label ?? modelId,
          provider: p?.provider ?? "unknown",
          tier: p?.tier ?? "standard",
          unit: p?.unit ?? "每次",
          basePoints: p?.basePoints ?? est.basePoints,
          estimatedPoints: est.totalPoints,
          breakdown: est.breakdown,
          estimatedUsd: pointsToUsd(est.totalPoints),
          available: avail.available,
          availabilityNote: !avail.available ? avail.reason : undefined,
        };
      };

      return {
        image: buildEntry(imageEngine),
        video: buildEntry(videoEngine, input?.durationSec ?? 5),
        audio: buildEntry(audioEngine, input?.durationSec ?? 30),
        voice: buildEntry(voiceEngine, undefined, input?.charCount ?? 100),
        /** 全模型費率表（按分類，供 UI 展示） */
        allPricingByCategory: getAllPricingByCategory(),
        /** 換算匯率提示 */
        rateNote: "1 USD ≈ 100 pts（點數）。最低扣 1 pt，上限 500 pts/次。",
      };
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
    // Include Fal.ai task engine models
    for (const models of Object.values(FAL_MODEL_CATALOG)) {
      for (const m of models) {
        allModels.add(m.modelId);
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

  // ─── Orb Voice Preview ──────────────────────────────────────────────────
  /**
   * orbVoicePreview — 使用 ElevenLabs TTS 生成光球語調預覽音頻。
   * 傳入文字與 voiceId，回傳 base64 encoded audio URL。
   */
  orbVoicePreview: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(300),
        voiceId: z.string().optional().default("Rachel"),
        modelId: z.string().optional().default("eleven_turbo_v2"),
        stability: z.number().min(0).max(1).optional().default(0.5),
        similarityBoost: z.number().min(0).max(1).optional().default(0.75),
        speed: z.number().min(0.25).max(4.0).optional().default(1.0),
      })
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ELEVENLABS_API_KEY 未設定，無法預覽光球語調",
        });
      }

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}`;
      const payload = {
        text: input.text,
        model_id: input.modelId,
        voice_settings: {
          stability: input.stability,
          similarity_boost: input.similarityBoost,
          speed: input.speed,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `ElevenLabs TTS 失敗 (${res.status}): ${errText.slice(0, 200)}`,
        });
      }

      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return {
        audioBase64: `data:audio/mpeg;base64,${base64}`,
        durationEstimateMs: Math.round((input.text.length / 15) * 1000), // rough estimate
        voiceId: input.voiceId,
        modelId: input.modelId,
      };
    }),

  // ─── Provider Health Ping ──────────────────────────────────────────────
  /**
   * pingProviders — 對各主要第三方 API 端點發出輕量探測，回傳真實延遲。
   */
  pingProviders: protectedProcedure.query(async () => {
    const results: Record<
      string,
      { latencyMs: number | null; ok: boolean; error?: string }
    > = {};

    async function ping(
      name: string,
      url: string,
      options: RequestInit = {}
    ): Promise<void> {
      const start = Date.now();
      try {
        const res = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(8_000),
        });
        results[name] = {
          latencyMs: Date.now() - start,
          ok: res.ok || res.status === 401 || res.status === 403, // key-gated = service alive
        };
      } catch (e: unknown) {
        results[name] = {
          latencyMs: Date.now() - start,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // Gemini — list models endpoint (no auth = 400/401 but confirms reachability)
    const geminiKey = process.env.GEMINI_API_KEY;
    await ping(
      "gemini",
      geminiKey
        ? `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=1`
        : "https://generativelanguage.googleapis.com/v1beta/models",
      { method: "GET" }
    );

    // Fal.ai — queue status endpoint
    await ping("fal", "https://queue.fal.run/fal-ai/flux/requests", {
      method: "GET",
      headers: process.env.FAL_API_KEY
        ? { Authorization: `Key ${process.env.FAL_API_KEY}` }
        : {},
    });

    // ElevenLabs — user info (returns 401 if key missing but confirms service alive)
    await ping("elevenlabs", "https://api.elevenlabs.io/v1/user", {
      method: "GET",
      headers: process.env.ELEVENLABS_API_KEY
        ? { "xi-api-key": process.env.ELEVENLABS_API_KEY }
        : {},
    });

    // Vertex AI — not directly pingable from client; mark as unknown unless credential present
    results["vertex"] = {
      latencyMs: null,
      ok: !!(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
      error: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
        ? undefined
        : "GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定",
    };

    return results;
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // 自動修復 & 監控中心 API（5 大子系統）
  // ═══════════════════════════════════════════════════════════════════════

  /** 系統摘要 — 返回所有子系統的即時統計 */
  monitorSummary: protectedProcedure.query(() => {
    return getSystemSummary();
  }),

  // ─── 自動除錯開關 & 巡檢間隔設定 ──────────────────────────────────────

  /** 取得自動除錯設定（開關 + 間隔） */
  autoRepairConfig: protectedProcedure.query(() => {
    return getAutoRepairConfig();
  }),

  /** 切換自動除錯開關 */
  toggleAutoRepair: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      return setAutoRepairEnabled(input.enabled);
    }),

  /** 設定巡檢間隔（1–60 分鐘） */
  setMonitorInterval: adminProcedure
    .input(z.object({ minutes: z.number().min(1).max(60) }))
    .mutation(({ input }) => {
      return setMonitorInterval(input.minutes);
    }),

  // ─── 1. 自動修復 API + 提醒管理 ──────────────────────────────────────

  /** 取得 API 警報清單 */
  alerts: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => getAlerts(input?.limit ?? 50)),

  /** 管理員關閉警報 */
  dismissAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = dismissAlert(input.alertId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "警報不存在" });
      return { success: true };
    }),

  // ─── 2. 生成錯誤線索系統 ─────────────────────────────────────────────

  /** 取得錯誤線索 */
  errorTraces: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      modality: z.enum(["image", "video", "audio", "voice", "llm"]).optional(),
    }).optional())
    .query(({ input }) => getErrorTraces(input?.limit ?? 50, input?.modality)),

  /** 記錄一個生成錯誤（供其他 router 呼叫，或管理員手動回報） */
  reportError: protectedProcedure
    .input(z.object({
      modality: z.enum(["image", "video", "audio", "voice", "llm"]),
      engine: z.string(),
      prompt: z.string().max(2000),
      errorMessage: z.string().max(2000),
      errorCode: z.string().optional(),
      stackHint: z.string().max(1000).optional(),
    }))
    .mutation(({ ctx, input }) => {
      return recordErrorTrace({ ...input, userId: ctx.user.id });
    }),

  /** 標記錯誤已解決 */
  resolveError: adminProcedure
    .input(z.object({ traceId: z.string(), resolution: z.string().max(1000) }))
    .mutation(({ input }) => {
      const ok = resolveErrorTrace(input.traceId, input.resolution);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "錯誤線索不存在" });
      return { success: true };
    }),

  // ─── 3. 回饋自我反省優化系統 ─────────────────────────────────────────

  /** 取得優化提案清單 */
  proposals: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }).optional())
    .query(({ input }) => getProposals(input?.status)),

  /** 手動建立優化提案 */
  createProposal: protectedProcedure
    .input(z.object({
      category: z.enum(["prompt_optimization", "engine_switch", "param_tuning", "fallback_update", "accuracy_fix"]),
      title: z.string().min(2).max(200),
      description: z.string().max(2000),
      currentValue: z.string().max(500),
      proposedValue: z.string().max(500),
      reasoning: z.string().max(2000),
      confidence: z.number().min(0).max(100),
    }))
    .mutation(({ input }) => createReflectionProposal(input)),

  /** 管理員批准提案 */
  approveProposal: adminProcedure
    .input(z.object({ proposalId: z.string(), note: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => {
      const ok = approveProposal(input.proposalId, ctx.user.id, input.note);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "提案不存在或已處理" });
      return { success: true };
    }),

  /** 管理員拒絕提案 */
  rejectProposal: adminProcedure
    .input(z.object({ proposalId: z.string(), note: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) => {
      const ok = rejectProposal(input.proposalId, ctx.user.id, input.note);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "提案不存在或已處理" });
      return { success: true };
    }),

  // ─── 4. 爬網找資料功能 ──────────────────────────────────────────────

  /** 執行爬網搜尋 */
  webSearch: protectedProcedure
    .input(z.object({
      query: z.string().min(2).max(200),
      maxResults: z.number().min(1).max(10).default(5),
    }))
    .mutation(async ({ input }) => {
      return webSearch(input.query, input.maxResults);
    }),

  /** 取得歷史研究結果 */
  researchResults: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => getResearchResults(input?.limit ?? 50)),

  /** 將研究結果加入 LearnHub */
  addResearchToLearnHub: adminProcedure
    .input(z.object({ researchId: z.string() }))
    .mutation(({ input }) => {
      const ok = addResearchToLearnHub(input.researchId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "研究結果不存在或已加入" });
      return { success: true };
    }),

  // ─── 5. AI 精準度測試系統 ───────────────────────────────────────────

  /** 取得測試結果歷史 */
  accuracyTests: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => getAccuracyTests(input?.limit ?? 50)),

  /** 執行單一精準度測試 */
  runAccuracyTest: adminProcedure
    .input(z.object({
      engine: z.string(),
      testType: z.enum(["response_quality", "latency", "consistency", "error_rate"]),
      testPrompt: z.string().min(1).max(500),
      expectedBehavior: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      return runAccuracyTest(input.engine, input.testType, input.testPrompt, input.expectedBehavior);
    }),

  /** 執行全部預定義測試 */
  runAllAccuracyTests: adminProcedure
    .mutation(async () => {
      return runAllAccuracyTests();
    }),
});
