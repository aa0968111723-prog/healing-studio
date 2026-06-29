/**
 * Brain Configuration Router
 * ────────────────────────────────────────────────────────────────────────────
 * CRUD 操作 user_ai_brain 表，提供大腦組態管理 API。
 * 不暴露任何 API Key。
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../_core/providerFacade";
import { getDb } from "../db";
import {
  getAlerts,
  dismissAlert,
  getErrorTraces,
  recordErrorTrace,
  resolveErrorTrace,
  diagnoseError,
  getProposals,
  createReflectionProposal,
  approveProposal,
  rejectProposal,
  retryGithubIssueForProposal,
  webSearch,
  getResearchResults,
  addResearchToLearnHub,
  getAccuracyTests,
  runAccuracyTest,
  runAllAccuracyTests,
  runFullCodeScan,
  generateProposalsFromErrorTraces,
  getLastScanResult,
  getSystemSummary,
  getGenerationLogs,
  ERROR_CATEGORY_LABELS,
} from "../services/brainAutoRepair";
import {
  getGithubConfigStatus,
  testGithubConnection,
} from "../services/githubIssueClient";
import {
  userAiBrain,
  userModelSwitchLogs,
  type InsertUserModelSwitchLog,
} from "../../drizzle/schema";
import {
  getHealthStatus,
  getHealthStatusDetailed,
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
import {
  resolveFalEnginesFromRow,
  DEFAULT_FAL_ENGINES,
} from "../services/falDispatcher";
import { normalizeEngineModelId } from "../../shared/engineModelIds";
import {
  getAutoRepairConfig,
  setAutoRepairEnabled,
  setMonitorInterval,
} from "../jobs/apiHealthMonitor";
import { getProviderProbeStatus } from "../jobs/providerHealthProbeJob";
import {
  REASONING_MODEL_CATALOG,
  GENERATION_ENGINE_CATALOG,
  FAL_TASK_ENGINE_CATALOG,
  REASONING_MODEL_ALLOWLIST,
  FAL_FIELD_ALLOWLISTS,
} from "../_core/modelRegistry";

// Re-export for backward compatibility (tests/external imports rely on these
// being available from `routers/brain`).
export {
  REASONING_MODEL_CATALOG,
  GENERATION_ENGINE_CATALOG,
  FAL_TASK_ENGINE_CATALOG,
};

// ═══════════════════════════════════════════════════════════════════════════
// Local Allowlists (REASONING_MODEL_ALLOWLIST + FAL_FIELD_ALLOWLISTS come
// from the registry; GENERATION_ENGINE_ALLOWLIST stays local because it
// layers normalization + DEFAULT engine on top of the catalog.)
// ═══════════════════════════════════════════════════════════════════════════

const GENERATION_ENGINE_ALLOWLIST = Object.fromEntries(
  (
    Object.keys(GENERATION_ENGINE_CATALOG) as Array<
      keyof typeof GENERATION_ENGINE_CATALOG
    >
  ).map(slot => [
    slot,
    new Set([
      ...GENERATION_ENGINE_CATALOG[slot].options.map(opt =>
        normalizeEngineModelId(opt.value)
      ),
      normalizeEngineModelId(DEFAULT_GENERATION_ENGINES[slot].engine),
    ]),
  ])
) as Record<keyof typeof GENERATION_ENGINE_CATALOG, Set<string>>;

/** Set of the 16 Fal task field names — derived from registry. */
const FAL_TASK_FIELD_ALLOWLIST = new Set(
  Object.keys(FAL_FIELD_ALLOWLISTS)
);

/**
 * Per-field Zod schema for one of the 16 Fal task engine fields.
 * Validates against the **per-category** allowlist (e.g. falTextToImageEngine
 * only accepts text-to-image models, not video models).
 */
function falEngineField(fieldName: keyof typeof FAL_FIELD_ALLOWLISTS) {
  return z
    .string()
    .trim()
    .transform(normalizeEngineModelId)
    .refine(v => FAL_FIELD_ALLOWLISTS[fieldName].has(v), {
      message: `不支援的 ${fieldName}`,
    })
    .optional();
}

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

