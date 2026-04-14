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

import { callFalModel, getFalModelById, getFalModelsByCategory, type FalCallInput } from "./falModels";
import { estimatePoints, getModelPricing } from "./modelPricing";

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
  degraded?: boolean;       // true if fell back to alternative model
  originalModel?: string;   // model that was requested before fallback
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
}

// ═══════════════════════════════════════════════════════════════════════════
// Fallback chain for each category
// ═══════════════════════════════════════════════════════════════════════════

/** 每個分類的降級鏈（按品質由高至低） */
const FALLBACK_CHAINS: Record<string, string[]> = {
  "text-to-image": [
    "fal-ai/flux-pro/v1.1",
    "fal-ai/flux/dev",
    "fal-ai/stable-diffusion-v3-medium",
    "fal-ai/flux/schnell",
    "fal-ai/aura-flow",
  ],
  "image-to-image": [
    "fal-ai/flux/dev/image-to-image",
    "fal-ai/stable-diffusion-v3-medium/image-to-image",
    "fal-ai/controlnet-union",
    "fal-ai/ip-adapter-face-id",
    "fal-ai/aura-sr",
  ],
  "text-to-video": [
    "fal-ai/kling-video/v1.5/pro/text-to-video",
    "fal-ai/wan-t2v-v2.1",
    "fal-ai/minimax-video/text-to-video",
    "fal-ai/cogvideox-5b",
  ],
  "image-to-video": [
    "fal-ai/kling-video/v1.5/pro/image-to-video",
    "fal-ai/minimax-video/image-to-video",
    "fal-ai/luma-dream-machine/image-to-video",
    "fal-ai/stable-video",
  ],
  "text-to-speech": [
    "fal-ai/playai-tts",
    "fal-ai/orpheus-tts",
    "fal-ai/dia-tts",
    "fal-ai/kokoro",
  ],
  "text-to-audio": [
    "fal-ai/stable-audio",
    "fal-ai/mmaudio-v2",
    "fal-ai/audioldm2",
    "fal-ai/musicgen",
  ],
  "image-to-3d": [
    "fal-ai/triposr",
    "fal-ai/stable-zero123",
    "fal-ai/zero123plus",
  ],
  "text-to-3d": [
    "fal-ai/shap-e",
    "fal-ai/dreamgaussian",
  ],
  "video-to-audio": [
    "fal-ai/audioldm2",
    "fal-ai/mmaudio-v2",
  ],
  "video-to-text": [
    "fal-ai/wizper",
    "fal-ai/whisper",
  ],
  "video-to-video": [
    "fal-ai/wan-v2v",
    "fal-ai/cogvideox-5b/video-to-video",
  ],
  "training": [
    "fal-ai/flux-lora-fast-training",
  ],
  "llm": [
    "fal-ai/any-llm",
  ],
  "json": [
    "fal-ai/any-llm",
  ],
  "text-to-json": [
    "fal-ai/any-llm",
  ],
  "image-to-json": [
    "fal-ai/llava-next",
    "fal-ai/moondream",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Core dispatch function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 統一分派函數 — 根據 AI 大腦選定的模型執行 Fal.ai 任務
 */
export async function dispatchFalTask(input: FalDispatchInput): Promise<FalDispatchResult> {
  const { modelId, category, durationSec, charCount } = input;

  // ── Step 1: 驗證模型存在 ──
  let targetModelId = modelId;
  let modelConfig = getFalModelById(targetModelId);
  let degraded = false;
  let originalModel: string | undefined;

  if (!modelConfig) {
    // 模型不存在，降級到分類的預設降級鏈
    console.warn(`[FalDispatcher] Model ${targetModelId} not found in catalog, using fallback chain`);
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
    return {
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
  }

  // ── Step 3: 建構 Fal 呼叫參數 ──
  const falInput: Record<string, unknown> = {};

  if (input.prompt !== undefined) falInput.prompt = input.prompt;
  if (input.imageUrl !== undefined) falInput.image_url = input.imageUrl;
  if (input.videoUrl !== undefined) falInput.video_url = input.videoUrl;
  if (input.audioUrl !== undefined) falInput.audio_url = input.audioUrl;
  if (input.negativePrompt !== undefined) falInput.negative_prompt = input.negativePrompt;
  if (input.seed !== undefined) falInput.seed = input.seed;
  if (input.numInferenceSteps !== undefined) falInput.num_inference_steps = input.numInferenceSteps;
  if (input.guidanceScale !== undefined) falInput.guidance_scale = input.guidanceScale;
  if (input.imageSize !== undefined) falInput.image_size = input.imageSize;
  if (input.aspectRatio !== undefined) falInput.aspect_ratio = input.aspectRatio;
  if (input.durationSec !== undefined) falInput.duration = input.durationSec;
  if (input.strength !== undefined) falInput.strength = input.strength;
  if (input.loraUrl !== undefined) falInput.lora_url = input.loraUrl;
  if (input.loraScale !== undefined) falInput.lora_scale = input.loraScale;
  if (input.numFrames !== undefined) falInput.num_frames = input.numFrames;
  if (input.fps !== undefined) falInput.fps = input.fps;
  if (input.voiceId !== undefined) falInput.voice_id = input.voiceId;
  if (input.speed !== undefined) falInput.speed = input.speed;
  if (input.exaggeration !== undefined) falInput.exaggeration = input.exaggeration;
  if (input.trainingSteps !== undefined) falInput.training_steps = input.trainingSteps;
  if (input.learningRate !== undefined) falInput.learning_rate = input.learningRate;
  if (input.stylePrompt !== undefined) falInput.style_prompt = input.stylePrompt;
  if (input.motionBucketId !== undefined) falInput.motion_bucket_id = input.motionBucketId;
  if (input.condAugmentation !== undefined) falInput.cond_augmentation = input.condAugmentation;

  // ── Step 4: 呼叫 Fal 模型 ──
  const startMs = Date.now();
  try {
    const result = await callFalModel({
      modelId: targetModelId,
      input: falInput,
      timeoutMs: modelConfig.timeoutMs ?? 120_000,
    });

    const durationMs = Date.now() - startMs;

    return {
      success: true,
      modelId: targetModelId,
      modelLabel: modelConfig.label,
      category: modelConfig.category,
      data: result.data,
      durationMs,
      pointsDeducted: estimate.totalPoints,
      pointsBreakdown: estimate.breakdown,
      ...(degraded && { degraded, originalModel }),
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);

    // ── 降級重試 ──
    const fallbackChain = FALLBACK_CHAINS[category] ?? [];
    const nextFallback = fallbackChain.find((m) => m !== targetModelId);
    if (nextFallback) {
      console.warn(`[FalDispatcher] Primary model ${targetModelId} failed, retrying with ${nextFallback}`);
      const nextConfig = getFalModelById(nextFallback);
      if (nextConfig) {
        try {
          const retryResult = await callFalModel({
            modelId: nextFallback,
            input: falInput,
            timeoutMs: nextConfig.timeoutMs ?? 120_000,
          });
          const retryEstimate = estimatePoints(nextFallback, { durationSec, charCount });
          return {
            success: true,
            modelId: nextFallback,
            modelLabel: nextConfig.label,
            category,
            data: retryResult.data,
            durationMs: Date.now() - startMs,
            pointsDeducted: retryEstimate.totalPoints,
            pointsBreakdown: retryEstimate.breakdown,
            degraded: true,
            originalModel: modelId,
          };
        } catch {
          // 降級也失敗，回傳錯誤
        }
      }
    }

    return {
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
  imageUrl?: string;   // 若有，使用 image-to-image
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
  imageUrl?: string;    // 若有，使用 image-to-video
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
  imageToThreeD:  "fal-ai/trellis-2",
  imageToImage:   "fal-ai/flux/dev/image-to-image",
  imageToJson:    "fal-ai/any-llm",
  imageToVideo:   "fal-ai/kling-video/v2.1/pro/image-to-video",
  json:           "fal-ai/any-llm",
  llm:            "fal-ai/any-llm",
  textToThreeD:   "fal-ai/hyper3d/rodin",
  textToAudio:    "fal-ai/stable-audio",
  textToImage:    "fal-ai/flux-pro/v1.1",
  textToJson:     "fal-ai/any-llm",
  textToSpeech:   "fal-ai/elevenlabs/tts/turbo-v2.5",
  textToVideo:    "fal-ai/kling-video/v2.1/pro/text-to-video",
  training:       "fal-ai/flux-lora-fast-training",
  videoToAudio:   "fal-ai/mmaudio-v2/video-to-audio",
  videoToText:    "fal-ai/nemotron/asr/stream",
  videoToVideo:   "fal-ai/kling-video/v2.1/standard/video-to-video",
};

/**
 * 從 DB row 解析 Fal 引擎選擇，不存在則使用預設值
 */
export function resolveFalEnginesFromRow(row: Record<string, unknown> | null): BrainFalEngines {
  if (!row) return DEFAULT_FAL_ENGINES;
  return {
    imageToThreeD:  String(row.falImageTo3dEngine  ?? DEFAULT_FAL_ENGINES.imageToThreeD),
    imageToImage:   String(row.falImageToImageEngine ?? DEFAULT_FAL_ENGINES.imageToImage),
    imageToJson:    String(row.falImageToJsonEngine  ?? DEFAULT_FAL_ENGINES.imageToJson),
    imageToVideo:   String(row.falImageToVideoEngine ?? DEFAULT_FAL_ENGINES.imageToVideo),
    json:           String(row.falJsonEngine         ?? DEFAULT_FAL_ENGINES.json),
    llm:            String(row.falLlmEngine           ?? DEFAULT_FAL_ENGINES.llm),
    textToThreeD:   String(row.falTextTo3dEngine     ?? DEFAULT_FAL_ENGINES.textToThreeD),
    textToAudio:    String(row.falTextToAudioEngine  ?? DEFAULT_FAL_ENGINES.textToAudio),
    textToImage:    String(row.falTextToImageEngine  ?? DEFAULT_FAL_ENGINES.textToImage),
    textToJson:     String(row.falTextToJsonEngine   ?? DEFAULT_FAL_ENGINES.textToJson),
    textToSpeech:   String(row.falTextToSpeechEngine ?? DEFAULT_FAL_ENGINES.textToSpeech),
    textToVideo:    String(row.falTextToVideoEngine  ?? DEFAULT_FAL_ENGINES.textToVideo),
    training:       String(row.falTrainingEngine     ?? DEFAULT_FAL_ENGINES.training),
    videoToAudio:   String(row.falVideoToAudioEngine ?? DEFAULT_FAL_ENGINES.videoToAudio),
    videoToText:    String(row.falVideoToTextEngine  ?? DEFAULT_FAL_ENGINES.videoToText),
    videoToVideo:   String(row.falVideoToVideoEngine ?? DEFAULT_FAL_ENGINES.videoToVideo),
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
