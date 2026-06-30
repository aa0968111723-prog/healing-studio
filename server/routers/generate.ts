import { z } from "zod";
import { router, protectedProcedure, brainProcedure } from "../_core/trpc";
import { isDemoMode } from "../_core/googleAuth";
import * as db from "../db";
import {
  invokeLLM,
  extractMessageText,
  extractMessageJson,
  type Message,
} from "../_core/llm";
import { serverEnv } from "../_core/env.validated";
import { isFlagEnabled } from "../_core/flags";
import {
  ensureFalApiKeyConfigured,
  isGeminiEngine,
  ensureGeminiApiKeyConfigured,
} from "../_core/apiGuards";
import { featureFlags } from "../_core/featureFlags";
import { storagePut } from "../storage";
import { TRPCError } from "@trpc/server";
import { generationBus } from "../generationEvents";
import { buildMemoryContext, upsertMemory } from "../services/ragMemory";
import { guardCreativeMemoryContext } from "../services/security/ragInjectionGuard";
import { getGeminiMediaClient } from "../services/geminiMedia";
import { localizeResultUrls, persistExternalMediaUrl } from "../services/internalMedia";
import { eq } from "drizzle-orm";
import { userAiBrain } from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizeEngineModelId } from "../../shared/engineModelIds";
import { applyCameraMotionToPrompt } from "../../shared/cameraMotionPrompt";
import { logger } from "../_core/logger";
import {
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  MODEL_PRICING_CATALOG,
} from "../services/modelPricing";
import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  resolveFalEnginesFromRow,
  DEFAULT_FAL_ENGINES,
  estimateGenerationPoints,
  dispatchFalQueueTask,
} from "../services/falDispatcher";
import {
  doPostGenComplete,
  runPostGenForJob,
  refundJobIfBilled,
  unifiedAssetPrefix,
} from "../services/postGenActions";
import {
  aspectRatioToImageSize,
  getBrainSelectedEngine,
  extFromMime,
  storeBase64Media,
  checkSafety,
  compileElitePrompt,
} from "./_generateHelpers";
import { withTimeout } from "../services/director/templates";
import { signWebhookToken } from "../_core/webhookTokens";

const isDev = process.env.NODE_ENV !== "production";
// eslint-disable-next-line no-console
const debug = isDev ? console.log : () => {};

