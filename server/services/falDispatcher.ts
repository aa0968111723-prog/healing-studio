/**
 * falDispatcher.ts — Unified Fal.ai Model Dispatch Layer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 統一入口，根據 AI 大腦組態選取對應 Fal.ai 模型並執行：
 *  - 讀取使用者的 userAiBrain falXxxEngine 欄位選定的模型
 *  - 參數映射（FalInputSchema → 實際 API 參數）
 *  - 逾時保護 + 指數退避重試
 *  - 點數估算回傳（供扣點系統使用）
 *
 * 設計原則：
 *  1. 每個任務類型有獨立的 dispatch 函數
 *  2. 若選定模型不可用，自動降級到同類別的次佳模型
 *  3. 所有呼叫返回統一的 FalDispatchResult 結構
 */

import {
  callFalModel,
  getFalModelById,
  getFalModelsByCategory,
  type FalCallInput,
} from "./falModels";
import { calculateActualCost, estimatePoints, getModelPricing } from "./modelPricing";
import { deductCredits, reconcileCredits } from "./orbCostGuard";
import { serverEnv } from "../_core/env.validated";

// ─── LangSmith 追蹤（fal.ai 多模態模型深度整合）──────────────────────────────

let _langSmithClient: import("langsmith").Client | null = null;

async function getFalLangSmithClient(): Promise<
  import("langsmith").Client | null
> {
  const apiKey = serverEnv.LANGSMITH_API_KEY?.trim();
  if (!apiKey) return null;
  if (_langSmithClient) return _langSmithClient;
  try {
    const { Client } = await import("langsmith");
    _langSmithClient = new Client({
      apiKey,
      apiUrl:
        serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
    });
    return _langSmithClient;
  } catch {
    return null;
  }
}

/**
 * 記錄 fal.ai 任務到 LangSmith
 * run_type 使用 "tool"（fal.ai 任務屬於工具呼叫，非 LLM 對話）
 */