// ─── Static pricing-by-category — pricing catalog is a compile-time const,
// so compute once at module load instead of on every pricingSummary call.
const ALL_PRICING_BY_CATEGORY = Object.freeze(getAllPricingByCategory());

// ─── Static catalog payload — built once at module load ──────────────────
// REASONING / GENERATION / FAL / ElevenLabs catalogs are all compile-time
// constants. Computing the response object on every request wastes CPU
// (and forces React Query refetches to be more expensive than they need).
// Build once and serve the same frozen object to every caller.
const STATIC_CATALOG_PAYLOAD = Object.freeze({
  reasoning: REASONING_MODEL_CATALOG,
  generation: GENERATION_ENGINE_CATALOG,
  falTasks: Object.fromEntries(
    (Object.keys(FAL_MODEL_CATALOG) as FalCategory[]).map(cat => [
      cat,
      {
        label: FAL_CATEGORY_LABELS[cat],
        description: FAL_MODEL_CATALOG[cat][0]?.description ?? "",
        options: FAL_MODEL_CATALOG[cat].map(m => ({
          value: m.modelId,
          label: m.label,
          tier: m.tier,
          description: m.description,
          inputSchema: m.inputSchema,
          outputSchema: m.outputSchema,
        })),
      },
    ])
  ),
  elevenLabsModels: ELEVENLABS_TTS_MODELS.map(m => ({
    value: m.value,
    label: m.label,
    tier: m.tier,
    description: m.description,
    supportsEmotionTags: m.supportsEmotionTags,
    supportsMultiSpeaker: m.supportsMultiSpeaker,
    languages: m.languages,
  })),
});