export const generateRouter = router({
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
    .input(
      z.object({
        generationType: z.enum([
          "image",
          "video",
          "audio",
          "voice",
          "multimodal",
        ]),
        durationSec: z.number().optional(),
        charCount: z.number().optional(),
        overrideEngine: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const demoMode = isDemoMode();
      const overrideEngine = input.overrideEngine
        ? normalizeEngineModelId(input.overrideEngine)
        : undefined;

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
      } catch {
        /* fallback to defaults */
      }

      const falEngines = resolveFalEnginesFromRow(brainRow);
      const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
      const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
      const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
      const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");

      // ── Step 2: 選定本次任務的引擎 ──
      const modalityEngineMap: Record<string, string> = {
        image:
          overrideEngine ??
          String(brainRow?.imageEngine ?? falEngines.textToImage),
        video:
          overrideEngine ??
          String(brainRow?.videoEngine ?? falEngines.textToVideo),
        audio:
          overrideEngine ??
          String(brainRow?.audioEngine ?? falEngines.textToAudio),
        voice:
          overrideEngine ??
          String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
        multimodal:
          overrideEngine ??
          String(brainRow?.imageEngine ?? falEngines.textToImage),
      };
      const selectedEngine =
        modalityEngineMap[input.generationType] ?? "gemini/imagen-3";

      // ── Step 3: 按模型成本估算點數 ──
      const estimate = estimatePoints(selectedEngine, {
        durationSec: input.durationSec,
        charCount: input.charCount,
      });
      const pointsCost = estimate.totalPoints; // 最少 1 pt

      // ── Step 4: 原子扣點（Demo 模式跳過） ──
      let deduction = {
        success: true,
        remainingBefore: 999,
        remainingAfter: 999,
      };
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
          jobType:
            input.generationType === "multimodal"
              ? "multimodal"
              : input.generationType,
          status: "processing",
          progress: 2,
          progressMessage: "準備中...",
        });
      }

      // ── Step 6: 推送初始思維鏈節點（含積分明細） ──
      const modalityLabel =
        input.generationType === "image"
          ? "圖像"
          : input.generationType === "video"
            ? "影片"
            : input.generationType === "audio"
              ? "音樂"
              : "語音";
      const pricing = getModelPricing(selectedEngine);
      const engineLabel = pricing?.label ?? selectedEngine;

      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "safety",
          label: "安全檢查",
          status: "queued",
          detail: "等待中...",
          timestamp: 0,
        },
      });
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "compile",
          label: "提示詞編譯",
          status: "queued",
          detail: "等待中...",
          timestamp: 0,
        },
      });
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "weight",
          label: "視覺權重計算",
          status: "queued",
          detail: "等待中...",
          timestamp: 0,
        },
      });
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "generate",
          label: `${modalityLabel}生成（${engineLabel}）`,
          status: "queued",
          detail: "等待中...",
          timestamp: 0,
        },
      });
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "quota",
          label: "積分扣除",
          status: "completed",
          detail: `扣除 ${pointsCost} pts ｜ ${estimate.breakdown} ｜ 引擎：${engineLabel} ｜ 剩餘：${deduction.remainingAfter} pts`,
          timestamp: Date.now(),
        },
      });
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "history",
          label: "歷史紀錄",
          status: "queued",
          detail: "等待中...",
          timestamp: 0,
        },
      });
      generationBus.emit(jobId, {
        type: "progress",
        progress: 2,
        message: `任務已建立 ｜ ${engineLabel} ｜ ${pointsCost} pts`,
      });

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
    .input(
      z.object({
        generationType: z.enum(["image", "video", "audio", "voice"]),
        durationSec: z.number().optional(),
        charCount: z.number().optional(),
      })
    )
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
      } catch {
        /* fallback */
      }

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
        availabilityNote: !availability.available
          ? availability.reason
          : undefined,
      };
    }),

  multimodal: brainProcedure
    .input(
      z.object({
        jobId: z.number(), // from prepareJob
        prompt: z.string().min(1),
        generationType: z.enum([
          "image",
          "video",
          "audio",
          "voice",
          "multimodal",
        ]),
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
        cameraMotion: z
          .object({
            pan: z.number(),
            zoom: z.number(),
            tilt: z.number(),
          })
          .optional(),
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const jobId = input.jobId;
      const demoMode = isDemoMode();
      const stepTimestamps: Record<string, number> = { start: Date.now() };
      const modalityLabel =
        input.generationType === "image"
          ? "圖像"
          : input.generationType === "video"
            ? "影片"
            : input.generationType === "audio"
              ? "音樂"
              : "語音";

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
      } catch {
        /* use defaults */
      }
      const falEngines = resolveFalEnginesFromRow(brainRow);

      // Resolve which engine was selected for this modality (from brain config)
      const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
      const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
      const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
      const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");
      const _resolvedImageEngine = isGeminiEngine(brainImageEngine)
        ? brainImageEngine!
        : falEngines.textToImage;
      const _resolvedVideoEngine = isGeminiEngine(brainVideoEngine)
        ? brainVideoEngine!
        : falEngines.textToVideo;
      const _resolvedAudioEngine = isGeminiEngine(brainAudioEngine)
        ? brainAudioEngine!
        : falEngines.textToAudio;
      const _resolvedVoiceEngine = isGeminiEngine(brainVoiceEngine)
        ? brainVoiceEngine!
        : falEngines.textToSpeech;
      const _falTextToImageEngine = falEngines.textToImage;
      const _falTextToVideoEngine = falEngines.textToVideo;
      const _falTextToAudioEngine = falEngines.textToAudio;
      const _falTextToSpeechEngine = falEngines.textToSpeech;

      // Estimate real cost for this generation (for api usage log)
      const _genModelId =
        input.generationType === "video"
          ? _resolvedVideoEngine
          : input.generationType === "audio"
            ? _resolvedAudioEngine
            : input.generationType === "voice"
              ? _resolvedVoiceEngine
              : _resolvedImageEngine;
      const _genEstimate = estimatePoints(_genModelId, {
        durationSec:
          input.videoDurationSeconds ??
          (input.generationType === "audio"
            ? (input as any).audioDuration
            : undefined),
        charCount: input.voiceText?.length,
      });
      const _genPricing = getModelPricing(_genModelId);
      const _genEngineLabel = _genPricing?.label ?? _genModelId;

      // Safety pre-check (points already deducted in prepareJob)
      generationBus.emit(jobId, {
        type: "thought-update",
        node: {
          id: "safety",
          label: "安全檢查",
          status: "processing",
          detail: "正在驗證內容安全...",
          timestamp: Date.now(),
        },
      });
      generationBus.emit(jobId, {
        type: "progress",
        progress: 5,
        message: "安全檢查中...",
      });

      const safetyResult = await checkSafety(input.prompt);
      stepTimestamps.safetyDone = Date.now();
      const safetyMs = stepTimestamps.safetyDone - stepTimestamps.start;
      // AIDV-65：只有「確認 safe」才宣告通過。先前無條件 emit passed／通過，
      // 在 fail-closed（旗標 ON＋逾時／錯誤／無法解析回 safe:false）時，前端會
      // 先收到「安全檢查通過」再立刻收到 error 節點，自相矛盾、洩漏錯誤狀態。
      // 把 passed 兩個 emit 移到 safe 確認之後。
      if (safetyResult.safe) {
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "safety",
            label: "安全檢查",
            status: "passed",
            detail: `內容安全檢查通過（${safetyMs}ms）`,
            timestamp: stepTimestamps.safetyDone,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 10,
          message: "安全檢查通過",
        });
      }
      if (!safetyResult.safe) {
        // Emit error via SSE before throwing
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "safety",
            label: "安全檢查",
            status: "error",
            detail: safetyResult.reason || "內容不符合安全規範",
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, {
          type: "error",
          message: safetyResult.reason || "內容不符合安全規範",
        });
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

      if (isGeminiEngine(_genModelId)) {
        ensureGeminiApiKeyConfigured();
      } else {
        ensureFalApiKeyConfigured();
      }

      // ── Vault injection: resolve vault items to image URLs ──
      // 之前用 try/catch 把錯誤吞掉再 console.warn，使用者點「使用此角色」
      // 後送出，看到的結果跟沒選一樣，完全沒辦法分辨「角色找不到」「DB 連
      // 不上」「正常生成」。改成清楚的 BAD_REQUEST，使用者會看到 toast。
      if (input.vaultCharacterId) {
        let vaultChar: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
        try {
          vaultChar = await db.getVaultItem(input.vaultCharacterId);
        } catch (e) {
          console.warn("[Vault] Failed to load character vault item:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "讀取角色保險庫失敗，請稍後重試",
          });
        }
        if (vaultChar && vaultChar.userId != null && vaultChar.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此保險庫項目" });
        }
        if (!vaultChar?.imageUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `保險庫角色 #${input.vaultCharacterId} 找不到或缺少參考圖`,
          });
        }
        debug(
          `[Vault] Injecting character ref from vault #${vaultChar.id}: ${vaultChar.name}`
        );
        // For video: override characterRefUrl; for image: override styleReferenceUrl
        if (input.generationType === "video") {
          input.characterRefUrl =
            input.characterRefUrl || vaultChar.imageUrl;
          input.firstFrameUrl = input.firstFrameUrl || vaultChar.imageUrl;
        } else {
          input.styleReferenceUrl =
            input.styleReferenceUrl || vaultChar.imageUrl;
        }
      }
      if (input.vaultSceneId) {
        let vaultScene: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
        try {
          vaultScene = await db.getVaultItem(input.vaultSceneId);
        } catch (e) {
          console.warn("[Vault] Failed to load scene vault item:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "讀取場景保險庫失敗，請稍後重試",
          });
        }
        if (vaultScene && vaultScene.userId != null && vaultScene.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此保險庫項目" });
        }
        if (!vaultScene?.imageUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `保險庫場景 #${input.vaultSceneId} 找不到或缺少參考圖`,
          });
        }
        debug(
          `[Vault] Injecting scene ref from vault #${vaultScene.id}: ${vaultScene.name}`
        );
        input.vibeReferenceUrl =
          input.vibeReferenceUrl || vaultScene.imageUrl;
      }

      // ── Fine-tuned model injection: append triggerWord + inject LoRA URL ──
      let modelTriggerWord = "";
      let fineTunedLoraUrl: string | undefined;
      if (input.fineTunedModelId) {
        try {
          const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
          if (ftModel) {
            if (ftModel.userId != null && ftModel.userId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此模型" });
            }
            debug(
              `[Model] Injecting fine-tuned model #${ftModel.id}: ${ftModel.name} (status=${ftModel.status})`
            );
            if (ftModel.status !== "ready") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `模型「${ftModel.name}」尚未訓練完成（狀態：${ftModel.status}），請等待訓練完畢再使用`,
              });
            }
            const config = ftModel.configJson as Record<
              string,
              unknown
            > | null;
            if (
              config &&
              typeof config.triggerWord === "string" &&
              config.triggerWord.trim()
            ) {
              modelTriggerWord = config.triggerWord.trim();
              // Prepend trigger word so it appears prominently in compiled prompt
              input.prompt = `${modelTriggerWord}, ${input.prompt}`;
              debug(
                `[Model] Prepended triggerWord "${modelTriggerWord}" to prompt`
              );
            }
            // Extract the trained LoRA weights URL (used for fal.ai sdLora endpoint)
            if (ftModel.trainedLoraUrl) {
              fineTunedLoraUrl = ftModel.trainedLoraUrl;
              debug(
                `[Model] Will inject LoRA weights URL: ${fineTunedLoraUrl}`
              );
            } else if (
              ftModel.fileUrl &&
              (ftModel.fileUrl.endsWith(".safetensors") ||
                ftModel.fileUrl.endsWith(".tar") ||
                ftModel.fileUrl.includes("replicate"))
            ) {
              fineTunedLoraUrl = ftModel.fileUrl;
              debug(
                `[Model] Will inject LoRA fileUrl as weights: ${fineTunedLoraUrl}`
              );
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
            new Promise<string>(resolve =>
              setTimeout(() => resolve(""), 3000)
            ), // 3s 超時
          ]);
        } catch {
          // RAG 失敗靜默降級
        }

        // AIDV-69：RAG 注入安檢（預設 OFF）。memoryContext = buildMemoryContext
        // 回傳的單段字串，內含使用者歷史 prompt 原文（m.prompt，untrusted，可能
        // 先前已被注入污染後回灌）。旗標 ON 時先過 guard 包裹再注入 compileElitePrompt；
        // 旗標 OFF 時 memoryContext 原樣傳入，與現狀**位元相同**。
        // 與 costarService.ts:125-128 對同一個 buildMemoryContext 結果的接法一致。
        // 接線形狀收斂在 guardCreativeMemoryContext（單一真實來源、與測試共用）。
        memoryContext = guardCreativeMemoryContext(memoryContext);

        // Compile elite prompt with reference image awareness
        // ── Compile step ──
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "compile",
            label: "提示詞編譯",
            status: "processing",
            detail: "正在編譯提示詞...",
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 15,
          message: "編譯提示詞中...",
        });
        stepTimestamps.compileStart = Date.now();
        // ── Read AI Brain storyteller config for prompt compilation ──
        const storytellerBrain = ctx.brain?.getBrain?.("storyteller");
        const { compiledPrompt, visualWeight, controlNetParams } =
          await withTimeout(
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
              brainModel: storytellerBrain?.enabled
                ? storytellerBrain.model
                : undefined,
              brainTemperature: storytellerBrain?.enabled
                ? storytellerBrain.temperature
                : undefined,
              brainTopP: storytellerBrain?.enabled
                ? storytellerBrain.topP
                : undefined,
            }),
            30_000,
            "提示詞編譯"
          );

        stepTimestamps.compileDone = Date.now();
        stepTimestamps.weightDone = Date.now();
        const compileMs =
          stepTimestamps.compileDone - stepTimestamps.compileStart;
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "compile",
            label: "提示詞編譯",
            status: "completed",
            detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${compileMs}ms）`,
            timestamp: stepTimestamps.compileDone,
            tokens: compiledPrompt.length,
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "weight",
            label: "視覺權重計算",
            status: "completed",
            detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`,
            timestamp: stepTimestamps.weightDone,
            confidence: visualWeight,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 30,
          message: "提示詞編譯完成",
        });
        if (!demoMode)
          await db.updateBackgroundJob(jobId, {
            progress: 30,
            progressMessage: "正在生成中...",
          });

        // ── Generate step ──
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "generate",
            label: `${modalityLabel}生成`,
            status: "processing",
            detail: `正在生成${modalityLabel}...`,
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 40,
          message: `${modalityLabel}生成中...`,
        });

        // Generate based on type
        let resultUrl: string | undefined;
        let resultData: Record<string, unknown> = {
          visualWeight,
          controlNetParams,
          ...(input.fineTunedModelId && {
            modelUsed: {
              id: input.fineTunedModelId,
              triggerWord: modelTriggerWord,
            },
          }),
          ...(input.vaultCharacterId && {
            vaultCharacterId: input.vaultCharacterId,
          }),
          ...(input.vaultSceneId && { vaultSceneId: input.vaultSceneId }),
        };

        if (
          input.generationType === "image" ||
          input.generationType === "multimodal"
        ) {
          const refImageUrl =
            input.styleReferenceUrl || input.vibeReferenceUrl || undefined;
          let imageUrl: string | undefined;
          const imageEngine = _resolvedImageEngine;
          const imageViaGemini = isGeminiEngine(imageEngine);
          generationBus.emit(jobId, {
            type: "progress",
            progress: 42,
            message: imageViaGemini
              ? "正在呼叫 Gemini 生成圖片..."
              : "正在呼叫 fal.ai 生成圖片...",
          });
          try {
            if (imageViaGemini) {
              const gemini = getGeminiMediaClient();
              const geminiImage = await withTimeout(
                gemini.generateImage({
                  prompt: compiledPrompt,
                  model:
                    imageEngine === "gemini/imagen-3-fast"
                      ? "imagen-3.0-fast-generate-001"
                      : "imagen-3.0-generate-002",
                  aspectRatio:
                    input.aspectRatio === "1:1" ||
                    input.aspectRatio === "3:4" ||
                    input.aspectRatio === "4:3" ||
                    input.aspectRatio === "9:16" ||
                    input.aspectRatio === "16:9"
                      ? input.aspectRatio
                      : undefined,
                  negativePrompt: input.negativePrompt,
                  seed: input.seed,
                  numImages: 1,
                }),
                150_000,
                "Gemini 圖片生成"
              );
              const firstImage = geminiImage.images?.[0];
              if (firstImage?.base64) {
                imageUrl = await storeBase64Media({
                  base64: firstImage.base64,
                  mimeType: firstImage.mimeType || "image/png",
                  prefix: `generated/studio/${userId}/image/gemini`,
                  fallbackExt: "png",
                });
              }
            } else {
              // If user selected a fine-tuned LoRA model and we have the weights URL,
              // route to the sdLora / lora model instead of the standard T2I engine.
              const imageModelId = fineTunedLoraUrl
                ? "fal-ai/lora"
                : refImageUrl
                  ? falEngines.imageToImage
                  : falEngines.textToImage;
              const imageDispatch = await withTimeout(
                dispatchImageGeneration({
                  modelId: imageModelId,
                  prompt: compiledPrompt,
                  negativePrompt: input.negativePrompt,
                  imageUrl: refImageUrl,
                  aspectRatio: input.aspectRatio,
                  seed: input.seed,
                  ...(fineTunedLoraUrl && {
                    loraUrl: fineTunedLoraUrl,
                    loraScale: input.loraWeight ?? 0.8,
                  }),
                }),
                150_000,
                "圖片生成"
              );
              if (imageDispatch.success) {
                imageUrl =
                  (imageDispatch.data as any)?.images?.[0]?.url ??
                  (imageDispatch.data as any)?.image?.url ??
                  ((imageDispatch.data as any)?.url as string | undefined);
                if (imageUrl) {
                  imageUrl = await persistExternalMediaUrl(imageUrl, {
                    category: "image",
                    prefix: `generated/studio/${userId}/image`,
                  });
                }
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `圖片生成失敗（fal.ai ${imageDispatch.modelId}）：${imageDispatch.error || "未知錯誤"}`,
                });
              }
            }
          } catch (err) {
            if (!demoMode) throw err;
            debug(`[Demo] Image generation failed: ${err}`);
          }
          if (!imageUrl) {
            if (!demoMode)
              await db.refundUserPoints(userId, _genEstimate.totalPoints);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "圖片生成未回傳有效 URL，請稍後再試",
            });
          }
          resultUrl = imageUrl;
          resultData.imageUrl = imageUrl;
          resultData.aspectRatio = input.aspectRatio;
          resultData.negativePrompt = input.negativePrompt;
          resultData.styleReferenceUrl = input.styleReferenceUrl;
          resultData.vibeReferenceUrl = input.vibeReferenceUrl;
          resultData.imageModel = imageEngine;
        }

        // ── Video: fal.ai Kling (真實 API，無 Gemini Veo 依賴) ──
        if (
          input.generationType === "video" ||
          input.generationType === "multimodal"
        ) {
          const videoEngine = _resolvedVideoEngine;
          const videoViaGemini = isGeminiEngine(videoEngine);
          generationBus.emit(jobId, {
            type: "progress",
            progress: 45,
            message: videoViaGemini
              ? "正在呼叫 Gemini Veo 生成影片..."
              : "正在呼叫 fal.ai 生成影片...",
          });
          const videoModelId = input.firstFrameUrl
            ? falEngines.imageToVideo
            : falEngines.textToVideo;
          // 鏡頭運動：嵌進 prompt(底層 fal 模型沒有結構化 camera 欄位;
          // cammaster 已下架,詳見 shared/cameraMotionPrompt.ts 註解)
          const videoPromptWithCamera = applyCameraMotionToPrompt(
            compiledPrompt,
            input.cameraMotion
          );
          let videoUrl: string | undefined;
          try {
            if (videoViaGemini) {
              const gemini = getGeminiMediaClient();
              const geminiVideo = await withTimeout(
                gemini.generateVideoSync({
                  prompt: videoPromptWithCamera,
                  model:
                    videoEngine === "gemini/veo-2"
                      ? "veo-2.0-generate-001"
                      : "veo-3.0-generate-preview",
                  imageUrl:
                    input.firstFrameUrl || input.characterRefUrl || undefined,
                  duration: input.videoDurationSeconds || 5,
                  aspectRatio:
                    input.aspectRatio === "9:16" ? "9:16" : "16:9",
                  negativePrompt: input.negativePrompt,
                  seed: input.seed,
                }),
                310_000,
                "Gemini 影片生成"
              );
              videoUrl = geminiVideo.videoUrl;
            } else {
              const videoDispatch = await withTimeout(
                dispatchVideoGeneration({
                  modelId: videoModelId,
                  prompt: videoPromptWithCamera,
                  imageUrl:
                    input.firstFrameUrl || input.characterRefUrl || undefined,
                  durationSec: input.videoDurationSeconds || 5,
                  aspectRatio: input.aspectRatio || "16:9",
                  seed: input.seed,
                }),
                300_000,
                "影片生成"
              );
              if (videoDispatch.success) {
                videoUrl =
                  (videoDispatch.data as any)?.video?.url ??
                  (videoDispatch.data as any)?.videos?.[0]?.url ??
                  ((videoDispatch.data as any)?.url as string | undefined);
                if (videoUrl) {
                  videoUrl = await persistExternalMediaUrl(videoUrl, {
                    category: "video",
                    prefix: `generated/studio/${userId}/video`,
                  });
                }
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `影片生成失敗（fal.ai ${videoDispatch.modelId}）：${videoDispatch.error || "未知錯誤"}`,
                });
              }
            }
          } catch (err) {
            if (!demoMode) throw err;
            debug(`[Demo] Video generation failed: ${err}`);
          }
          if (!videoUrl) {
            if (!demoMode)
              await db.refundUserPoints(userId, _genEstimate.totalPoints);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "fal.ai 影片生成未回傳有效 URL，請稍後再試",
            });
          }
          resultData.videoUrl = videoUrl;
          resultData.videoStatus = "completed";
          resultData.videoDuration = input.videoDurationSeconds || 5;
          resultData.videoModel = videoViaGemini ? videoEngine : videoModelId;
          resultData.videoPrompt = compiledPrompt;
          resultData.firstFrameUrl = input.firstFrameUrl;
          resultData.lastFrameUrl = input.lastFrameUrl;
          resultData.characterRefUrl = input.characterRefUrl;
          resultData.cameraMotion = input.cameraMotion;
          if (!resultUrl) resultUrl = videoUrl;
        }

        // ── Audio: fal.ai stable-audio (真實 API，無 Gemini Lyria 依賴) ──
        if (
          input.generationType === "audio" ||
          input.generationType === "multimodal"
        ) {
          const audioEngine = _resolvedAudioEngine;
          const audioViaGemini = isGeminiEngine(audioEngine);
          generationBus.emit(jobId, {
            type: "progress",
            progress: 45,
            message: audioViaGemini
              ? "正在呼叫 Gemini 生成音樂..."
              : "正在呼叫 fal.ai 生成音樂...",
          });
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
            if (audioViaGemini) {
              const gemini = getGeminiMediaClient();
              const geminiAudio = await withTimeout(
                gemini.generateAudio({
                  prompt: musicPrompt,
                  model: audioEngine === "gemini/musicfx" ? "musicfx-001" : "lyria-002",
                  duration: input.audioDuration || 30,
                  seed: input.seed,
                }),
                180_000,
                "Gemini 音樂生成"
              );
              if (geminiAudio.audioBase64) {
                audioUrl = await storeBase64Media({
                  base64: geminiAudio.audioBase64,
                  mimeType: geminiAudio.mimeType || "audio/wav",
                  prefix: `generated/studio/${userId}/audio/gemini`,
                  fallbackExt: "wav",
                });
              }
            } else {
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
                audioUrl =
                  (audioDispatch.data as any)?.audio?.url ??
                  (audioDispatch.data as any)?.audio_url ??
                  ((audioDispatch.data as any)?.url as string | undefined);
                if (audioUrl) {
                  audioUrl = await persistExternalMediaUrl(audioUrl, {
                    category: "audio",
                    prefix: `generated/studio/${userId}/audio`,
                  });
                }
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `音樂生成失敗（fal.ai ${audioDispatch.modelId}）：${audioDispatch.error || "未知錯誤"}`,
                });
              }
            }
          } catch (err) {
            if (!demoMode) throw err;
            debug(`[Demo] Audio generation failed: ${err}`);
          }
          if (!audioUrl) {
            if (!demoMode)
              await db.refundUserPoints(userId, _genEstimate.totalPoints);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "fal.ai 音樂生成未回傳有效 URL，請稍後再試",
            });
          }
          resultData.audioUrl = audioUrl;
          resultData.audioStatus = "completed";
          resultData.audioTitle = input.musicStyle || "Healing Music";
          resultData.audioModel = audioEngine;
          resultData.musicStyle = input.musicStyle || "ambient healing";
          resultData.isInstrumental = input.isInstrumental;
          resultData.lyrics = input.lyrics;
          resultData.audioDuration = input.audioDuration;
          resultData.audioEnergy = input.audioEnergy;
          if (!resultUrl) resultUrl = audioUrl;
        }

        // ── Voice: fal.ai playai-tts (真實 API，無 Gemini TTS 依賴) ──
        if (input.generationType === "voice") {
          const voiceEngine = _resolvedVoiceEngine;
          const voiceViaGemini = isGeminiEngine(voiceEngine);
          generationBus.emit(jobId, {
            type: "progress",
            progress: 50,
            message: voiceViaGemini
              ? "正在呼叫 Gemini TTS 生成語音..."
              : "正在呼叫 fal.ai TTS 生成語音...",
          });
          const ttsText = input.voiceText || input.prompt;
          // Map emotion to fal.ai playai voice IDs
          const voiceIdMap: Record<string, string> = {
            warm: "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
            calm: "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json",
            cheerful:
              "s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
            serious:
              "s3://voice-cloning-zero-shot/820da3d2-3a3b-42e7-8d14-a0e2bed3c4f3/original/manifest.json",
            gentle:
              "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
            energetic:
              "s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
          };
          const falVoiceId =
            input.voiceModelId ||
            voiceIdMap[input.voiceEmotionType || ""] ||
            "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json";
          let voiceUrl: string | undefined;
          try {
            if (voiceViaGemini) {
              const gemini = getGeminiMediaClient();
              const geminiTTS = await withTimeout(
                gemini.textToSpeech({
                  text: ttsText,
                  model:
                    voiceEngine === "gemini/tts-pro"
                      ? "gemini-2.5-pro-preview-tts"
                      : "gemini-2.5-flash-preview-tts",
                  voiceName: input.voiceModelId || "Zephyr",
                }),
                90_000,
                "Gemini 語音生成"
              );
              if (geminiTTS.audioBase64) {
                voiceUrl = await storeBase64Media({
                  base64: geminiTTS.audioBase64,
                  mimeType: geminiTTS.mimeType || "audio/wav",
                  prefix: `generated/studio/${userId}/voice/gemini`,
                  fallbackExt: "wav",
                });
              }
            } else {
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
                voiceUrl =
                  (voiceDispatch.data as any)?.audio?.url ??
                  (voiceDispatch.data as any)?.audio_url ??
                  ((voiceDispatch.data as any)?.url as string | undefined);
                if (voiceUrl) {
                  voiceUrl = await persistExternalMediaUrl(voiceUrl, {
                    category: "voice",
                    prefix: `generated/studio/${userId}/voice`,
                  });
                }
              } else if (!demoMode) {
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: `語音生成失敗（fal.ai ${voiceDispatch.modelId}）：${voiceDispatch.error || "未知錯誤"}`,
                });
              }
            }
          } catch (err) {
            if (!demoMode) throw err;
            debug(`[Demo] Voice generation failed: ${err}`);
          }
          if (!voiceUrl) {
            if (!demoMode)
              await db.refundUserPoints(userId, _genEstimate.totalPoints);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "fal.ai 語音生成未回傳有效 URL，請稍後再試",
            });
          }
          resultData.voiceUrl = voiceUrl;
          resultData.voiceStatus = "completed";
          resultData.voiceEngine = "fal-tts";
          resultData.voiceModel = voiceEngine;
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
        const generateMs =
          stepTimestamps.generateDone -
          (stepTimestamps.compileDone || stepTimestamps.start);
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "generate",
            label: `${modalityLabel}生成`,
            status: resultUrl ? "completed" : "completed",
            detail: resultUrl
              ? `生成成功（${generateMs}ms）`
              : `已加入佇列（${generateMs}ms）`,
            timestamp: stepTimestamps.generateDone,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 70,
          message: "生成完成，處理後續...",
        });

        // ── Points logging ──
        stepTimestamps.quotaDone = Date.now();
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "quota",
            label: "積分扣除",
            status: "completed",
            detail: `扣除 ${_genEstimate.totalPoints} pts | ${_genEstimate.breakdown} | 引擎：${_genEngineLabel}`,
            timestamp: stepTimestamps.quotaDone,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 80,
          message: `積分已扣除 ${_genEstimate.totalPoints} pts`,
        });

        // Points were already atomically deducted in prepareJob.
        // Log real usage with actual model cost.
        if (!demoMode) {
          await db.createApiUsageLog({
            userId,
            requestType:
              input.generationType === "image"
                ? "image_generation"
                : input.generationType === "video"
                  ? "video_generation"
                  : input.generationType === "audio"
                    ? "audio_generation"
                    : input.generationType === "voice"
                      ? "voice_dubbing"
                      : "image_generation",
            apiProvider:
              _genPricing?.provider ??
              (input.mode === "lightning" ? "gemini_flash" : "gemini_pro"),
            tokensUsed: _genEstimate.totalPoints * 200,
            estimatedCostUsd: (_genEstimate.totalPoints / 100).toFixed(4),
            responseStatus: "success",
            generationsDeducted: _genEstimate.totalPoints,
          });

          // 統一儲存管線：寫入提示詞庫 + 資產庫 + 歷史 + AI 監控室。
          // 替代原本手寫的 db.createDigitalAsset + db.createHistoryEntry —
          // 走 doPostGenComplete 確保所有 AI 生成（含 director / image /
          // video / pro studios + 此處 creative sync 路徑）落入同一條
          // 寫入流程，沒漏網之魚。
          //
          // 注意：multimodal 是 UI 上的 generationType，落到 DB 上必須收
          // 斂到 schema enum 內的 image/video/audio/voice，否則違反
          // assetType / modality 的 mysqlEnum 約束。
          const persistedModality: "image" | "video" | "audio" | "voice" =
            input.generationType === "multimodal"
              ? "image"
              : input.generationType;
          const compiledParameterSnapshot = {
            mode: input.mode,
            temperature: input.temperature,
            vibeCardIds: input.vibeCardIds,
            seed: input.seed,
            loraWeight: input.loraWeight,
            visualWeight,
            controlNetParams,
            ...(input.fineTunedModelId && {
              fineTunedModelId: input.fineTunedModelId,
            }),
            ...(input.vaultCharacterId && {
              vaultCharacterId: input.vaultCharacterId,
            }),
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
          };

          await doPostGenComplete({
            userId,
            modality: persistedModality,
            // _genModelId 已在 prepareJob 推算完成（依 generationType 對應
            // 到 image/video/audio/voice 的最終引擎），這裡剛好可以當作
            // postGen 追蹤的 modelId。
            modelId: _genModelId,
            prompt: input.prompt,
            resultUrl: resultUrl || undefined,
            label: input.prompt.substring(0, 100),
            sourceStudio: "creative",
            parameterSnapshot: compiledParameterSnapshot,
            thumbnailUrl: resultUrl || undefined,
            costCredits: _genEstimate.totalPoints,
            backgroundJobId: jobId,
            compiledPrompt,
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
          resultSummary: resultUrl
            ? `成功生成 ${input.generationType}`
            : undefined,
          vibeCardIds: input.vibeCardIds,
        }).catch(() => {
          /* 靜默降級 */
        });

        // ── History saved event ──
        stepTimestamps.historyDone = Date.now();
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "history",
            label: "歷史紀錄",
            status: "completed",
            detail: "已儲存至生成歷史",
            timestamp: stepTimestamps.historyDone,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 95,
          message: "歷史紀錄已儲存",
        });

        // Build final Chain-of-Thought trace with REAL timestamps from each execution step
        const finalSafetyMs =
          (stepTimestamps.safetyDone || stepTimestamps.start) -
          stepTimestamps.start;
        const finalCompileMs =
          (stepTimestamps.compileDone || stepTimestamps.compileStart || 0) -
          (stepTimestamps.compileStart || stepTimestamps.start);
        const finalGenerateMs =
          stepTimestamps.generateDone -
          (stepTimestamps.compileDone || stepTimestamps.start);
        const thoughtChain = [
          {
            id: "safety",
            label: "安全檢查",
            status: "passed" as const,
            detail: `內容安全檢查通過（${finalSafetyMs}ms）`,
            timestamp: stepTimestamps.safetyDone || stepTimestamps.start,
          },
          {
            id: "compile",
            label: "提示詞編譯",
            status: "completed" as const,
            detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${finalCompileMs}ms）`,
            timestamp: stepTimestamps.compileDone || stepTimestamps.start,
          },
          {
            id: "weight",
            label: "視覺權重計算",
            status: "completed" as const,
            detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`,
            timestamp: stepTimestamps.weightDone || stepTimestamps.start,
          },
          {
            id: "generate",
            label: `${modalityLabel}生成`,
            status: resultUrl
              ? ("completed" as const)
              : ("completed" as const),
            detail: resultUrl
              ? `生成成功（${finalGenerateMs}ms）`
              : `已加入佇列（${finalGenerateMs}ms）`,
            timestamp: stepTimestamps.generateDone,
          },
          {
            id: "quota",
            label: "配額扣除",
            status: "completed" as const,
            detail: "扣除 1 次生成配額",
            timestamp: stepTimestamps.quotaDone || Date.now(),
          },
          {
            id: "history",
            label: "歷史紀錄",
            status: "completed" as const,
            detail: "已儲存至生成歷史",
            timestamp: stepTimestamps.historyDone || Date.now(),
          },
        ];

        // Emit final complete event via SSE
        generationBus.emit(jobId, { type: "complete", thoughtChain });
        // Clean up listeners after a short delay
        setTimeout(() => generationBus.cleanup(jobId), 2000);

        return { jobId, resultUrl, resultData, compiledPrompt, thoughtChain };
      } catch (error) {
        // Transactional integrity: refund points on generation failure
        const errMsg = error instanceof Error ? error.message : "生成失敗";
        const isTimeout = /超時|timeout|timed? ?out|ETIMEDOUT|aborted/i.test(
          errMsg
        );
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
          node: {
            id: "error",
            label: "錯誤",
            status: "error" as const,
            detail: errMsg,
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, { type: "error", message: errMsg });
        setTimeout(() => generationBus.cleanup(jobId), 2000);
        // Zero-Anxiety: friendly message emphasizing no credits were deducted
        const userMessage = isTimeout
          ? "AI 服務回應超時，我們並未扣除您的積分，請稍後重試"
          : "AI 服務連線稍微異常，我們並未扣除您的積分，請稍後重試";
        throw new TRPCError({
          code: isTimeout ? ("TIMEOUT" as any) : "INTERNAL_SERVER_ERROR",
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

  // ─── Background Studio Job Management ──────────────────────────────

  /**
   * submitMultimodalAsync — 創作工作室四模態「背景任務」模式。
   *
   * 流程：
   *   1. 輕量安全檢查（prompt 審核）
   *   2. 從 AI 大腦組態選定引擎
   *   3. prepareJob 扣點 + 建 backgroundJob 記錄
   *   4. 直接送 fal.ai queue（不等待結果）
   *   5. 回傳 { jobId, request_id, modelId, label }
   *
   * 前端收到後呼叫 submitTask() 登錄到 BackgroundTasksContext，
   * 背景輪詢結果，完成後 toast 通知。
   */
  submitMultimodalAsync: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        generationType: z.enum(["image", "video", "audio", "voice"]),
        mode: z.enum(["lightning", "deep_precision"]),
        seed: z.number().optional(),
        // Image params
        aspectRatio: z.string().optional(),
        negativePrompt: z.string().optional(),
        styleReferenceUrl: z.string().nullable().optional(),
        vibeReferenceUrl: z.string().nullable().optional(),
        // Video params
        videoDurationSeconds: z.number().optional(),
        firstFrameUrl: z.string().nullable().optional(),
        lastFrameUrl: z.string().nullable().optional(),
        characterRefUrl: z.string().nullable().optional(),
        cameraMotion: z
          .object({
            pan: z.number(),
            zoom: z.number(),
            tilt: z.number(),
          })
          .optional(),
        // Audio params
        musicStyle: z.string().optional(),
        isInstrumental: z.boolean().optional(),
        audioDuration: z.number().optional(),
        // Voice params
        voiceModelId: z.string().optional(),
        voiceText: z.string().optional(),
        voiceSpeed: z.number().optional(),
        voiceStability: z.number().optional(),
        voiceEmotionType: z.string().optional(),
        voiceEmotionIntensity: z.number().optional(),
        // Vault & Model
        vaultCharacterId: z.number().optional(),
        vaultSceneId: z.number().optional(),
        fineTunedModelId: z.number().optional(),
        loraWeight: z.number().min(0).max(1).optional(),
        // Director AI can override engine model for this request
        overrideModelId: z.string().optional(),
        modelParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // ── 1. 安全檢查 ────────────────────────────────────────────────
      const safetyResult = await checkSafety(
        input.generationType === "voice" && input.voiceText
          ? input.voiceText
          : input.prompt
      );
      if (!safetyResult.safe) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: safetyResult.reason || "內容不符合安全規範",
        });
      }

      // ── 2. 讀取 AI 大腦選定引擎 ────────────────────────────────────
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
      const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
      const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
      const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
      const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");

      // ── 2.4 Vault 注入：把使用者從寶庫挑的角色 / 場景換成參考圖 URL ──
      // 與同步 generate.multimodal 對齊：用 TRPCError 明確報錯，不再 silent
      // fallback。否則使用者點「使用此角色」、提交後生成完全沒角色，無法
      // 分辨「角色找不到」/「DB 故障」/「忘記注入」。
      if (input.vaultCharacterId) {
        let vaultChar: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
        try {
          vaultChar = await db.getVaultItem(input.vaultCharacterId);
        } catch (e) {
          console.warn(
            "[submitAsync][Vault] Failed to load character vault item:",
            e
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "讀取角色保險庫失敗，請稍後重試",
          });
        }
        if (vaultChar && vaultChar.userId != null && vaultChar.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此保險庫項目" });
        }
        if (!vaultChar?.imageUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `保險庫角色 #${input.vaultCharacterId} 找不到或缺少參考圖`,
          });
        }
        if (input.generationType === "video") {
          input.characterRefUrl =
            input.characterRefUrl || vaultChar.imageUrl;
          input.firstFrameUrl =
            input.firstFrameUrl || vaultChar.imageUrl;
        } else if (input.generationType === "image") {
          input.styleReferenceUrl =
            input.styleReferenceUrl || vaultChar.imageUrl;
        }
      }
      if (input.vaultSceneId) {
        let vaultScene: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
        try {
          vaultScene = await db.getVaultItem(input.vaultSceneId);
        } catch (e) {
          console.warn(
            "[submitAsync][Vault] Failed to load scene vault item:",
            e
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "讀取場景保險庫失敗，請稍後重試",
          });
        }
        if (vaultScene && vaultScene.userId != null && vaultScene.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此保險庫項目" });
        }
        if (!vaultScene?.imageUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `保險庫場景 #${input.vaultSceneId} 找不到或缺少參考圖`,
          });
        }
        if (input.generationType === "image") {
          input.vibeReferenceUrl =
            input.vibeReferenceUrl || vaultScene.imageUrl;
        }
      }

      // ── 2.5 微調模型注入：解析使用者選定的 LoRA / 微調模型 ───────────
      // 與同步 generate.execute（routers.ts:1110-1167）行為一致：
      //  - 驗證 status === "ready"，否則明確拒絕
      //  - prepend triggerWord 到 prompt
      //  - 取出 trainedLoraUrl / fileUrl 作為 LoRA weights URL
      let modelTriggerWord = "";
      let fineTunedLoraUrl: string | undefined;
      if (input.fineTunedModelId) {
        try {
          const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
          if (ftModel) {
            if (ftModel.userId != null && ftModel.userId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "無權使用此模型" });
            }
            if (ftModel.status !== "ready") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `模型「${ftModel.name}」尚未訓練完成（狀態：${ftModel.status}），請等待訓練完畢再使用`,
              });
            }
            const config = ftModel.configJson as Record<
              string,
              unknown
            > | null;
            if (
              config &&
              typeof config.triggerWord === "string" &&
              config.triggerWord.trim()
            ) {
              modelTriggerWord = config.triggerWord.trim();
              input.prompt = `${modelTriggerWord}, ${input.prompt}`;
            }
            if (ftModel.trainedLoraUrl) {
              fineTunedLoraUrl = ftModel.trainedLoraUrl;
            } else if (
              ftModel.fileUrl &&
              (ftModel.fileUrl.endsWith(".safetensors") ||
                ftModel.fileUrl.endsWith(".tar") ||
                ftModel.fileUrl.includes("replicate"))
            ) {
              fineTunedLoraUrl = ftModel.fileUrl;
            }
            db.incrementModelUsage(ftModel.id).catch(() => {});
          }
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          console.warn("[submitAsync] Failed to load fine-tuned model:", e);
        }
      }

      // ── 3. 決定 modelId 和 fal input ───────────────────────────────
      let modelId: string;
      let falInput: Record<string, unknown> = {};
      const overrideModelId = input.overrideModelId
        ? normalizeEngineModelId(input.overrideModelId)
        : undefined;
      const modalityLabel =
        input.generationType === "image" ? "圖像" :
        input.generationType === "video" ? "影片" :
        input.generationType === "audio" ? "音樂" : "語音";

      if (input.generationType === "image") {
        const refUrl = input.styleReferenceUrl || input.vibeReferenceUrl;
        const preferredImageEngine = isGeminiEngine(brainImageEngine)
          ? brainImageEngine!
          : refUrl
            ? falEngines.imageToImage
            : falEngines.textToImage;
        // 若使用者選了訓練模型且取得 LoRA URL，強制切到 fal-ai/lora
        // （或使用者已用 overrideModelId 指定支援 LoRA 的模型）
        modelId = fineTunedLoraUrl
          ? "fal-ai/lora"
          : overrideModelId ?? preferredImageEngine;
        falInput = {
          prompt: input.prompt,
          ...(input.aspectRatio && { aspect_ratio: input.aspectRatio }),
          ...(input.negativePrompt && { negative_prompt: input.negativePrompt }),
          ...(refUrl && { image_url: refUrl }),
          ...(input.seed != null && { seed: input.seed }),
          ...(fineTunedLoraUrl && {
            loras: [
              {
                path: fineTunedLoraUrl,
                scale: input.loraWeight ?? 0.8,
              },
            ],
            // fal-ai/lora 使用 image_size 而非 aspect_ratio
            image_size: aspectRatioToImageSize(input.aspectRatio),
          }),
        };
      } else if (input.generationType === "video") {
        const hasFirstFrame = !!input.firstFrameUrl;
        const preferredVideoEngine = isGeminiEngine(brainVideoEngine)
          ? brainVideoEngine!
          : hasFirstFrame || input.characterRefUrl
            ? falEngines.imageToVideo
            : falEngines.textToVideo;
        modelId =
          overrideModelId ??
          preferredVideoEngine;
        // i2v 來源圖：firstFrameUrl 優先、其次 characterRefUrl（與同步流程
        // routers.ts:1675 / videoStudio.klingImageToVideo 一致）
        const i2vImageUrl = input.firstFrameUrl || input.characterRefUrl;
        // 鏡頭運動：底層 fal 影片模型(kling/wan/veo)沒有結構化 camera 欄位,
        // 把滑桿值翻成 prompt 文字。fal-ai/cammaster 雖然吃 camera_motion enum,
        // 但已在 fal 下架(catalog disabled,auto-substitute 到 kling-pro),
        // 走 prompt 是唯一對所有模型都有效的路徑。
        const videoPrompt = applyCameraMotionToPrompt(input.prompt, input.cameraMotion);
        falInput = {
          prompt: videoPrompt,
          ...(input.videoDurationSeconds && { duration: String(input.videoDurationSeconds) }),
          ...(i2vImageUrl && { image_url: i2vImageUrl }),
          // Kling 結束幀正確欄位是 tail_image_url（見 videoStudio.klingImageToVideo:442）
          ...(input.lastFrameUrl && { tail_image_url: input.lastFrameUrl }),
          ...(input.seed != null && { seed: input.seed }),
        };
      } else if (input.generationType === "audio") {
        const preferredAudioEngine = isGeminiEngine(brainAudioEngine)
          ? brainAudioEngine!
          : falEngines.textToAudio;
        modelId = overrideModelId ?? preferredAudioEngine;
        // ace-step / musicgen / mmaudio 用 duration；style + instrumental 折入
        // prompt（與 proStudio.textToMusic:464-476 一致）。
        const audioPromptParts = [input.prompt];
        if (input.musicStyle) audioPromptParts.push(input.musicStyle);
        if (input.isInstrumental) audioPromptParts.push("instrumental, no vocals");
        falInput = {
          prompt: audioPromptParts.join(", "),
          ...(input.audioDuration && { duration: input.audioDuration }),
          ...(input.seed != null && { seed: input.seed }),
        };
      } else {
        // voice
        const voicePrompt = input.voiceText ?? input.prompt;
        const preferredVoiceEngine = isGeminiEngine(brainVoiceEngine)
          ? brainVoiceEngine!
          : falEngines.textToSpeech;
        modelId = overrideModelId ?? preferredVoiceEngine;
        // ElevenLabs 系列 TTS 用 voice_id + nested voice_settings（見
        // proStudio.elevenLabsTTS:683-690）。speed 為 fal.ai 接受的 top-level 別名。
        const voiceSettings: Record<string, unknown> = {};
        if (input.voiceStability != null) voiceSettings.stability = input.voiceStability;
        falInput = {
          text: voicePrompt,
          ...(input.voiceModelId && { voice_id: input.voiceModelId }),
          ...(input.voiceSpeed != null && { speed: input.voiceSpeed }),
          ...(Object.keys(voiceSettings).length > 0 && { voice_settings: voiceSettings }),
          ...(input.seed != null && { seed: input.seed }),
        };
      }
      falInput = {
        ...falInput,
        ...(input.modelParams ?? {}),
      };

      if (isGeminiEngine(modelId)) {
        ensureGeminiApiKeyConfigured();
      } else {
        ensureFalApiKeyConfigured();
      }

      // ── 4. prepareJob：扣點 + 建 backgroundJob 記錄 ────────────────
      const durationSec =
        input.generationType === "video" ? input.videoDurationSeconds :
        input.generationType === "audio" ? input.audioDuration : undefined;
      const charCount =
        input.generationType === "voice" ? (input.voiceText?.length) : undefined;

      const estimate = estimatePoints(modelId, { durationSec, charCount });
      const points = estimate.totalPoints;

      if (!isDemoMode()) {
        const deductResult = await db.deductUserPoints(userId, points);
        if (!deductResult.success) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `積分不足（需要 ${points} pts，目前 ${deductResult.remainingBefore} pts）`,
          });
        }
      }

      // 建立 background_job 記錄（先 processing，拿到 request_id 後更新）
      // costPoints 寫進 resultJson — 兩條後續流程會用到:
      //   1. runPostGenForJob → doPostGenComplete: 寫入 generation_history.costCredits
      //   2. refundJobIfBilled: 失敗路徑（webhook ERROR / 超時 / no-URL）退點依據
      const label = `${modalityLabel}生成`;
      const jobId = await db.createBackgroundJob({
        userId,
        jobType: input.generationType as any,
        status: "processing",
        progress: 5,
        progressMessage: `${label} 已提交佇列...`,
        resultJson: {
          studioType: input.generationType,
          label,
          modelId,
          prompt: (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "",
          costPoints: points,
        },
      });

      // ── 5. 依引擎供應商送出任務 ───────────────────────────────────────
      try {
        if (isGeminiEngine(modelId)) {
          const gemini = getGeminiMediaClient();
          let resultUrl: string | undefined;

          if (input.generationType === "image") {
            const imageRes = await gemini.generateImage({
              prompt: input.prompt,
              model:
                modelId === "gemini/imagen-3-fast"
                  ? "imagen-3.0-fast-generate-001"
                  : "imagen-3.0-generate-002",
              aspectRatio:
                input.aspectRatio === "1:1" ||
                input.aspectRatio === "3:4" ||
                input.aspectRatio === "4:3" ||
                input.aspectRatio === "9:16" ||
                input.aspectRatio === "16:9"
                  ? input.aspectRatio
                  : undefined,
              negativePrompt: input.negativePrompt,
              seed: input.seed,
              numImages: 1,
            });
            const firstImage = imageRes.images?.[0];
            if (firstImage?.base64) {
              resultUrl = await storeBase64Media({
                base64: firstImage.base64,
                mimeType: firstImage.mimeType || "image/png",
                prefix: `generated/studio/${userId}/image/gemini-async`,
                fallbackExt: "png",
              });
            }
          } else if (input.generationType === "video") {
            const videoRes = await gemini.generateVideoSync({
              prompt: applyCameraMotionToPrompt(input.prompt, input.cameraMotion),
              model:
                modelId === "gemini/veo-2"
                  ? "veo-2.0-generate-001"
                  : "veo-3.0-generate-preview",
              imageUrl: input.firstFrameUrl || input.characterRefUrl || undefined,
              duration: input.videoDurationSeconds || 5,
              aspectRatio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
              negativePrompt: input.negativePrompt,
              seed: input.seed,
            });
            resultUrl = videoRes.videoUrl;
          } else if (input.generationType === "audio") {
            const audioRes = await gemini.generateAudio({
              prompt: input.prompt,
              model: modelId === "gemini/musicfx" ? "musicfx-001" : "lyria-002",
              duration: input.audioDuration || 30,
              seed: input.seed,
            });
            if (audioRes.audioBase64) {
              resultUrl = await storeBase64Media({
                base64: audioRes.audioBase64,
                mimeType: audioRes.mimeType || "audio/wav",
                prefix: `generated/studio/${userId}/audio/gemini-async`,
                fallbackExt: "wav",
              });
            }
          } else {
            const ttsRes = await gemini.textToSpeech({
              text: input.voiceText ?? input.prompt,
              model:
                modelId === "gemini/tts-pro"
                  ? "gemini-2.5-pro-preview-tts"
                  : "gemini-2.5-flash-preview-tts",
              voiceName: input.voiceModelId || "Zephyr",
            });
            if (ttsRes.audioBase64) {
              resultUrl = await storeBase64Media({
                base64: ttsRes.audioBase64,
                mimeType: ttsRes.mimeType || "audio/wav",
                prefix: `generated/studio/${userId}/voice/gemini-async`,
                fallbackExt: "wav",
              });
            }
          }

          if (!resultUrl) {
            throw new Error("Gemini 生成未回傳可用結果");
          }

          const requestId = `gemini-sync-${jobId}-${Date.now()}`;
          const promptForJob = (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "";
          await db.updateBackgroundJob(jobId, {
            status: "completed",
            progress: 100,
            progressMessage: `${label} 已完成`,
            resultJson: {
              studioType: input.generationType,
              label,
              modelId,
              requestId,
              resultUrl,
              prompt: promptForJob,
              costPoints: points,
            } as any,
          });

          // 後置動作：儲存提示詞庫 + 數位資產 + 生成歷史 + AI 監控室
          void doPostGenComplete({
            userId,
            modality: input.generationType,
            modelId,
            prompt: promptForJob,
            resultUrl,
            label,
            sourceStudio: "creative",
            costCredits: points,
          });

          return {
            jobId,
            request_id: requestId,
            modelId,
            label,
            generationType: input.generationType,
          };
        }

        // 若設定 VITE_SITE_URL，組出帶 jobId 的 webhook URL；fal.ai 完成時
        // 會主動 POST 到 /api/webhook/fal?jobId=<id>，瀏覽器關閉也能持久化結果。
        // AIDV-158：附帶 per-job capability token，handler 端會驗（缺/錯 token 一律 4xx），
        // 防偽造回呼用攻擊者可控 URL 把別人的 job 標完成。
        const siteUrl = process.env.VITE_SITE_URL?.trim();
        const falToken = signWebhookToken("fal", jobId);
        const falWebhookUrl = siteUrl
          ? `${siteUrl}/api/webhook/fal?jobId=${jobId}${falToken ? `&token=${falToken}` : ""}`
          : undefined;

        // 使用 dispatchFalQueueTask 而非裸 submitToFalQueue:
        // - 不認識的 modelId 會降級到該分類的 fallback chain 首選
        // - ultra-tier 影片模型送出前先做 preflight 健康探測,避免使用者
        //   等待 5–10 分鐘才發現模型損毀。
        const queueCategory: string =
          input.generationType === "image"
            ? input.styleReferenceUrl || input.vibeReferenceUrl
              ? "image-to-image"
              : "text-to-image"
            : input.generationType === "video"
              ? input.firstFrameUrl || input.characterRefUrl
                ? "image-to-video"
                : "text-to-video"
              : input.generationType === "audio"
                ? "text-to-audio"
                : "text-to-speech";
        const queueModalityForTrace =
          input.generationType === "image"
            ? "image"
            : input.generationType === "video"
              ? "video"
              : input.generationType === "audio"
                ? "audio"
                : "voice";
        const queueResult = await dispatchFalQueueTask({
          modelId,
          category: queueCategory,
          input: falInput,
          webhookUrl: falWebhookUrl,
          route: "trpc.generate.submitMultimodalAsync",
          modality: queueModalityForTrace,
          userId,
        });
        const request_id = queueResult.request_id;
        // 若 dispatcher 因為 modelId 不在 catalog 而降級,以實際送出的模型為準,
        // 確保前端用 checkStudioJob 輪詢時能命中正確的 fal queue endpoint。
        const submittedModelId = queueResult.modelId;

        // 更新 job 記錄，加入 requestId（checkStudioJob 輪詢需要）
        // costPoints 必須保留 — 否則 refundJobIfBilled 在失敗路徑找不到金額。
        await db.updateBackgroundJob(jobId, {
          resultJson: {
            studioType: input.generationType,
            label,
            modelId: submittedModelId,
            requestId: request_id,
            prompt: (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "",
            costPoints: points,
            ...(queueResult.degraded && queueResult.originalModel
              ? { originalModel: queueResult.originalModel, degraded: true }
              : {}),
          } as any,
        });

        return {
          jobId,
          request_id,
          modelId: submittedModelId,
          label,
          generationType: input.generationType,
          ...(queueResult.degraded && queueResult.originalModel
            ? { degraded: true, originalModel: queueResult.originalModel }
            : {}),
        };
      } catch (err) {
        // queue submit 失敗 → 退款 + 標記失敗
        if (!isDemoMode()) {
          await db.refundUserPoints(userId, points);
        }
        await db.updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "提交失敗",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${modalityLabel}生成提交失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
        });
      }
    }),

  /**
   * submitStudioJob — 將專業工作室的非同步任務（Image / Video / Audio）
   * 登錄到 background_jobs 表，使其可在任意頁面追蹤。
   */
  submitStudioJob: protectedProcedure
    .input(
      z.object({
        studioType: z.enum(["image", "video", "audio", "voice"]),
        requestId: z.string().min(1),
        modelId: z.string().min(1),
        label: z.string().max(200).optional(),
        prompt: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const jobId = await db.createBackgroundJob({
        userId: ctx.user.id,
        jobType: input.studioType,
        status: "processing",
        progress: 0,
        progressMessage: `${input.label ?? input.studioType} 生成中...`,
        resultJson: {
          requestId: input.requestId,
          modelId: input.modelId,
          studioType: input.studioType,
          label: input.label,
          prompt: input.prompt ?? "",
        },
      });
      return { jobId };
    }),

  /**
   * checkStudioJob — 檢查已提交的工作室背景任務狀態。
   * 如果任務仍在 processing，會即時向 fal.ai 查詢並更新 DB。
   * ⚠️ 超過 10 分鐘仍未完成的任務會自動標記為失敗。
   */
  checkStudioJob: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getBackgroundJob(input.jobId);
      if (!job) return null;
      // 權限檢查
      if (job.userId !== ctx.user.id) return null;
      // 已完成/失敗 → 直接回傳
      if (job.status !== "processing") return job;

      // ── 超時偵測：超過 30 分鐘未完成 → 自動標記失敗 ─────────
      // 影片、3D、音樂等重型生成任務最多需要 20–25 分鐘，留 30 分鐘緩衝
      const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 分鐘
      const createdTime = job.createdAt
        ? new Date(job.createdAt).getTime()
        : 0;
      if (
        createdTime > 0 &&
        Date.now() - createdTime > STALE_JOB_TIMEOUT_MS
      ) {
        const timeoutMsg =
          "任務已超時（超過 30 分鐘），請嘗試更換模型或簡化描述後重試";
        await db.updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: timeoutMsg,
        });
        // 退回 submitMultimodalAsync 預扣的點數 — 任務超時不應讓使用者買單。
        // refundJobIfBilled 內以 meta.refunded 旗標冪等,polling/webhook 同時
        // 偵測到 stale 也只會退一次。
        void refundJobIfBilled(job.id);
        return {
          ...job,
          status: "failed" as const,
          errorMessage: timeoutMsg,
        };
      }

      const meta = job.resultJson as Record<string, unknown> | null;
      const requestId = meta?.requestId as string | undefined;
      const modelId = meta?.modelId as string | undefined;
      if (!requestId || !modelId) return job;

      // 向 fal.ai queue 查詢狀態
      const falKey = process.env.FAL_API_KEY;
      if (!falKey) return job;

      try {
        // ⚠️ 改用 falQueueFetchWithPrefixFallback:
        //   有些 modelId（例如 fal-ai/kling-video/v2.1/pro/image-to-video）
        //   submit 走完整路徑沒問題,但 queue tracking 端點是 fal-ai/kling-video,
        //   裸 fetch 會 404 → 過去 checkStudioJob 拿到 404 直接 return job,
        //   讓任務卡在 "processing" 直到 30 分鐘超時。
        const { falQueueFetchWithPrefixFallback } = await import(
          "../services/falQueueClient"
        );
        const { extractFalMediaUrl } = await import(
          "../services/falQueueAwaiter"
        );

        const statusRes = await falQueueFetchWithPrefixFallback(
          modelId,
          requestId,
          "/status",
          falKey
        );
        if (!statusRes.ok) return job;
        const statusData = (await statusRes.json()) as Record<
          string,
          unknown
        >;
        const s = (statusData.status ?? statusData.state) as
          | string
          | undefined;

        if (s === "COMPLETED") {
          const resultRes = await falQueueFetchWithPrefixFallback(
            modelId,
            requestId,
            "",
            falKey
          );
          const resultData = resultRes.ok ? await resultRes.json() : null;

          // 從結果中提取 URL（先用通用 extractor — 涵蓋 root / data / output /
          // result 四種 envelope + video.url / video_url / images[0].url 等 shape）。
          const localizedResult = (await localizeResultUrls(
            resultData,
            unifiedAssetPrefix({
              userId: ctx.user.id,
              source: "background",
              modelId,
            })
          )) as Record<string, unknown> | null;
          const r = localizedResult;
          const extracted = extractFalMediaUrl(r);
          const resultUrl =
            extracted.output_url ??
            // 通用 extractor 不認得的尾巴情境再 fallback（音效 / 拆幹 / 3D / dubbing / STT）
            ((r?.audio_file as any)?.url as string | undefined) ??
            ((r?.vocals as any)?.url as string | undefined) ??
            ((r?.speaker_embedding as any)?.url as string | undefined) ??
            ((r?.output as any)?.url as string | undefined) ??
            ((r?.model_glb as any)?.url as string | undefined) ??
            ((r?.dubbed_url as string | undefined)) ??
            ((r as any)?.text as string | undefined) ??
            ((r as any)?.transcript as string | undefined) ??
            null;

          // ⚠️ 重要：若 fal 回 COMPLETED 但 URL 抽不到（fal 回了奇怪的 shape /
          // 模型路徑 stripping 失敗 / localize 全部失敗），不要靜默標 completed
          // 然後留一張無預覽無下載的卡片在使用者「成品輸出庫」裡 — 改成標 failed,
          // 寫清楚 errorMessage,讓使用者能重試或聯絡支援。
          if (!resultUrl) {
            const errMsg =
              "生成已完成但無法解析結果連結（fal 回傳格式異常），請重試或更換模型";
            await db.updateBackgroundJob(job.id, {
              status: "failed",
              errorMessage: errMsg,
              resultJson: {
                ...meta,
                result: localizedResult,
                rawCompletedAt: new Date().toISOString(),
              },
            });
            // fal 回 COMPLETED 但抽不到 URL — 使用者拿不到成品,退款。
            void refundJobIfBilled(job.id);
            return {
              ...job,
              status: "failed" as const,
              errorMessage: errMsg,
            };
          }

          // 把 resultUrl + 各模態 top-level URL 都寫進去 — 前端的
          // mediaUrlFromResult 會優先讀 r.resultUrl,但歷史代碼 / 不同頁面
          // 可能讀 r.videoUrl / r.imageUrl / r.audioUrl,一次寫齊。
          const nextJson: Record<string, unknown> = {
            ...meta,
            resultUrl,
            result: localizedResult,
          };
          if (extracted.video_url) nextJson.videoUrl = extracted.video_url;
          if (extracted.image_url) nextJson.imageUrl = extracted.image_url;
          if (extracted.audio_url) nextJson.audioUrl = extracted.audio_url;

          await db.updateBackgroundJob(job.id, {
            status: "completed",
            progress: 100,
            progressMessage: "生成完成",
            resultJson: nextJson,
          });

          // 後置動作（idempotent，與 webhookFal 同時抵達也只跑一次）：
          // 儲存提示詞庫 + 數位資產 + 生成歷史 + AI 監控室
          void runPostGenForJob(job.id);

          return {
            ...job,
            status: "completed" as const,
            progress: 100,
            progressMessage: "生成完成",
            resultJson: nextJson,
          };
        }

        if (s === "FAILED") {
          const errMsg = String(
            statusData.error ?? statusData.message ?? "生成失敗"
          );
          await db.updateBackgroundJob(job.id, {
            status: "failed",
            errorMessage: errMsg,
          });
          // fal queue FAILED — 退回預扣點數（與 webhook ERROR 路徑對稱）。
          void refundJobIfBilled(job.id);
          return { ...job, status: "failed" as const, errorMessage: errMsg };
        }
      } catch (err) {
        // fal.ai 暫時不可用（transient）— 保持 processing 讓下次 poll 重試。
        // AIDV-792: 加 warn log 確保可觀測，不繼續靜默吞掉。
        logger.warn("checkStudioJob: fal.ai status check failed, keeping processing", {
          jobId: job.id,
          requestId,
          modelId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      return job;
    }),

  /**
   * activeJobs — 回傳使用者所有進行中的背景任務 + 近 24 小時已完成的任務。
   * 供全域 BackgroundTasksDrawer 使用。
   */
  activeJobs: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) return [];
    const { backgroundJobs } = await import("../../drizzle/schema");
    const { eq, and, or, gte, desc } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return database
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.userId, ctx.user.id),
          or(
            // 所有進行中的任務
            eq(backgroundJobs.status, "queued"),
            eq(backgroundJobs.status, "processing"),
            // 近 24 小時已完成的任務
            and(
              or(
                eq(backgroundJobs.status, "completed"),
                eq(backgroundJobs.status, "failed")
              ),
              gte(backgroundJobs.updatedAt, cutoff)
            )
          )
        )
      )
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(50);
  }),

  // listCompletedMedia 已於 2026-05 合併移除:原本只供 VaultPage 的
  // 「成品輸出庫」子分頁使用,但該子分頁與「數位資產庫」是同一份資料,
  // 已併入後者(資料層由 postGenActions 寫進 digital_asset_library,
  // UI 由 AssetsLibrary 統一承接)。前端已無呼叫者。

  /**
   * recordGenResult — 記錄同步生成結果（無背景任務的情況）。
   * 供 ImageStudio 等直接回傳同步結果的頁面呼叫，執行：
   *   1-2. 儲存提示詞到提示詞庫
   *   1-3. 儲存到數位資產庫 + 生成歷史
   *   1-4. 記錄到 AI 監控室
   */
  recordGenResult: protectedProcedure
    .input(
      z.object({
        modality: z.enum(["image", "video", "audio", "voice"]),
        modelId: z.string().max(200),
        prompt: z.string().max(2000).optional(),
        resultUrl: z.string().url().optional(),
        label: z.string().max(200).optional(),
        sourceStudio: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await doPostGenComplete({
        userId: ctx.user.id,
        modality: input.modality,
        modelId: input.modelId,
        prompt: input.prompt,
        resultUrl: input.resultUrl,
        label: input.label,
        sourceStudio: input.sourceStudio ?? "image",
      });
      return { success: true };
    }),
});