async function trackFalLangSmith(opts: {
  runId: string;
  modelId: string;
  category: string;
  prompt: string | undefined;
  inputs: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
  pointsDeducted: number;
  degraded: boolean;
  originalModel?: string;
}): Promise<void> {
  const client = await getFalLangSmithClient();
  if (!client) return;

  const projectName = serverEnv.LANGSMITH_PROJECT || "網站";
  const endTime = Date.now();
  const startTime = endTime - opts.durationMs;

  // run_name 格式：模態類別 / 模型ID（方便在 LangSmith 儀表板篩選）
  const runName = `fal/${opts.category}/${opts.modelId.replace("fal-ai/", "")}`;

  try {
    await client.createRun({
      id: opts.runId,
      name: runName,
      run_type: "tool",
      project_name: projectName,
      start_time: startTime,
      end_time: endTime,
      inputs: {
        model_id: opts.modelId,
        category: opts.category,
        prompt: opts.prompt?.slice(0, 500) ?? "(無文字提示)",
        ...Object.fromEntries(
          Object.entries(opts.inputs)
            .filter(([k]) => !["prompt"].includes(k))
            .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v])
        ),
      },
      outputs: opts.result
        ? {
            success: true,
            data_keys: Object.keys(opts.result),
            points_deducted: opts.pointsDeducted,
            degraded: opts.degraded,
            ...(opts.originalModel
              ? { original_model: opts.originalModel }
              : {}),
            token_usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: opts.pointsDeducted,
            },
          }
        : {},
      error: opts.error ?? undefined,
      extra: {
        metadata: {
          provider: "fal.ai",
          model_id: opts.modelId,
          category: opts.category,
          duration_ms: opts.durationMs,
          points_deducted: opts.pointsDeducted,
          degraded: opts.degraded,
          ...(opts.originalModel ? { original_model: opts.originalModel } : {}),
        },
      },
    });
  } catch {
    // LangSmith 追蹤失敗不影響主流程
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface FalDispatchResult {
  success: boolean;
  modelId: string;
  modelLabel: string;
  category: string;
  data: Record<string, unknown>;
  durationMs: number;
  pointsDeducted: number;
  pointsBreakdown: string;
  error?: string;
  degraded?: boolean; // true if fell back to alternative model
  originalModel?: string; // model that was requested before fallback
}

export interface FalDispatchInput {
  /** 使用者選定的 Fal 任務引擎 modelId（來自 AI 大腦組態） */
  modelId: string;
  category: string;
  /** 任務輸入參數 */
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  negativePrompt?: string;
  seed?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  imageSize?: string;
  aspectRatio?: string;
  /** 影片時長（秒），用於計費 */
  durationSec?: number;
  strength?: number;
  loraUrl?: string;
  loraScale?: number;
  numFrames?: number;
  fps?: number;
  voiceId?: string;
  speed?: number;
  exaggeration?: number;
  trainingSteps?: number;
  learningRate?: number;
  stylePrompt?: string;
  motionBucketId?: number;
  condAugmentation?: number;
  /** 文字字符數（用於 TTS 計費） */
  charCount?: number;
  userId?: number;
  estimatedCredits?: number;
  modelParams?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fallback chain for each category
// ═══════════════════════════════════════════════════════════════════════════

/** 模型特定的超時覆寫（毫秒）—— 影片/3D 模型需要更長時間 */
const TIMEOUT_OVERRIDES: Record<string, number> = {
  "fal-ai/kling-video/v2.1/pro/text-to-video": 240_000,
  "fal-ai/kling-video/v2.1/standard/text-to-video": 240_000,
  "fal-ai/kling-video/v2.1/pro/image-to-video": 240_000,
  "fal-ai/kling-video/v2.1/standard/image-to-video": 240_000,
  "fal-ai/kling-video/v2.1/standard/video-to-video": 240_000,
  "fal-ai/wan-t2v": 200_000,
  "fal-ai/wan-i2v": 200_000,
  "fal-ai/wan-ai/wan2.1-t2v-720p": 200_000,
  "fal-ai/wan-ai/wan2.1-i2v-720p": 200_000,
  "fal-ai/wan-ai/wan2.1-v2v-480p": 200_000,
  "fal-ai/wan/v2.1/video-to-video": 200_000,
  "fal-ai/kling-video/v1.6/standard/video-to-video": 240_000,
  "fal-ai/animatediff-v2v": 300_000,
  // 畫質優化（enhance）：Topaz 專業降噪可達 5–10 分鐘
  "fal-ai/bytedance/upscaler/video": 300_000,
  "fal-ai/rife-v4.6/video": 240_000,
  "fal-ai/topaz/video-enhance": 600_000,
  // 進階控制（control）：CamMaster / Vidu / DepthCrafter
  "fal-ai/cammaster": 300_000,
  "fal-ai/vidu/q1/reference-to-video": 300_000,
  "fal-ai/depthcrafter": 300_000,
  "fal-ai/minimax-video/text-to-video": 200_000,
  "fal-ai/minimax-video/image-to-video": 200_000,
  "fal-ai/minimax/hailuo-02/pro/text-to-video": 240_000,
  "fal-ai/minimax/hailuo-02/pro/image-to-video": 240_000,
  "fal-ai/cogvideox-5b": 180_000,
  // Runway / LTX / Sora / Veo3 / Pixverse 高耗時影片模型
  "fal-ai/runway-gen3/turbo/image-to-video": 300_000,
  "fal-ai/runway-gen4-turbo/image-to-video": 300_000,
  "fal-ai/pixverse/v4.5/image-to-video": 240_000,
  "fal-ai/luma-dream-machine": 240_000,
  "fal-ai/luma-dream-machine/image-to-video": 240_000,
  "fal-ai/ltx-video-13b-distilled": 240_000,
  "fal-ai/ltx-video/image-to-video": 240_000,
  "fal-ai/sora": 480_000,
  "fal-ai/veo3": 480_000,
  "fal-ai/stable-video": 240_000,
  "fal-ai/flux-pro/v1.1": 90_000,
  "fal-ai/flux/schnell": 60_000,
  "fal-ai/triposr": 180_000,
  "fal-ai/tripo3d": 180_000,
  "fal-ai/trellis": 180_000,
  "fal-ai/mmaudio-v2": 90_000,
  "fal-ai/hyper3d/rodin": 300_000,
};

/** 判斷錯誤是否可重試（4xx 客戶端錯誤不應重試） */
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // HTTP 4xx 客戶端錯誤（除 429 限流）不應重試
  if (/\b(400|401|403|404|405|409|413|422)\b/.test(msg)) return false;
  // 429 限流、5xx、網路錯誤、超時都可重試
  return true;
}

/**
 * 每個分類的降級鏈(按品質由高至低)。
 * 已搬移到 `server/_core/fallbackPolicy.ts:PER_CATEGORY_FALLBACK`,
 * 此處 re-export 以維持外部 import("./falDispatcher").FALLBACK_CHAINS 的相容性。
 */
import { PER_CATEGORY_FALLBACK as FALLBACK_CHAINS } from "../_core/fallbackPolicy";
import { normalizeEngineModelId } from "../../shared/engineModelIds";
export { FALLBACK_CHAINS };

// ═══════════════════════════════════════════════════════════════════════════
// Core dispatch function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 統一分派函數 — 根據 AI 大腦選定的模型執行 Fal.ai 任務
 */
export async function dispatchFalTask(
  input: FalDispatchInput
): Promise<FalDispatchResult> {
  const { modelId, category, durationSec, charCount } = input;
  if (!modelId.startsWith("fal-ai/")) {
    throw new Error(
      `Invalid Fal model ID: "${modelId}". Must start with "fal-ai/"`
    );
  }
  // 每次呼叫產生唯一的追蹤 ID
  const runId = `fal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Step 1: 驗證模型存在 ──
  let targetModelId = modelId;
  let modelConfig = getFalModelById(targetModelId);
  let degraded = false;
  let originalModel: string | undefined;

  if (!modelConfig) {
    // 模型不存在，降級到分類的預設降級鏈
    console.warn(
      `[FalDispatcher] Model ${targetModelId} not found in catalog, using fallback chain`
    );
    const fallbackChain = FALLBACK_CHAINS[category] ?? [];
    const fallback = fallbackChain[0];
    if (fallback) {
      originalModel = targetModelId;
      targetModelId = fallback;
      modelConfig = getFalModelById(targetModelId);
      degraded = true;
    }
  }

  // ── Step 2: 估算點數 ──
  const estimate = estimatePoints(targetModelId, {
    durationSec,
    charCount,
  });

  if (!modelConfig) {
    const failResult: FalDispatchResult = {
      success: false,
      modelId: targetModelId,
      modelLabel: targetModelId,
      category,
      data: {},
      durationMs: 0,
      pointsDeducted: estimate.totalPoints,
      pointsBreakdown: estimate.breakdown,
      error: `模型 ${targetModelId} 不在目錄中，無法分派`,
      ...(degraded && { degraded, originalModel }),
    };
    // LangSmith 追蹤：模型不存在
    trackFalLangSmith({
      runId,
      modelId: targetModelId,
      category,
      prompt: input.prompt,
      inputs: {},
      result: null,
      error: failResult.error!,
      durationMs: 0,
      pointsDeducted: estimate.totalPoints,
      degraded: !!degraded,
      originalModel,
    }).catch(() => {});
    return failResult;
  }

  // ── Step 3: 建構 Fal 呼叫參數 ──
  const defaultInput: Record<string, unknown> = {};

  if (input.prompt !== undefined) defaultInput.prompt = input.prompt;

  // ── TTS 特殊處理：dia-tts / playai-tts / orpheus-tts 等只接受 `text` 欄位而非 `prompt`
  // 且 dia-tts 要求 [S1]/[S2] 說話者標籤
  if (input.prompt !== undefined && category === "text-to-speech") {
    const TTS_TEXT_FIELD_MODELS = [
      "fal-ai/dia-tts",
      "fal-ai/dia-tts/voice-clone",
      "fal-ai/f5-tts",  // playai-tts Not Found, replaced with f5-tts
      "fal-ai/orpheus-tts",
      "fal-ai/kokoro",
      "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    ];
    if (TTS_TEXT_FIELD_MODELS.includes(targetModelId)) {
      // dia-tts 需要 [S1]/[S2] 說話者標籤，否則會 422
      const text =
        targetModelId.startsWith("fal-ai/dia-tts") && !/\[S\d\]/.test(input.prompt)
          ? `[S1] ${input.prompt}`
          : input.prompt;
      defaultInput.text = text;
      delete defaultInput.prompt; // 移除 prompt，dia-tts 不接受此欄位
    }
  }

  if (input.imageUrl !== undefined) defaultInput.image_url = input.imageUrl;
  if (input.videoUrl !== undefined) defaultInput.video_url = input.videoUrl;
  if (input.audioUrl !== undefined) defaultInput.audio_url = input.audioUrl;
  if (input.negativePrompt !== undefined)
    defaultInput.negative_prompt = input.negativePrompt;
  if (input.seed !== undefined) defaultInput.seed = input.seed;
  if (input.numInferenceSteps !== undefined)
    defaultInput.num_inference_steps = input.numInferenceSteps;
  if (input.guidanceScale !== undefined)
    defaultInput.guidance_scale = input.guidanceScale;
  if (input.imageSize !== undefined) defaultInput.image_size = input.imageSize;
  if (input.aspectRatio !== undefined)
    defaultInput.aspect_ratio = input.aspectRatio;
  if (input.durationSec !== undefined) defaultInput.duration = input.durationSec;
  if (input.strength !== undefined) defaultInput.strength = input.strength;
  if (input.loraUrl !== undefined) defaultInput.lora_url = input.loraUrl;
  if (input.loraScale !== undefined) defaultInput.lora_scale = input.loraScale;
  if (input.numFrames !== undefined) defaultInput.num_frames = input.numFrames;
  if (input.fps !== undefined) defaultInput.fps = input.fps;
  if (input.voiceId !== undefined) defaultInput.voice_id = input.voiceId;
  if (input.speed !== undefined) defaultInput.speed = input.speed;
  if (input.exaggeration !== undefined)
    defaultInput.exaggeration = input.exaggeration;
  if (input.trainingSteps !== undefined)
    defaultInput.training_steps = input.trainingSteps;
  if (input.learningRate !== undefined)
    defaultInput.learning_rate = input.learningRate;
  if (input.stylePrompt !== undefined)
    defaultInput.style_prompt = input.stylePrompt;
  if (input.motionBucketId !== undefined)
    defaultInput.motion_bucket_id = input.motionBucketId;
  if (input.condAugmentation !== undefined)
    defaultInput.cond_augmentation = input.condAugmentation;
  const finalInput = { ...defaultInput, ...(input.modelParams ?? {}) };

  // ── Step 4: 呼叫 Fal 模型（含完整降級鏈重試） ──
  const startMs = Date.now();
  const resolvedTimeout =
    TIMEOUT_OVERRIDES[targetModelId] ?? modelConfig.timeoutMs ?? 120_000;
  try {
    const result = await callFalModel({
      modelId: targetModelId,
      input: finalInput,
      timeoutMs: resolvedTimeout,
    });

    const durationMs = Date.now() - startMs;
    const payload = result.data as Record<string, unknown>;
    const billingSeconds =
      ((payload.metrics as { inference_time?: number } | undefined)?.inference_time ?? 0);
    const outputImages = Array.isArray(payload.images) ? payload.images.length : 0;
    const outputVideoDuration =
      ((payload.video as { duration?: number } | undefined)?.duration ?? 0);
    const actualCost = calculateActualCost({
      modelId: targetModelId,
      billingSeconds,
      outputImages,
      outputVideoDuration,
    });
    if (typeof input.userId === "number") {
      if (typeof input.estimatedCredits === "number") {
        await reconcileCredits(input.userId, input.estimatedCredits, actualCost);
      } else {
        await deductCredits(input.userId, actualCost);
      }
    }

    // LangSmith 追蹤：成功
    trackFalLangSmith({
      runId,
      modelId: targetModelId,
      category: modelConfig.category,
      prompt: input.prompt,
      inputs: finalInput,
      result: result.data,
      error: null,
      durationMs,
      pointsDeducted: actualCost,
      degraded: !!degraded,
      originalModel,
    }).catch(() => {});

    return {
      success: true,
      modelId: targetModelId,
      modelLabel: modelConfig.label,
      category: modelConfig.category,
      data: result.data,
      durationMs,
      pointsDeducted: actualCost,
      pointsBreakdown: `actual=${actualCost} (estimate=${estimate.totalPoints})`,
      ...(degraded && { degraded, originalModel }),
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[falDispatcher] error", {
      modelId: targetModelId,
      status: (err as { status?: unknown } | undefined)?.status,
      body: (err as { body?: unknown } | undefined)?.body,
    });

    // ── 4xx 客戶端錯誤不重試（參數錯誤、認證失敗等）──
    if (!isRetryableError(err)) {
      console.error(
        `[FalDispatcher] Non-retryable error for ${targetModelId}: ${errMsg}`
      );
      const errResult: FalDispatchResult = {
        success: false,
        modelId: targetModelId,
        modelLabel: modelConfig.label,
        category,
        data: {},
        durationMs,
        pointsDeducted: estimate.totalPoints,
        pointsBreakdown: estimate.breakdown,
        error: errMsg,
        ...(degraded && { degraded, originalModel }),
      };
      // LangSmith 追蹤：4xx 不可重試錯誤
      trackFalLangSmith({
        runId,
        modelId: targetModelId,
        category,
        prompt: input.prompt,
        inputs: finalInput,
        result: null,
        error: errMsg,
        durationMs,
        pointsDeducted: estimate.totalPoints,
        degraded: !!degraded,
        originalModel,
      }).catch(() => {});
      return errResult;
    }

    // ── 完整降級鏈重試（遍歷所有候選模型） ──
    const fallbackChain = FALLBACK_CHAINS[category] ?? [];
    let lastFallbackError = errMsg;
    for (let i = 0; i < fallbackChain.length; i++) {
      const candidate = fallbackChain[i];
      if (candidate === targetModelId) continue;

      const candidateConfig = getFalModelById(candidate);
      if (!candidateConfig) continue;

      // 指數退避（1s, 2s, 4s, max 8s）
      const backoffMs = Math.min(1000 * Math.pow(2, i), 8000);
      await new Promise(r => setTimeout(r, backoffMs));

      console.warn(
        `[FalDispatcher] Primary ${targetModelId} failed, trying fallback ${candidate} (${i + 1}/${fallbackChain.length})`
      );
      try {
        const candidateTimeout =
          TIMEOUT_OVERRIDES[candidate] ?? candidateConfig.timeoutMs ?? 120_000;
        const retryResult = await callFalModel({
          modelId: candidate,
          input: finalInput,
          timeoutMs: candidateTimeout,
        });
        const retryEstimate = estimatePoints(candidate, {
          durationSec,
          charCount,
        });
        const retryPayload = retryResult.data as Record<string, unknown>;
        const retryBillingSeconds =
          ((retryPayload.metrics as { inference_time?: number } | undefined)?.inference_time ?? 0);
        const retryOutputImages = Array.isArray(retryPayload.images) ? retryPayload.images.length : 0;
        const retryVideoDuration =
          ((retryPayload.video as { duration?: number } | undefined)?.duration ?? 0);
        const retryActualCost = calculateActualCost({
          modelId: candidate,
          billingSeconds: retryBillingSeconds,
          outputImages: retryOutputImages,
          outputVideoDuration: retryVideoDuration,
        });
        if (typeof input.userId === "number") {
          if (typeof input.estimatedCredits === "number") {
            await reconcileCredits(input.userId, input.estimatedCredits, retryActualCost);
          } else {
            await deductCredits(input.userId, retryActualCost);
          }
        }
        // LangSmith 追蹤：降級成功
        const retryDuration = Date.now() - startMs;
        trackFalLangSmith({
          runId,
          modelId: candidate,
          category,
          prompt: input.prompt,
          inputs: finalInput,
          result: retryResult.data,
          error: null,
          durationMs: retryDuration,
          pointsDeducted: retryActualCost,
          degraded: true,
          originalModel: modelId,
        }).catch(() => {});
        return {
          success: true,
          modelId: candidate,
          modelLabel: candidateConfig.label,
          category,
          data: retryResult.data,
          durationMs: retryDuration,
          pointsDeducted: retryActualCost,
          pointsBreakdown: `actual=${retryActualCost} (estimate=${retryEstimate.totalPoints})`,
          degraded: true,
          originalModel: modelId,
        };
      } catch (retryErr) {
        lastFallbackError =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        // 如果候選模型也是不可重試錯誤，跳過剩餘候選
        if (!isRetryableError(retryErr)) {
          console.error(
            `[FalDispatcher] Fallback ${candidate} non-retryable: ${lastFallbackError}`
          );
          break;
        }
        console.warn(
          `[FalDispatcher] Fallback ${candidate} also failed: ${lastFallbackError}`
        );
      }
    }

    // LangSmith 追蹤：所有降級連鎖失敗
    const finalDuration = Date.now() - startMs;
    const finalErrMsg = `${errMsg} (all ${fallbackChain.length} fallbacks exhausted: ${lastFallbackError})`;
    trackFalLangSmith({
      runId,
      modelId: targetModelId,
      category,
      prompt: input.prompt,
      inputs: finalInput,
      result: null,
      error: finalErrMsg,
      durationMs: finalDuration,
      pointsDeducted: estimate.totalPoints,
      degraded: !!degraded,
      originalModel,
    }).catch(() => {});
    return {
      success: false,
      modelId: targetModelId,
      modelLabel: modelConfig.label,
      category,
      data: {},
      durationMs: finalDuration,
      pointsDeducted: estimate.totalPoints,
      pointsBreakdown: estimate.breakdown,
      error: finalErrMsg,
      ...(degraded && { degraded, originalModel }),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience dispatchers per studio modality
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 圖片生成 — 使用大腦組態的 falTextToImageEngine 或 imageEngine
 * 支援：text-to-image, image-to-image
 */
export async function dispatchImageGeneration(params: {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  imageUrl?: string; // 若有，使用 image-to-image
  seed?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  imageSize?: string;
  aspectRatio?: string;
  strength?: number;
}): Promise<FalDispatchResult> {
  const category = params.imageUrl ? "image-to-image" : "text-to-image";
  return dispatchFalTask({
    modelId: params.modelId,
    category,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    imageUrl: params.imageUrl,
    seed: params.seed,
    numInferenceSteps: params.numInferenceSteps,
    guidanceScale: params.guidanceScale,
    imageSize: params.imageSize,
    aspectRatio: params.aspectRatio,
    strength: params.strength,
  });
}

/**
 * 影片生成 — 使用大腦組態的 falTextToVideoEngine 或 falImageToVideoEngine
 */
export async function dispatchVideoGeneration(params: {
  modelId: string;
  prompt: string;
  imageUrl?: string; // 若有，使用 image-to-video
  negativePrompt?: string;
  durationSec?: number;
  aspectRatio?: string;
  seed?: number;
}): Promise<FalDispatchResult> {
  const category = params.imageUrl ? "image-to-video" : "text-to-video";
  return dispatchFalTask({
    modelId: params.modelId,
    category,
    prompt: params.prompt,
    imageUrl: params.imageUrl,
    negativePrompt: params.negativePrompt,
    durationSec: params.durationSec ?? 5,
    aspectRatio: params.aspectRatio,
    seed: params.seed,
  });
}

/**
 * 音訊生成 — 使用大腦組態的 falTextToAudioEngine
 */
export async function dispatchAudioGeneration(params: {
  modelId: string;
  prompt: string;
  durationSec?: number;
  seed?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "text-to-audio",
    prompt: params.prompt,
    durationSec: params.durationSec ?? 30,
    seed: params.seed,
  });
}

/**
 * 語音合成 — 使用大腦組態的 falTextToSpeechEngine
 */
export async function dispatchTTS(params: {
  modelId: string;
  text: string;
  voiceId?: string;
  speed?: number;
  exaggeration?: number;
  charCount?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "text-to-speech",
    prompt: params.text,
    voiceId: params.voiceId,
    speed: params.speed,
    exaggeration: params.exaggeration,
    charCount: params.charCount ?? params.text.length,
  });
}

/**
 * 圖片轉3D — 使用大腦組態的 falImageTo3dEngine
 */
export async function dispatchImageTo3D(params: {
  modelId: string;
  imageUrl: string;
  prompt?: string;
  seed?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "image-to-3d",
    imageUrl: params.imageUrl,
    prompt: params.prompt,
    seed: params.seed,
  });
}

/**
 * 文字轉3D — 使用大腦組態的 falTextTo3dEngine
 */
export async function dispatchTextTo3D(params: {
  modelId: string;
  prompt: string;
  seed?: number;
  stylePrompt?: string;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "text-to-3d",
    prompt: params.prompt,
    seed: params.seed,
    stylePrompt: params.stylePrompt,
  });
}

/**
 * 影片轉音訊 — 使用大腦組態的 falVideoToAudioEngine
 */
export async function dispatchVideoToAudio(params: {
  modelId: string;
  videoUrl: string;
  prompt?: string;
  durationSec?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "video-to-audio",
    videoUrl: params.videoUrl,
    prompt: params.prompt,
    durationSec: params.durationSec,
  });
}

/**
 * 影片轉文字 — 使用大腦組態的 falVideoToTextEngine
 */
export async function dispatchVideoToText(params: {
  modelId: string;
  videoUrl: string;
  prompt?: string;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "video-to-text",
    videoUrl: params.videoUrl,
    prompt: params.prompt,
  });
}

/**
 * 影片對影片 — 使用大腦組態的 falVideoToVideoEngine
 */
export async function dispatchVideoToVideo(params: {
  modelId: string;
  videoUrl: string;
  prompt: string;
  strength?: number;
  seed?: number;
  durationSec?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "video-to-video",
    videoUrl: params.videoUrl,
    prompt: params.prompt,
    strength: params.strength,
    seed: params.seed,
    durationSec: params.durationSec,
  });
}

/**
 * LoRA 訓練 — 使用大腦組態的 falTrainingEngine
 */
export async function dispatchLoRATraining(params: {
  modelId: string;
  imageUrl: string;
  prompt?: string;
  trainingSteps?: number;
  learningRate?: number;
}): Promise<FalDispatchResult> {
  return dispatchFalTask({
    modelId: params.modelId,
    category: "training",
    imageUrl: params.imageUrl,
    prompt: params.prompt,
    trainingSteps: params.trainingSteps ?? 1000,
    learningRate: params.learningRate ?? 0.0004,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue dispatcher — async submit to fal.ai queue with fallback chain support
// ═══════════════════════════════════════════════════════════════════════════

const FAL_QUEUE_BASE = "https://queue.fal.run";

export interface FalQueueDispatchInput {
  /** 使用者選定模型；若不在 catalog 且能推論 category，會自動降級到該 category 的 fallback chain */
  modelId: string;
  /** 任務分類（可省略；省略時嘗試從 catalog 推論。無法推論則不做 fallback） */
  category?: string;
  /** 完整 Fal 輸入 payload（保留呼叫端原始命名） */
  input: Record<string, unknown>;
  /** fal.ai webhook 回呼 URL（透傳到 ?fal_webhook=...） */
  webhookUrl?: string;
  /** LangSmith / errorTrace 用的 route 標識，例如 "trpc.imageStudio.*" */
  route?: string;
  /** 用於 errorTrace 的模態欄位（對應 recordErrorTrace 接受的值） */
  modality?: "image" | "video" | "audio" | "voice" | "llm";
  /** 額外 HTTP headers（例如 x-fal-client-credentials） */
  extraHeaders?: Record<string, string>;
  userId?: number;
}

export interface FalQueueDispatchResult {
  request_id: string;
  /** 實際提交的 modelId（可能因 fallback 而變動） */
  modelId: string;
  /** true 表示原始 modelId 不在 catalog，已降級到 fallback chain 首選 */
  degraded?: boolean;
  /** 降級前原本要使用的 modelId */
  originalModel?: string;
}

/**
 * dispatchFalQueueTask — 提交任務到 fal.ai queue（async，立即回 request_id）。
 *
 * 與 dispatchFalTask 的差異：
 *  - dispatchFalTask 走 client.subscribe，同步等到完成才回傳結果
 *  - dispatchFalQueueTask 走 queue.submit，立即回傳 request_id 供前端輪詢/webhook
 *
 * 三大 studio router（imageStudio / videoStudio / proStudio）原本各自 inline
 * falQueueSubmit，沒有 fallback；改走此函式即可在「模型不存在於 catalog」時
 * 自動降級到該 category 的次佳模型。
 */
export async function dispatchFalQueueTask(
  params: FalQueueDispatchInput
): Promise<FalQueueDispatchResult> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error("FAL_API_KEY 未設定");
  }

  const { traceToolRun } = await import("./langsmithTracer");
  const { recordErrorTrace } = await import("./brainAutoRepair");

  // DEF-So1：先把 legacy alias（例：fal-ai/sonauto）轉成 fal 真實 endpoint
  // （sonauto/v2/text-to-music），避免 catalog 查不到而誤觸 fallback chain。
  let targetModelId = normalizeEngineModelId(params.modelId);
  let degraded = false;
  let originalModel: string | undefined;

  // ── Step 1: 模型存在性檢查 + fallback chain（需要能推論 category） ──
  const initialConfig = getFalModelById(targetModelId);
  const resolvedCategory = initialConfig?.category ?? params.category;

  if (!initialConfig && resolvedCategory) {
    const fallback = (FALLBACK_CHAINS[resolvedCategory] ?? [])[0];
    if (fallback) {
      console.warn(
        `[FalDispatcher] Queue model ${targetModelId} not in catalog; falling back to ${fallback}`
      );
      originalModel = targetModelId;
      targetModelId = fallback;
      degraded = true;
    }
  }

  // ── Step 1.5: ultra tier 影片模型 preflight 健康探測 ──
  // Sora / Veo3 / Topaz / Runway G4 / Kling V2.1 Pro 等高成本模型，
  // 首次選用前同步驗證一次，避免使用者掛 5–10 分鐘才發現模型壞掉。
  const pricing = getModelPricing(targetModelId);
  const isVideoCategory =
    resolvedCategory === "text-to-video" ||
    resolvedCategory === "image-to-video" ||
    resolvedCategory === "video-to-video";
  if (isVideoCategory && pricing?.tier === "ultra") {
    const { preflightHealthStatus } = await import(
      "../middleware/brainContext"
    );
    const healthy = await preflightHealthStatus(targetModelId, 3000);
    if (!healthy) {
      const altFallback = (FALLBACK_CHAINS[resolvedCategory!] ?? []).find(
        id => id !== targetModelId
      );
      if (altFallback) {
        console.warn(
          `[FalDispatcher] Preflight failed for ultra-tier ${targetModelId}; degrading to ${altFallback}`
        );
        if (!originalModel) originalModel = targetModelId;
        targetModelId = altFallback;
        degraded = true;
      }
    }
  }

  // ── Step 2: 提交到 fal.ai queue（透傳 webhookUrl）──
  // 若主模型回 5xx / 429 / 網路錯誤,逐一嘗試 fallback chain 的次佳候選,
  // 而非把錯誤直接拋給使用者。這個迴圈和 dispatchFalTask 的同步重試對齊,
  // 確保「使用者選了一個暫時性壞掉的模型」也能透過降級成功送出。
  const startedAt = Date.now();
  const route = params.route ?? "fal-dispatcher.queue";
  const runName = `fal-dispatch/queue-submit/${resolvedCategory ?? "unknown"}`;
  const queryString = params.webhookUrl
    ? `?fal_webhook=${encodeURIComponent(params.webhookUrl)}`
    : "";

  type SubmitOutcome =
    | { ok: true; data: { request_id?: string }; modelUsed: string }
    | { ok: false; error: string; retryable: boolean; modelUsed: string };

  const trySubmit = async (modelToUse: string): Promise<SubmitOutcome> => {
    try {
      const r = await fetch(
        `${FAL_QUEUE_BASE}/${modelToUse}${queryString}`,
        {
          method: "POST",
          headers: {
            Authorization: `Key ${apiKey}`,
            "Content-Type": "application/json",
            ...(params.extraHeaders ?? {}),
          },
          body: JSON.stringify(params.input),
        }
      );
      if (!r.ok) {
        const errText = await r.text();
        // 4xx (except 429) → not retryable; 5xx / 429 → retryable
        const status = r.status;
        const retryable = status === 429 || status >= 500;
        return {
          ok: false,
          error: `HTTP ${status}: ${errText.slice(0, 300)}`,
          retryable,
          modelUsed: modelToUse,
        };
      }
      const data = (await r.json()) as { request_id?: string };
      return { ok: true, data, modelUsed: modelToUse };
    } catch (err) {
      // 網路 / DNS / abort 都當可重試
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
        modelUsed: modelToUse,
      };
    }
  };

  // 主模型 → fallback chain 候選
  const submitCandidates: string[] = [targetModelId];
  if (resolvedCategory) {
    for (const candidate of FALLBACK_CHAINS[resolvedCategory] ?? []) {
      if (candidate !== targetModelId && !submitCandidates.includes(candidate)) {
        submitCandidates.push(candidate);
      }
    }
  }

  let lastOutcome: SubmitOutcome | null = null;
  let attemptedModel = targetModelId;
  for (let i = 0; i < submitCandidates.length; i++) {
    attemptedModel = submitCandidates[i];
    const outcome = await trySubmit(attemptedModel);
    lastOutcome = outcome;
    if (outcome.ok) {
      // 命中！若是降級到非主模型,標記 degraded
      if (attemptedModel !== targetModelId) {
        if (!originalModel) originalModel = targetModelId;
        targetModelId = attemptedModel;
        degraded = true;
        console.warn(
          `[FalDispatcher] Queue submit degraded: ${originalModel} → ${attemptedModel}`
        );
      }
      break;
    }
    // 4xx 不可重試 → 直接停止 chain（參數錯誤、認證失敗等）
    if (!outcome.retryable) break;
    // 還有候選 → 指數退避（500ms, 1s, 2s, max 4s）後嘗試下一個
    if (i < submitCandidates.length - 1) {
      const backoffMs = Math.min(500 * Math.pow(2, i), 4000);
      console.warn(
        `[FalDispatcher] Queue submit ${attemptedModel} failed (${outcome.error.slice(0, 120)}); trying next candidate after ${backoffMs}ms`
      );
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }

  if (!lastOutcome || !lastOutcome.ok) {
    const errText = lastOutcome ? lastOutcome.error : "unknown error";
    void traceToolRun({
      runName,
      provider: "fal.ai",
      model: attemptedModel,
      route,
      method: "POST",
      inputs: {
        input_keys: Object.keys(params.input),
        original_model: originalModel,
        degraded,
        candidates_tried: submitCandidates.length,
      },
      error: errText.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    recordErrorTrace({
      userId: params.userId ?? 0,
      modality: params.modality ?? "image",
      engine: attemptedModel,
      prompt: "[dispatchFalQueueTask]",
      errorMessage: errText.slice(0, 500),
      errorCode: "FAL_QUEUE_SUBMIT_ERROR",
    });
    throw new Error(`fal.ai queue submit error [${attemptedModel}]: ${errText}`);
  }

  const data = lastOutcome.data;
  void traceToolRun({
    runName,
    provider: "fal.ai",
    model: targetModelId,
    route,
    method: "POST",
    inputs: {
      input_keys: Object.keys(params.input),
      original_model: originalModel,
      degraded,
    },
    outputs: { request_id: data.request_id ?? null },
    durationMs: Date.now() - startedAt,
  });

  if (!data.request_id) {
    throw new Error(
      `fal.ai queue submit returned no request_id [${targetModelId}]`
    );
  }

  return {
    request_id: data.request_id,
    modelId: targetModelId,
    ...(degraded && { degraded, originalModel }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Brain Config Resolution Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 從 userAiBrain 行取出各 Fal 任務引擎選擇 */
export interface BrainFalEngines {
  imageToThreeD: string;
  imageToImage: string;
  imageToJson: string;
  imageToVideo: string;
  json: string;
  llm: string;
  textToThreeD: string;
  textToAudio: string;
  textToImage: string;
  textToJson: string;
  textToSpeech: string;
  textToVideo: string;
  training: string;
  videoToAudio: string;
  videoToText: string;
  videoToVideo: string;
}

/** 預設 Fal 引擎（對應 DB schema 預設值） */
export const DEFAULT_FAL_ENGINES: BrainFalEngines = {
  imageToThreeD: "fal-ai/trellis-2",
  imageToImage: "fal-ai/flux/dev/image-to-image",
  imageToJson: "fal-ai/any-llm",
  imageToVideo: "fal-ai/kling-video/v2.1/pro/image-to-video",
  json: "fal-ai/any-llm",
  llm: "fal-ai/any-llm",
  textToThreeD: "fal-ai/hyper3d/rodin",
  textToAudio: "fal-ai/stable-audio",
  textToImage: "fal-ai/flux-pro/v1.1",
  textToJson: "fal-ai/any-llm",
  textToSpeech: "fal-ai/elevenlabs/tts/turbo-v2.5",
  textToVideo: "fal-ai/kling-video/v2.1/pro/text-to-video",
  training: "fal-ai/flux-lora-fast-training",
  videoToAudio: "fal-ai/mmaudio-v2/video-to-audio",
  videoToText: "fal-ai/whisper",
  videoToVideo: "fal-ai/kling-video/v2.1/standard/video-to-video",
};

/**
 * 從 DB row 解析 Fal 引擎選擇，不存在則使用預設值
 */
export function resolveFalEnginesFromRow(
  row: Record<string, unknown> | null
): BrainFalEngines {
  if (!row) return DEFAULT_FAL_ENGINES;
  return {
    imageToThreeD: String(
      row.falImageTo3dEngine ?? DEFAULT_FAL_ENGINES.imageToThreeD
    ),
    imageToImage: String(
      row.falImageToImageEngine ?? DEFAULT_FAL_ENGINES.imageToImage
    ),
    imageToJson: String(
      row.falImageToJsonEngine ?? DEFAULT_FAL_ENGINES.imageToJson
    ),
    imageToVideo: String(
      row.falImageToVideoEngine ?? DEFAULT_FAL_ENGINES.imageToVideo
    ),
    json: String(row.falJsonEngine ?? DEFAULT_FAL_ENGINES.json),
    llm: String(row.falLlmEngine ?? DEFAULT_FAL_ENGINES.llm),
    textToThreeD: String(
      row.falTextTo3dEngine ?? DEFAULT_FAL_ENGINES.textToThreeD
    ),
    textToAudio: String(
      row.falTextToAudioEngine ?? DEFAULT_FAL_ENGINES.textToAudio
    ),
    textToImage: String(
      row.falTextToImageEngine ?? DEFAULT_FAL_ENGINES.textToImage
    ),
    textToJson: String(
      row.falTextToJsonEngine ?? DEFAULT_FAL_ENGINES.textToJson
    ),
    textToSpeech: String(
      row.falTextToSpeechEngine ?? DEFAULT_FAL_ENGINES.textToSpeech
    ),
    textToVideo: String(
      row.falTextToVideoEngine ?? DEFAULT_FAL_ENGINES.textToVideo
    ),
    training: String(row.falTrainingEngine ?? DEFAULT_FAL_ENGINES.training),
    videoToAudio: String(
      row.falVideoToAudioEngine ?? DEFAULT_FAL_ENGINES.videoToAudio
    ),
    videoToText: String(
      row.falVideoToTextEngine ?? DEFAULT_FAL_ENGINES.videoToText
    ),
    videoToVideo: String(
      row.falVideoToVideoEngine ?? DEFAULT_FAL_ENGINES.videoToVideo
    ),
  };
}

/**
 * 估算生成任務的點數（不實際呼叫 API）
 * 供前端在生成前顯示預覽費用
 */
export function estimateGenerationPoints(params: {
  modelId: string;
  generationType: "image" | "video" | "audio" | "voice";
  durationSec?: number;
  charCount?: number;
}): { points: number; breakdown: string; modelLabel: string } {
  const estimate = estimatePoints(params.modelId, {
    durationSec: params.durationSec,
    charCount: params.charCount,
  });
  const pricing = getModelPricing(params.modelId);
  return {
    points: estimate.totalPoints,
    breakdown: estimate.breakdown,
    modelLabel: pricing?.label ?? params.modelId,
  };
}

/**
 * submitToFalQueue — 直接提交任務到 fal.ai queue 並立即回傳 request_id。
 * 不等待生成完成，供背景任務模式使用。
 * 用法：前端拿到 request_id 後呼叫 submitTask() 登錄到 BackgroundTasksContext。
 */
export async function submitToFalQueue(
  modelId: string,
  input: Record<string, unknown>,
  options?: {
    /** fal.ai webhook 回呼 URL（會以 ?fal_webhook= 形式附加） */
    webhookUrl?: string;
    extraHeaders?: Record<string, string>;
  }
): Promise<{ request_id: string; modelId: string }> {
  const { falQueueSubmitModel } = await import("./falModels.js");
  const result = await falQueueSubmitModel(
    modelId,
    input,
    options?.extraHeaders,
    options?.webhookUrl
  );
  return { request_id: result.request_id, modelId };
}