export const brainRouter = router({
  /** 取得模型目錄(不需要登入)— 靜態 payload,啟動時一次組好 */
  catalog: protectedProcedure.query(() => STATIC_CATALOG_PAYLOAD),

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
    } catch {
      /* fallback to defaults */
    }

    // 組裝回傳結構（不暴露任何 API Key）
    const reasoningSlots: ReasoningBrainSlot[] = [
      "director",
      "analyst",
      "storyteller",
      "technician",
      "curator",
    ];
    const engineSlots: GenerationEngineSlot[] = [
      "imageEngine",
      "videoEngine",
      "audioEngine",
      "voiceEngine",
    ];

    const reasoning: Record<string, unknown> = {};
    for (const slot of reasoningSlots) {
      const defaults = DEFAULT_REASONING_BRAINS[slot];
      const model = row
        ? String((row as any)[`${slot}Model`] ?? defaults.model)
        : defaults.model;
      reasoning[slot] = {
        model,
        temperature: row
          ? Number((row as any)[`${slot}Temperature`] ?? defaults.temperature)
          : defaults.temperature,
        topP: row
          ? Number((row as any)[`${slot}TopP`] ?? defaults.topP)
          : defaults.topP,
        systemPrompt: row
          ? ((row as any)[`${slot}SystemPrompt`] ?? null)
          : null,
        enabled: row ? Boolean((row as any)[`${slot}Enabled`] ?? true) : true,
        healthy: getHealthStatus(model),
      };
    }

    const generation: Record<string, unknown> = {};
    for (const slot of engineSlots) {
      const defaults = DEFAULT_GENERATION_ENGINES[slot];
      const engine = normalizeEngineModelId(
        row ? String((row as any)[slot] ?? defaults.engine) : defaults.engine
      );
      generation[slot] = {
        engine,
        params: row ? ((row as any)[`${slot}Params`] ?? null) : null,
        enabled: row ? Boolean((row as any)[`${slot}Enabled`] ?? true) : true,
        healthy: getHealthStatus(engine),
      };
    }

    const falEngines = resolveFalEnginesFromRow(row);

    return {
      hasCustomConfig: row !== null,
      reasoning,
      generation,
      falTasks: {
        imageTo3d: normalizeEngineModelId(falEngines.imageToThreeD),
        imageToImage: normalizeEngineModelId(falEngines.imageToImage),
        imageToJson: normalizeEngineModelId(falEngines.imageToJson),
        imageToVideo: normalizeEngineModelId(falEngines.imageToVideo),
        json: normalizeEngineModelId(falEngines.json),
        llm: normalizeEngineModelId(falEngines.llm),
        textTo3d: normalizeEngineModelId(falEngines.textToThreeD),
        textToAudio: normalizeEngineModelId(falEngines.textToAudio),
        textToImage: normalizeEngineModelId(falEngines.textToImage),
        textToJson: normalizeEngineModelId(falEngines.textToJson),
        textToSpeech: normalizeEngineModelId(falEngines.textToSpeech),
        textToVideo: normalizeEngineModelId(falEngines.textToVideo),
        training: normalizeEngineModelId(falEngines.training),
        videoToAudio: normalizeEngineModelId(falEngines.videoToAudio),
        videoToText: normalizeEngineModelId(falEngines.videoToText),
        videoToVideo: normalizeEngineModelId(falEngines.videoToVideo),
      },
    };
  }),

  /** 更新使用者的大腦組態（upsert） */
  upsert: protectedProcedure
    .input(
      z.object({
        // 推理大腦
        directorModel: z
          .string()
          .trim()
          .refine(v => REASONING_MODEL_ALLOWLIST.director.has(v), {
            message: "不支援的 director 模型",
          })
          .optional(),
        directorTemperature: z.number().min(0).max(1).optional(),
        directorTopP: z.number().min(0).max(1).optional(),
        directorSystemPrompt: z.string().nullable().optional(),
        directorEnabled: z.boolean().optional(),
        analystModel: z
          .string()
          .trim()
          .refine(v => REASONING_MODEL_ALLOWLIST.analyst.has(v), {
            message: "不支援的 analyst 模型",
          })
          .optional(),
        analystTemperature: z.number().min(0).max(1).optional(),
        analystTopP: z.number().min(0).max(1).optional(),
        analystSystemPrompt: z.string().nullable().optional(),
        analystEnabled: z.boolean().optional(),
        storytellerModel: z
          .string()
          .trim()
          .refine(v => REASONING_MODEL_ALLOWLIST.storyteller.has(v), {
            message: "不支援的 storyteller 模型",
          })
          .optional(),
        storytellerTemperature: z.number().min(0).max(1).optional(),
        storytellerTopP: z.number().min(0).max(1).optional(),
        storytellerSystemPrompt: z.string().nullable().optional(),
        storytellerEnabled: z.boolean().optional(),
        technicianModel: z
          .string()
          .trim()
          .refine(v => REASONING_MODEL_ALLOWLIST.technician.has(v), {
            message: "不支援的 technician 模型",
          })
          .optional(),
        technicianTemperature: z.number().min(0).max(1).optional(),
        technicianTopP: z.number().min(0).max(1).optional(),
        technicianSystemPrompt: z.string().nullable().optional(),
        technicianEnabled: z.boolean().optional(),
        curatorModel: z
          .string()
          .trim()
          .refine(v => REASONING_MODEL_ALLOWLIST.curator.has(v), {
            message: "不支援的 curator 模型",
          })
          .optional(),
        curatorTemperature: z.number().min(0).max(1).optional(),
        curatorTopP: z.number().min(0).max(1).optional(),
        curatorSystemPrompt: z.string().nullable().optional(),
        curatorEnabled: z.boolean().optional(),
        // 生成引擎
        imageEngine: z
          .string()
          .trim()
          .transform(normalizeEngineModelId)
          .refine(v => GENERATION_ENGINE_ALLOWLIST.imageEngine.has(v), {
            message: "不支援的 imageEngine",
          })
          .optional(),
        imageEngineParams: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional(),
        imageEngineEnabled: z.boolean().optional(),
        videoEngine: z
          .string()
          .trim()
          .transform(normalizeEngineModelId)
          .refine(v => GENERATION_ENGINE_ALLOWLIST.videoEngine.has(v), {
            message: "不支援的 videoEngine",
          })
          .optional(),
        videoEngineParams: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional(),
        videoEngineEnabled: z.boolean().optional(),
        audioEngine: z
          .string()
          .trim()
          .transform(normalizeEngineModelId)
          .refine(v => GENERATION_ENGINE_ALLOWLIST.audioEngine.has(v), {
            message: "不支援的 audioEngine",
          })
          .optional(),
        audioEngineParams: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional(),
        audioEngineEnabled: z.boolean().optional(),
        voiceEngine: z
          .string()
          .trim()
          .transform(normalizeEngineModelId)
          .refine(v => GENERATION_ENGINE_ALLOWLIST.voiceEngine.has(v), {
            message: "不支援的 voiceEngine",
          })
          .optional(),
        voiceEngineParams: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional(),
        voiceEngineEnabled: z.boolean().optional(),
        // Fal.ai 16大類任務引擎
        falImageTo3dEngine: falEngineField("falImageTo3dEngine"),
        falImageToImageEngine: falEngineField("falImageToImageEngine"),
        falImageToJsonEngine: falEngineField("falImageToJsonEngine"),
        falImageToVideoEngine: falEngineField("falImageToVideoEngine"),
        falJsonEngine: falEngineField("falJsonEngine"),
        falLlmEngine: falEngineField("falLlmEngine"),
        falTextTo3dEngine: falEngineField("falTextTo3dEngine"),
        falTextToAudioEngine: falEngineField("falTextToAudioEngine"),
        falTextToImageEngine: falEngineField("falTextToImageEngine"),
        falTextToJsonEngine: falEngineField("falTextToJsonEngine"),
        falTextToSpeechEngine: falEngineField("falTextToSpeechEngine"),
        falTextToVideoEngine: falEngineField("falTextToVideoEngine"),
        falTrainingEngine: falEngineField("falTrainingEngine"),
        falVideoToAudioEngine: falEngineField("falVideoToAudioEngine"),
        falVideoToTextEngine: falEngineField("falVideoToTextEngine"),
        falVideoToVideoEngine: falEngineField("falVideoToVideoEngine"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "資料庫不可用",
        });

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
        switchSource: z
          .enum(["manual", "soul_recommendation", "auto_fallback", "ab_test"])
          .default("manual"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "資料庫不可用",
        });

      const rawUpdateField = input.brainSlot.endsWith("Engine")
        ? input.brainSlot
        : `${input.brainSlot}Model`;

      let nextModel = normalizeEngineModelId(input.toModel);

      if (rawUpdateField.endsWith("Model")) {
        const slot = rawUpdateField.replace("Model", "");
        const allowlist =
          REASONING_MODEL_ALLOWLIST[
            slot as keyof typeof REASONING_MODEL_ALLOWLIST
          ];
        if (!allowlist || !allowlist.has(nextModel)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `不支援的模型：${nextModel}`,
          });
        }
      } else if (rawUpdateField.endsWith("Engine")) {
        const isFalTask = FAL_TASK_FIELD_ALLOWLIST.has(rawUpdateField);
        const allowedForField = isFalTask
          ? FAL_FIELD_ALLOWLISTS[rawUpdateField]
          : GENERATION_ENGINE_ALLOWLIST[
              rawUpdateField as keyof typeof GENERATION_ENGINE_ALLOWLIST
            ];
        if (!allowedForField || !allowedForField.has(nextModel)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `不支援的引擎：${nextModel}`,
          });
        }
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `不支援的 brainSlot：${input.brainSlot}`,
        });
      }

      const updateField = rawUpdateField;

      // 兩段寫入包成單一交易：先 upsert 大腦狀態，成功後才寫切換日誌。
      // 任一步驟失敗時整個交易回滾，不留孤兒日誌或不一致狀態。
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: userAiBrain.id })
          .from(userAiBrain)
          .where(eq(userAiBrain.userId, ctx.user.id))
          .limit(1);

        if (existing.length > 0) {
          await tx
            .update(userAiBrain)
            .set({ [updateField]: nextModel } as Partial<typeof userAiBrain.$inferInsert>)
            .where(eq(userAiBrain.userId, ctx.user.id));
        } else {
          await tx.insert(userAiBrain).values({
            userId: ctx.user.id,
            [updateField]: nextModel,
          } as typeof userAiBrain.$inferInsert);
        }

        await tx.insert(userModelSwitchLogs).values({
          userId: ctx.user.id,
          brainSlot: input.brainSlot as InsertUserModelSwitchLog["brainSlot"],
          fromModel: input.fromModel,
          toModel: nextModel,
          reason: input.reason ?? `手動切換 ${input.brainSlot}`,
          switchSource: input.switchSource,
        });
      });

      return { success: true };
    }),

  /**
   * 取得當前大腦組態各模態的引擎選擇 + 詳細點數費率
   * 供 Studio 頁面顯示「本次生成預估費用」
   */
  pricingSummary: protectedProcedure
    .input(
      z
        .object({
          durationSec: z.number().optional(),
          charCount: z.number().optional(),
        })
        .optional()
    )
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
      } catch {
        /* fallback to defaults */
      }
      const falEngines = resolveFalEnginesFromRow(brainRow);

      // 四模態引擎
      const imageEngine = normalizeEngineModelId(
        String(brainRow?.imageEngine ?? falEngines.textToImage)
      );
      const videoEngine = normalizeEngineModelId(
        String(brainRow?.videoEngine ?? falEngines.textToVideo)
      );
      const audioEngine = normalizeEngineModelId(
        String(brainRow?.audioEngine ?? falEngines.textToAudio)
      );
      const voiceEngine = normalizeEngineModelId(
        String(brainRow?.voiceEngine ?? falEngines.textToSpeech)
      );

      const buildEntry = (
        modelId: string,
        durationSec?: number,
        charCount?: number
      ) => {
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
        /** 全模型費率表(按分類,供 UI 展示)— 靜態,模組啟動時計算一次 */
        allPricingByCategory: ALL_PRICING_BY_CATEGORY,
        /** 換算匯率提示 */
        rateNote: "1 USD ≈ 100 pts(點數)。最低扣 1 pt,上限 500 pts/次。",
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

    const status: Record<
      string,
      {
        /** 向後相容欄位:無快取時樂觀回 true */
        healthy: boolean;
        /** 三態:healthy / unhealthy / unverified(尚未探測過) */
        state: "healthy" | "unhealthy" | "unverified";
        consecutiveFailures: number;
        lastError?: string;
      }
    > = {};
    for (const model of Array.from(allModels)) {
      const cached = snapshot[model];
      status[model] = {
        healthy: cached ? cached.healthy : getHealthStatus(model),
        state: getHealthStatusDetailed(model),
        consecutiveFailures: cached?.consecutiveFailures ?? 0,
        lastError: cached?.lastError,
      };
    }

    return status;
  }),

  // AIDV-520：AI provider 系統整體狀態（供 /video UI 顯示容量警告橫幅）
  providerSystemStatus: protectedProcedure.query(() => {
    const probes = getProviderProbeStatus();
    if (probes.length === 0) {
      return { status: "healthy" as const, affectedProviders: [] as string[], lastCheckedAt: null as number | null };
    }
    const failing = probes.filter((p) => !p.ok);
    const status =
      failing.length === 0 ? "healthy" :
      failing.length >= probes.length ? "down" :
      "degraded";
    return {
      status: status as "healthy" | "degraded" | "down",
      affectedProviders: failing.map((p) => p.providerId),
      lastCheckedAt: probes.reduce((max, p) => Math.max(max, p.lastCheckedAt), 0),
    };
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

      // base URL 走統一門面（CF AI Gateway 啟用時自動換軌）。
      const url = `${resolveProviderBaseUrl("elevenlabs")}/v1/text-to-speech/${input.voiceId}`;
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
          ...providerGatewayHeaders("elevenlabs"),
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
          ok: res.ok || (res.status >= 400 && res.status < 500), // 4xx = service alive but auth/schema failed
        };
      } catch (e: unknown) {
        results[name] = {
          latencyMs: Date.now() - start,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // Execute all ping tasks concurrently
    const geminiKey = process.env.GEMINI_API_KEY;
    await Promise.all([
      ping(
        "gemini",
        geminiKey
          ? `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=1`
          : "https://generativelanguage.googleapis.com/v1beta/models",
        { method: "GET" }
      ),
      ping("fal", "https://queue.fal.run/fal-ai/flux/requests", {
        method: "GET",
        headers: process.env.FAL_API_KEY
          ? { Authorization: `Key ${process.env.FAL_API_KEY}` }
          : {},
      }),
      ping("elevenlabs", "https://api.elevenlabs.io/v1/user", {
        method: "GET",
        headers: process.env.ELEVENLABS_API_KEY
          ? { "xi-api-key": process.env.ELEVENLABS_API_KEY }
          : {},
      }),
    ]);

    // Vertex AI — not directly pingable from client; mark as unknown unless credential present
    results["vertex"] = {
      latencyMs: null,
      ok: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
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
    .input(
      z.object({ limit: z.number().min(1).max(200).default(50) }).optional()
    )
    .query(({ input }) => getAlerts(input?.limit ?? 50)),

  /** 管理員關閉警報 */
  dismissAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = dismissAlert(input.alertId, ctx.user.id);
      if (!ok)
        throw new TRPCError({ code: "NOT_FOUND", message: "警報不存在" });
      return { success: true };
    }),

  // ─── 2. 生成錯誤線索系統 ─────────────────────────────────────────────

  /** 取得錯誤線索 */
  errorTraces: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).default(50),
          modality: z
            .enum(["image", "video", "audio", "voice", "llm"])
            .optional(),
        })
        .optional()
    )
    .query(({ input }) => getErrorTraces(input?.limit ?? 50, input?.modality)),

  /** 記錄一個生成錯誤（供其他 router 呼叫，或管理員手動回報） */
  reportError: protectedProcedure
    .input(
      z.object({
        modality: z.enum(["image", "video", "audio", "voice", "llm"]),
        engine: z.string(),
        prompt: z.string().max(2000),
        errorMessage: z.string().max(2000),
        errorCode: z.string().optional(),
        stackHint: z.string().max(1000).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return recordErrorTrace({ ...input, userId: ctx.user.id });
    }),

  /** 標記錯誤已解決 */
  resolveError: adminProcedure
    .input(z.object({ traceId: z.string(), resolution: z.string().max(1000) }))
    .mutation(({ input }) => {
      const ok = resolveErrorTrace(input.traceId, input.resolution);
      if (!ok)
        throw new TRPCError({ code: "NOT_FOUND", message: "錯誤線索不存在" });
      return { success: true };
    }),

  /** 取得錯誤診斷（根因分析 + 步驟式解決方案） */
  diagnoseError: protectedProcedure
    .input(z.object({ traceId: z.string() }))
    .query(({ input }) => {
      const diagnosis = diagnoseError(input.traceId);
      if (!diagnosis)
        throw new TRPCError({ code: "NOT_FOUND", message: "錯誤線索不存在" });
      return diagnosis;
    }),

  /** 取得錯誤分類標籤對照表 */
  errorCategoryLabels: protectedProcedure.query(() => ERROR_CATEGORY_LABELS),

  // ─── 3. 回饋自我反省優化系統 ─────────────────────────────────────────

  /** 取得優化提案清單 */
  proposals: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        })
        .optional()
    )
    .query(({ input }) => getProposals(input?.status)),

  /** 手動建立優化提案 */
  createProposal: protectedProcedure
    .input(
      z.object({
        category: z.enum([
          "prompt_optimization",
          "engine_switch",
          "param_tuning",
          "fallback_update",
          "accuracy_fix",
          "code_quality",
          "security_fix",
          "performance_fix",
        ]),
        title: z.string().min(2).max(200),
        description: z.string().max(8000),
        currentValue: z.string().max(2000),
        proposedValue: z.string().max(2000),
        reasoning: z.string().max(4000),
        confidence: z.number().min(0).max(100),
        severity: z
          .enum(["info", "low", "medium", "high", "critical"])
          .optional(),
        dedupKey: z.string().max(200).optional(),
        filePath: z.string().max(500).optional(),
        lineNumber: z.number().int().nonnegative().optional(),
        codeSnippet: z.string().max(2000).optional(),
      })
    )
    .mutation(({ input }) => createReflectionProposal(input)),

  /**
   * 管理員批准提案。
   *
   * 若 GITHUB_TOKEN + GITHUB_REPO 已設定，會同步嘗試建立 GitHub Issue 並把
   * 連結寫回提案。GitHub 失敗不會讓 mutation 失敗，僅在回傳結果中標示。
   */
  approveProposal: adminProcedure
    .input(
      z.object({ proposalId: z.string(), note: z.string().max(500).optional() })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await approveProposal(
        input.proposalId,
        ctx.user.id,
        input.note
      );
      if (!result.ok)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "提案不存在或已處理",
        });
      return {
        success: true,
        githubSuccess: result.github?.success ?? false,
        githubIssueUrl:
          result.github?.success === true ? result.github.htmlUrl : undefined,
        githubIssueNumber:
          result.github?.success === true ? result.github.number : undefined,
        githubError:
          result.github?.success === false ? result.github.error : undefined,
      };
    }),

  /** 管理員拒絕提案 */
  rejectProposal: adminProcedure
    .input(
      z.object({ proposalId: z.string(), note: z.string().max(500).optional() })
    )
    .mutation(({ ctx, input }) => {
      const ok = rejectProposal(input.proposalId, ctx.user.id, input.note);
      if (!ok)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "提案不存在或已處理",
        });
      return { success: true };
    }),

  // ─── 4. 爬網找資料功能 ──────────────────────────────────────────────

  /** 執行爬網搜尋 */
  webSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(200),
        maxResults: z.number().min(1).max(10).default(5),
      })
    )
    .mutation(async ({ input }) => {
      return webSearch(input.query, input.maxResults);
    }),

  /** 取得歷史研究結果 */
  researchResults: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(200).default(50) }).optional()
    )
    .query(({ input }) => getResearchResults(input?.limit ?? 50)),

  /** 將研究結果加入 LearnHub */
  addResearchToLearnHub: adminProcedure
    .input(z.object({ researchId: z.string() }))
    .mutation(({ input }) => {
      const ok = addResearchToLearnHub(input.researchId);
      if (!ok)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "研究結果不存在或已加入",
        });
      return { success: true };
    }),

  // ─── 5. AI 精準度測試系統 ───────────────────────────────────────────

  /** 取得測試結果歷史 */
  accuracyTests: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(200).default(50) }).optional()
    )
    .query(({ input }) => getAccuracyTests(input?.limit ?? 50)),

  /** 執行單一精準度測試 */
  runAccuracyTest: adminProcedure
    .input(
      z.object({
        engine: z.string(),
        testType: z.enum([
          "response_quality",
          "latency",
          "consistency",
          "error_rate",
        ]),
        testPrompt: z.string().min(1).max(500),
        expectedBehavior: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ input }) => {
      return runAccuracyTest(
        input.engine,
        input.testType,
        input.testPrompt,
        input.expectedBehavior
      );
    }),

  /** 執行全部預定義測試 */
  runAllAccuracyTests: adminProcedure.mutation(async () => {
    return runAllAccuracyTests();
  }),

  /**
   * 執行全站 AI 研究流程（並行：爬網 + 精準度測試 + 全站程式碼掃描 + 錯誤線索分析）。
   *
   * 4 個子任務並行：
   *   1. webSearch × 5（Brave / GitHub fallback）
   *   2. runAllAccuracyTests（5 條測試案例）
   *   3. runFullCodeScan（server/、client/src/、shared/ 啟發式掃描）
   *   4. generateProposalsFromErrorTraces（最近 1 小時錯誤趨勢）
   *
   * 4 個子任務都用 Promise.allSettled 包裝，任一失敗不影響其他結果。
   */
  runFullSiteResearch: adminProcedure.mutation(async () => {
    const researchQueries = [
      "AI self-healing software bug detection 2025",
      "fal.ai API optimization best practices",
      "gemini multimodal production deployment issues",
      "elevenlabs TTS latency optimization",
      "AI video generation pipeline architecture",
    ];

    const startedAt = Date.now();
    const [researchResults, testResults, scanResult, errorProposals] =
      await Promise.all([
        Promise.allSettled(researchQueries.map(query => webSearch(query, 3))),
        runAllAccuracyTests().catch(err => {
          console.warn("[runFullSiteResearch] accuracy tests failed:", err);
          return [] as Awaited<ReturnType<typeof runAllAccuracyTests>>;
        }),
        runFullCodeScan({ topN: 25 }).catch(err => {
          console.warn("[runFullSiteResearch] code scan failed:", err);
          return null;
        }),
        Promise.resolve().then(() => generateProposalsFromErrorTraces()).catch(err => {
          console.warn("[runFullSiteResearch] error trace analysis failed:", err);
          return [] as Awaited<ReturnType<typeof generateProposalsFromErrorTraces>>;
        }),
      ]);

    const successfulResearch = researchResults.filter(
      r => r.status === "fulfilled"
    ).length;
    const accuracyProposals = testResults.filter(t => t.proposal).length;
    const codeScanProposals =
      (scanResult?.proposalsCreated ?? 0) + (scanResult?.proposalsUpdated ?? 0);
    const errorTraceProposals = errorProposals.length;
    const totalProposals =
      accuracyProposals + codeScanProposals + errorTraceProposals;
    const durationMs = Date.now() - startedAt;

    return {
      success: true,
      message: `全站研究完成（${(durationMs / 1000).toFixed(1)}s）：爬網 ${successfulResearch}/${researchQueries.length}、精準度測試 ${testResults.length}、程式碼掃描 ${scanResult?.scan.filesScanned ?? 0} 檔（${scanResult?.scan.findings.length ?? 0} findings）、錯誤線索分析 ${errorTraceProposals} 條 — 共產生 ${totalProposals} 個提案`,
      researchCount: successfulResearch,
      testCount: testResults.length,
      proposalsGenerated: totalProposals,
      breakdown: {
        accuracy: accuracyProposals,
        codeScan: codeScanProposals,
        errorTrace: errorTraceProposals,
      },
      scan: scanResult
        ? {
            filesScanned: scanResult.scan.filesScanned,
            findings: scanResult.scan.findings.length,
            severityCounts: scanResult.scan.severityCounts,
            categoryCounts: scanResult.scan.categoryCounts,
            durationMs: scanResult.scan.durationMs,
          }
        : null,
      durationMs,
    };
  }),

  /** 單獨執行全站程式碼掃描（不跑爬網／精準度測試） */
  runCodeScan: adminProcedure
    .input(z.object({ topN: z.number().min(1).max(100).default(25) }).optional())
    .mutation(async ({ input }) => {
      const result = await runFullCodeScan({ topN: input?.topN ?? 25 });
      return {
        success: true,
        filesScanned: result.scan.filesScanned,
        filesSkipped: result.scan.filesSkipped,
        durationMs: result.scan.durationMs,
        findings: result.scan.findings.length,
        severityCounts: result.scan.severityCounts,
        categoryCounts: result.scan.categoryCounts,
        proposalsCreated: result.proposalsCreated,
        proposalsUpdated: result.proposalsUpdated,
      };
    }),

  /** 取得最近一次掃描的詳細 findings（用於 admin debug） */
  lastCodeScan: adminProcedure.query(() => {
    const result = getLastScanResult();
    if (!result) return null;
    return {
      finishedAt: result.finishedAt,
      filesScanned: result.filesScanned,
      filesSkipped: result.filesSkipped,
      durationMs: result.durationMs,
      severityCounts: result.severityCounts,
      categoryCounts: result.categoryCounts,
      findings: result.findings.slice(0, 100),
    };
  }),

  // ─── GitHub 整合健康檢查 / 重試 ───────────────────────────────────────

  /** 取得 GitHub 整合設定狀態（管理員 UI 用） */
  githubConfigStatus: adminProcedure.query(() => getGithubConfigStatus()),

  /** 測試 GitHub 連線：驗證 token 有效 + 是否可寫入 repo issues */
  testGithubConnection: adminProcedure.mutation(async () => {
    return testGithubConnection();
  }),

  /** 對已核准但未建立 Issue 的提案重新嘗試建立 GitHub Issue */
  retryGithubIssue: adminProcedure
    .input(z.object({ proposalId: z.string() }))
    .mutation(async ({ input }) => {
      const result = await retryGithubIssueForProposal(input.proposalId);
      if (!result.ok && !result.proposal)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: result.reason ?? "提案不存在",
        });
      return {
        success: result.ok,
        reason: result.reason,
        githubIssueUrl:
          result.github?.success === true ? result.github.htmlUrl : undefined,
        githubIssueNumber:
          result.github?.success === true ? result.github.number : undefined,
        githubError:
          result.github?.success === false ? result.github.error : undefined,
      };
    }),

  // ─── 6. 生成活動記錄（AI 監控室）───────────────────────────────────────

  /** 取得生成活動記錄（AI 監控室使用） */
  generationLogs: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(200).default(100) }).optional()
    )
    .query(({ input }) => getGenerationLogs(input?.limit ?? 100)),
});
