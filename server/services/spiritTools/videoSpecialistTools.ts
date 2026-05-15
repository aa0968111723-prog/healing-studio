/**
 * server/services/spiritTools/videoSpecialistTools.ts
 *
 * 影影（video-specialist）的影片生成工具集。
 *
 * 設計目標：讓影影成為「真的會做事」的 AI agent，而不只是把 prompt 轉發給 fal：
 *   - 依輸入自動辨識意圖（t2v / i2v / v2v / 對嘴 / 畫質優化）
 *   - 用 canonical fal model ID（與 server/services/falModels.ts 對齊），
 *     不再用過時的 alias（hailu-video / wav2lip / runway-gen3 …）
 *   - 套用 modelPromptTemplates 的 cinematic motion 引導詞
 *   - 走 dispatchFalQueueTask + awaitFalQueueResult，等到實際完成才回，
 *     讓 orchestrator 的 ${stepN.video_url} 步驟引用能拿到真實 URL
 *   - 額外提供 recommendModel / estimateCost / planWorkflow 三個推理工具，
 *     讓影影能在跟使用者對話時自己挑模型、報價、拆步驟
 *
 * 對外 6 個工具：
 *   - generateVideo        — 主入口；依參數自動路由 t2v/i2v/v2v
 *   - imageToVideo         — 顯式 i2v 入口；建議由 LLM 直呼以避免歧義
 *   - createLipSync        — 對嘴影片（Wan 2.2 / EchoMimic / StableAvatar）
 *   - enhanceVideo         — 畫質優化（upscale / interpolate / enhance）
 *   - getVideoModels       — 列出影影的模型與長處（供 UI / planner 挑選）
 *   - getVideoGenerationTips — 場景化提示詞建議
 *
 * 另外 3 個純推理工具（無 I/O，可放心讓 LLM 自由呼叫）：
 *   - recommendModel       — 依意圖 + 約束（時長 / 預算 / 品質）建議模型
 *   - estimateCost         — 用 modelPricing 估算點數，給財財做最後核算前的試算
 *   - planVideoWorkflow    — 規劃多步驟（例如「腳本 → 圖 → i2v → 配音 → 對嘴」）
 */

import { logger } from "../../_core/logger";
import { injectModelPrompt } from "../../../shared/modelPromptTemplates";

/** 影影自動偵測到的意圖類別，對應 falModels.ts 的 category。 */
export type VideoIntent =
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "speech-to-video"
  | "enhance-video";

/** 影片生成的品質傾向；推薦模型時用來在「快/穩/精」之間切。 */
export type VideoQualityTier = "draft" | "standard" | "premium" | "ultra";

/**
 * 各意圖的預設 canonical fal model ID。
 *
 * 挑選原則：
 *   - text-to-video → fal-ai/wan-t2v（kling t2v 上游 short-circuit，wan 穩定）
 *   - image-to-video → kling v2.1 pro i2v（影片組 ultra 旗艦，運鏡品質最高）
 *   - video-to-video → kling v2.1 standard v2v（restyle / 風格轉換主力）
 *   - speech-to-video → wan 2.2 speech-to-video（對嘴主力，與 studio.animateSpeaker 一致）
 *   - enhance-video → topaz video-enhance（畫質升級旗艦，後面 RIFE/Bytedance 是 fallback）
 */
const DEFAULT_MODEL_BY_INTENT: Record<VideoIntent, string> = {
  "text-to-video": "fal-ai/wan-t2v",
  "image-to-video": "fal-ai/kling-video/v2.1/pro/image-to-video",
  "video-to-video": "fal-ai/kling-video/v2.1/standard/video-to-video",
  "speech-to-video": "fal-ai/wan/v2.2-14b/speech-to-video",
  "enhance-video": "fal-ai/topaz/video-enhance",
};

/**
 * 同一意圖內，依 quality tier 換模型的對應表。
 * 沒列到的 (intent, tier) 組合會 fall back 到 DEFAULT_MODEL_BY_INTENT。
 */
const MODEL_BY_INTENT_TIER: Partial<
  Record<VideoIntent, Partial<Record<VideoQualityTier, string>>>
> = {
  "text-to-video": {
    draft: "fal-ai/cogvideox-5b",
    standard: "fal-ai/wan-t2v",
    premium: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    ultra: "fal-ai/veo3",
  },
  "image-to-video": {
    draft: "fal-ai/ltx-video/image-to-video",
    standard: "fal-ai/wan-i2v",
    // Kling V2.1 Pro 是 i2v 旗艦（運鏡 + 首尾幀）；DEFAULT_MODEL_BY_INTENT["image-to-video"]
    // 也指向同一個 modelId，所以「沒給 qualityTier」與「premium tier」拿到同一支模型。
    premium: "fal-ai/kling-video/v2.1/pro/image-to-video",
    ultra: "fal-ai/runway-gen4-turbo/image-to-video",
  },
  "video-to-video": {
    draft: "fal-ai/animatediff-v2v",
    standard: "fal-ai/kling-video/v2.1/standard/video-to-video",
  },
  "speech-to-video": {
    standard: "fal-ai/wan/v2.2-14b/speech-to-video",
    premium: "fal-ai/echomimic-v3",
    ultra: "fal-ai/stable-avatar",
  },
  "enhance-video": {
    draft: "fal-ai/rife-v4.6/video",
    standard: "fal-ai/bytedance/upscaler/video",
    premium: "fal-ai/topaz/video-enhance",
  },
};

/**
 * 向後相容的 alias 表：過去 videoSpecialistTools 的 friendly model IDs
 * （hailu-video / wav2lip / kling-video / minimax-video / luma-dream /
 * runway-gen3）→ 對應的 canonical fal ID。LLM 或舊呼叫端用舊名也能跑。
 *
 * 注意 image-to-video 是「上下文相依」的：hailu-video 既是 t2v 也是 i2v
 * 入口；resolveModelId 在拿到 intent 時會挑對的分支。
 */
const LEGACY_ALIAS_T2V: Record<string, string> = {
  "hailu-video": "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "minimax-video": "fal-ai/minimax-video/text-to-video",
  "luma-dream": "fal-ai/luma-dream-machine",
  "kling-video": "fal-ai/kling-video/v2.1/pro/text-to-video",
};

const LEGACY_ALIAS_I2V: Record<string, string> = {
  "hailu-video": "fal-ai/minimax/hailuo-02/pro/image-to-video",
  "minimax-video": "fal-ai/minimax-video/image-to-video",
  "luma-dream": "fal-ai/luma-dream-machine/image-to-video",
  "kling-video": "fal-ai/kling-video/v2.1/pro/image-to-video",
  "runway-gen3": "fal-ai/runway-gen3/turbo/image-to-video",
  "runway-gen4": "fal-ai/runway-gen4-turbo/image-to-video",
};

const LEGACY_ALIAS_LIPSYNC: Record<string, string> = {
  wav2lip: "fal-ai/wan/v2.2-14b/speech-to-video",
  "wan-speech": "fal-ai/wan/v2.2-14b/speech-to-video",
  echomimic: "fal-ai/echomimic-v3",
  "stable-avatar": "fal-ai/stable-avatar",
};

function resolveCanonicalModelId(
  modelId: string | undefined,
  intent: VideoIntent,
  fallback: string,
): string {
  if (!modelId) return fallback;
  // 已經是 canonical fal-ai/ 開頭，原樣使用（並信任呼叫端有選對 category）。
  if (modelId.startsWith("fal-ai/")) return modelId;
  if (intent === "image-to-video") {
    return LEGACY_ALIAS_I2V[modelId] ?? LEGACY_ALIAS_T2V[modelId] ?? fallback;
  }
  if (intent === "speech-to-video") {
    return LEGACY_ALIAS_LIPSYNC[modelId] ?? fallback;
  }
  if (intent === "video-to-video" || intent === "enhance-video") {
    return fallback;
  }
  return LEGACY_ALIAS_T2V[modelId] ?? fallback;
}

/**
 * 共同的 fal queue 提交 + 等待 helper。把 step 1 (queue submit) 與
 * step 2 (poll for completion) 包成一個方便影影呼叫的單一 awaitable。
 *
 * 為什麼要等：orchestrator 串多步驟時靠 `${step1.video_url}` 把第一步的
 * 影片送進第二步（例如配音 / 對嘴 / enhance）；只回 request_id 那個欄位永遠
 * 不會解。等待上限 60 秒 → 5 分鐘（影片任務本身就需要 1-5 分鐘），逾時則
 * 回 status:"pending" + request_id 讓呼叫端自行處理。
 */
async function submitAndAwait(params: {
  userId: number;
  intent: VideoIntent;
  modelId: string;
  input: Record<string, unknown>;
  route: string;
  waitTimeoutMs?: number;
}): Promise<{
  status: "completed" | "failed" | "pending";
  request_id: string;
  modelId: string;
  video_url?: string;
  output_url?: string;
  error?: string;
  degraded?: boolean;
  originalModel?: string;
  raw?: unknown;
}> {
  const { dispatchFalQueueTask } = await import("../falDispatcher");
  const { awaitFalQueueResult } = await import("../falQueueAwaiter");

  // 把 videoSpecialist 內部的 intent 對應到 falDispatcher 期望的 category。
  // enhance-video / speech-to-video 在 fal catalog 都歸 video-to-video /
  // image-to-video 之下，所以拆兩個對應。
  const categoryForFal: string =
    params.intent === "enhance-video"
      ? "video-to-video"
      : params.intent === "speech-to-video"
        ? "image-to-video"
        : params.intent;

  const submitted = await dispatchFalQueueTask({
    modelId: params.modelId,
    category: categoryForFal,
    input: params.input,
    route: params.route,
    modality: "video",
    userId: params.userId,
  });

  const awaited = await awaitFalQueueResult(
    submitted.request_id,
    submitted.modelId,
    { timeoutMs: params.waitTimeoutMs ?? 300_000 },
  );

  return {
    status: awaited.status,
    request_id: submitted.request_id,
    modelId: submitted.modelId,
    video_url: awaited.video_url ?? awaited.output_url,
    output_url: awaited.output_url,
    error: awaited.error,
    degraded: submitted.degraded,
    originalModel: submitted.originalModel,
    raw: awaited.raw,
  };
}

/** 用輸入欄位自動判斷使用者實際要做的影片任務類型。 */
export function inferVideoIntent(input: {
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  operation?: string;
}): VideoIntent {
  if (input.operation && ["upscale", "interpolate", "enhance"].includes(input.operation)) {
    return "enhance-video";
  }
  if (input.audioUrl && input.imageUrl) return "speech-to-video";
  if (input.videoUrl) return input.operation === "enhance" ? "enhance-video" : "video-to-video";
  if (input.imageUrl) return "image-to-video";
  return "text-to-video";
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 1: generateVideo — 影影主入口；依輸入自動 t2v / i2v / v2v 分流
// ────────────────────────────────────────────────────────────────────────────

export interface GenerateVideoInput {
  userId: number;
  prompt: string;
  modelId?: string;
  /** 若有，會優先走 image-to-video。 */
  imageUrl?: string;
  /** i2v 的尾幀（Kling V2.1 支援首尾幀生成）。 */
  endImageUrl?: string;
  /** 若有，會優先走 video-to-video（風格轉換）。 */
  videoUrl?: string;
  /** 影片時長秒數，預設 5。 */
  duration?: number;
  /** 影片比例，預設 16:9。 */
  aspectRatio?: string;
  /** 幀率（LTX/RIFE 之類接受 fps 參數的模型）。 */
  fps?: number;
  /** 負面提示詞，會與 modelPromptTemplates 的預設 negative 合併。 */
  negativePrompt?: string;
  /** 偏好的品質 tier。modelId 缺省時用來挑預設模型。 */
  qualityTier?: VideoQualityTier;
  /** 隨機種子（重現流程用）。 */
  seed?: number;
  /** 是否等待完成。預設 true；fire-and-forget 流程可傳 false。 */
  awaitCompletion?: boolean;
}

export interface GenerateVideoResult {
  success: boolean;
  status: "completed" | "failed" | "pending";
  jobId: string;
  intent: VideoIntent;
  modelId: string;
  /** 完成時的影片 URL（pending / failed 時可能為 undefined）。 */
  videoUrl?: string;
  /** 命中的 prompt template 的 rationale（給使用者解釋為何這樣寫）。 */
  promptRationale?: string;
  /** dispatcher 降級時帶上原始 modelId。 */
  originalModel?: string;
  message: string;
  error?: string;
}

export async function generateVideo(
  input: GenerateVideoInput,
): Promise<GenerateVideoResult> {
  const intent: VideoIntent = inferVideoIntent({
    imageUrl: input.imageUrl,
    videoUrl: input.videoUrl,
  });

  const fallbackModel =
    MODEL_BY_INTENT_TIER[intent]?.[input.qualityTier ?? "premium"] ??
    DEFAULT_MODEL_BY_INTENT[intent];
  const modelId = resolveCanonicalModelId(input.modelId, intent, fallbackModel);

  // Cinematic 提示詞注入：給 Kling / Veo 等對運鏡描述敏感的模型補上後綴；
  // 已自訂 negativePrompt 的場景不會被覆蓋。
  const injection = injectModelPrompt(input.prompt, modelId, {
    userNegativePrompt: input.negativePrompt,
  });

  const falInput: Record<string, unknown> = { prompt: injection.prompt };
  if (input.negativePrompt) {
    falInput.negative_prompt = input.negativePrompt;
  } else if (injection.defaultNegativePrompt) {
    falInput.negative_prompt = injection.defaultNegativePrompt;
  }
  if (input.imageUrl) falInput.image_url = input.imageUrl;
  if (input.endImageUrl) falInput.end_image_url = input.endImageUrl;
  if (input.videoUrl) falInput.video_url = input.videoUrl;
  if (typeof input.duration === "number") falInput.duration = input.duration;
  if (input.aspectRatio) falInput.aspect_ratio = input.aspectRatio;
  if (typeof input.fps === "number") falInput.fps = input.fps;
  if (typeof input.seed === "number") falInput.seed = input.seed;

  try {
    if (input.awaitCompletion === false) {
      // Fire-and-forget：呼叫端不想等完成（例如批次提交 + webhook 收結果）。
      const { dispatchFalQueueTask } = await import("../falDispatcher");
      const submitted = await dispatchFalQueueTask({
        modelId,
        category: intent,
        input: falInput,
        route: "videoSpecialist.generate",
        modality: "video",
        userId: input.userId,
      });
      logger.info("video_generation_submitted", {
        userId: input.userId,
        request_id: submitted.request_id,
        modelId: submitted.modelId,
        intent,
        awaited: false,
      });
      return {
        success: true,
        status: "pending",
        jobId: submitted.request_id,
        intent,
        modelId: submitted.modelId,
        originalModel: submitted.originalModel,
        promptRationale: injection.rationale,
        message: `影片任務已送出（${intent}），等待 fal 處理：${submitted.request_id}`,
      };
    }

    const awaited = await submitAndAwait({
      userId: input.userId,
      intent,
      modelId,
      input: falInput,
      route: "videoSpecialist.generate",
    });

    logger.info("video_generation_completed", {
      userId: input.userId,
      request_id: awaited.request_id,
      modelId: awaited.modelId,
      intent,
      status: awaited.status,
      hasVideoUrl: !!awaited.video_url,
    });

    return {
      success: awaited.status !== "failed",
      status: awaited.status,
      jobId: awaited.request_id,
      intent,
      modelId: awaited.modelId,
      videoUrl: awaited.video_url,
      originalModel: awaited.originalModel,
      promptRationale: injection.rationale,
      message:
        awaited.status === "completed"
          ? `影片完成（${intent}，模型 ${awaited.modelId}）`
          : awaited.status === "pending"
            ? `影片仍在處理：${awaited.request_id}`
            : `影片生成失敗：${awaited.error ?? "未知錯誤"}`,
      error: awaited.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("video_generation_failed", {
      userId: input.userId,
      intent,
      modelId,
      error: message,
    });
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent,
      modelId,
      message: `影片生成失敗：${message}`,
      error: message,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 2: imageToVideo — 顯式 i2v 入口；建議 LLM 直呼避免 prompt-only 的歧義
// ────────────────────────────────────────────────────────────────────────────

export interface ImageToVideoInput {
  userId: number;
  imageUrl: string;
  prompt?: string;
  modelId?: string;
  endImageUrl?: string;
  duration?: number;
  aspectRatio?: string;
  motion?: "subtle" | "moderate" | "dynamic";
  qualityTier?: VideoQualityTier;
  seed?: number;
  awaitCompletion?: boolean;
}

const MOTION_HINTS: Record<NonNullable<ImageToVideoInput["motion"]>, string> = {
  subtle: "subtle breathing motion, gentle parallax",
  moderate: "smooth camera push-in, natural motion",
  dynamic: "energetic camera movement, dynamic action",
};

export async function imageToVideo(
  input: ImageToVideoInput,
): Promise<GenerateVideoResult> {
  if (!input.imageUrl) {
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent: "image-to-video",
      modelId: "(unspecified)",
      message: "imageToVideo 需要 imageUrl",
      error: "missing-imageUrl",
    };
  }
  const motionHint = input.motion ? MOTION_HINTS[input.motion] : undefined;
  const userPrompt = input.prompt?.trim() || "animate this image";
  const combinedPrompt = motionHint
    ? `${userPrompt}, ${motionHint}`
    : userPrompt;

  return generateVideo({
    userId: input.userId,
    prompt: combinedPrompt,
    imageUrl: input.imageUrl,
    endImageUrl: input.endImageUrl,
    modelId: input.modelId,
    duration: input.duration,
    aspectRatio: input.aspectRatio,
    qualityTier: input.qualityTier,
    seed: input.seed,
    awaitCompletion: input.awaitCompletion,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 3: createLipSync — 對嘴影片（speech-to-video）
// ────────────────────────────────────────────────────────────────────────────

export interface CreateLipSyncInput {
  userId: number;
  /** 靜態頭像 / 起始幀。 */
  imageUrl: string;
  /** 對嘴音訊（語音先用聲聲產出）。 */
  audioUrl: string;
  /** Optional：講話內容描述（EchoMimic 接受 text 模式時用）。 */
  prompt?: string;
  /** 預設 Wan 2.2；EchoMimic V3 / StableAvatar 透過 qualityTier 切換。 */
  modelId?: string;
  qualityTier?: VideoQualityTier;
  /** 預設 80（Wan 2.2 約 3.3s @ 24fps）。範圍 16-200。 */
  numFrames?: number;
  awaitCompletion?: boolean;
}

export async function createLipSync(
  input: CreateLipSyncInput,
): Promise<GenerateVideoResult> {
  if (!input.imageUrl || !input.audioUrl) {
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent: "speech-to-video",
      modelId: "(unspecified)",
      message: "createLipSync 需要 imageUrl 與 audioUrl 兩個欄位",
      error: "missing-imageUrl-or-audioUrl",
    };
  }
  const fallbackModel =
    MODEL_BY_INTENT_TIER["speech-to-video"]?.[input.qualityTier ?? "standard"] ??
    DEFAULT_MODEL_BY_INTENT["speech-to-video"];
  const modelId = resolveCanonicalModelId(
    input.modelId,
    "speech-to-video",
    fallbackModel,
  );

  const falInput: Record<string, unknown> = {
    image_url: input.imageUrl,
    audio_url: input.audioUrl,
  };
  if (input.prompt) falInput.prompt = input.prompt;
  if (typeof input.numFrames === "number") {
    falInput.num_frames = Math.max(16, Math.min(200, input.numFrames));
  }

  try {
    if (input.awaitCompletion === false) {
      const { dispatchFalQueueTask } = await import("../falDispatcher");
      const submitted = await dispatchFalQueueTask({
        modelId,
        // speech-to-video 在 fal catalog 歸 image-to-video（speech 是 driver）
        category: "image-to-video",
        input: falInput,
        route: "videoSpecialist.lipSync",
        modality: "video",
        userId: input.userId,
      });
      return {
        success: true,
        status: "pending",
        jobId: submitted.request_id,
        intent: "speech-to-video",
        modelId: submitted.modelId,
        originalModel: submitted.originalModel,
        message: `對嘴影片已送出：${submitted.request_id}`,
      };
    }

    // 對嘴影片動輒 60-180 秒，給比一般 t2v 寬一點的等待 budget。
    const awaited = await submitAndAwait({
      userId: input.userId,
      intent: "speech-to-video",
      modelId,
      input: falInput,
      route: "videoSpecialist.lipSync",
      waitTimeoutMs: 480_000,
    });

    logger.info("lip_sync_completed", {
      userId: input.userId,
      request_id: awaited.request_id,
      modelId: awaited.modelId,
      status: awaited.status,
    });

    return {
      success: awaited.status !== "failed",
      status: awaited.status,
      jobId: awaited.request_id,
      intent: "speech-to-video",
      modelId: awaited.modelId,
      videoUrl: awaited.video_url,
      originalModel: awaited.originalModel,
      message:
        awaited.status === "completed"
          ? `對嘴影片完成（模型 ${awaited.modelId}）`
          : awaited.status === "pending"
            ? `對嘴仍在處理：${awaited.request_id}`
            : `對嘴失敗：${awaited.error ?? "未知錯誤"}`,
      error: awaited.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("lip_sync_failed", {
      userId: input.userId,
      modelId,
      error: message,
    });
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent: "speech-to-video",
      modelId,
      message: `對嘴失敗：${message}`,
      error: message,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 4: enhanceVideo — 畫質優化（upscale / interpolate / enhance）
// ────────────────────────────────────────────────────────────────────────────

export type EnhanceVideoOperation = "upscale" | "interpolate" | "enhance";

export interface EnhanceVideoInput {
  userId: number;
  videoUrl: string;
  operation: EnhanceVideoOperation;
  modelId?: string;
  /** upscale 倍率（2 / 4）。 */
  upscaleFactor?: number;
  /** 插補倍率（2 / 4 → 24fps → 48/96fps）。 */
  multiplier?: number;
  outputFps?: number;
  /** Topaz 子模型：iris / artemis / theia / gaia / nyx。 */
  topazModel?: string;
  awaitCompletion?: boolean;
}

const ENHANCE_DEFAULT_BY_OP: Record<EnhanceVideoOperation, string> = {
  upscale: "fal-ai/bytedance/upscaler/video",
  interpolate: "fal-ai/rife-v4.6/video",
  enhance: "fal-ai/topaz/video-enhance",
};

export async function enhanceVideo(
  input: EnhanceVideoInput,
): Promise<GenerateVideoResult> {
  if (!input.videoUrl) {
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent: "enhance-video",
      modelId: "(unspecified)",
      message: "enhanceVideo 需要 videoUrl",
      error: "missing-videoUrl",
    };
  }
  const modelId = input.modelId ?? ENHANCE_DEFAULT_BY_OP[input.operation];
  const falInput: Record<string, unknown> = { video_url: input.videoUrl };
  if (typeof input.upscaleFactor === "number") {
    falInput.upscale_factor = input.upscaleFactor;
  }
  if (typeof input.multiplier === "number") falInput.multiplier = input.multiplier;
  if (typeof input.outputFps === "number") falInput.output_fps = input.outputFps;
  if (input.topazModel) falInput.model = input.topazModel;

  try {
    if (input.awaitCompletion === false) {
      const { dispatchFalQueueTask } = await import("../falDispatcher");
      const submitted = await dispatchFalQueueTask({
        modelId,
        category: "video-to-video",
        input: falInput,
        route: "videoSpecialist.enhance",
        modality: "video",
        userId: input.userId,
      });
      return {
        success: true,
        status: "pending",
        jobId: submitted.request_id,
        intent: "enhance-video",
        modelId: submitted.modelId,
        originalModel: submitted.originalModel,
        message: `畫質優化（${input.operation}）已送出：${submitted.request_id}`,
      };
    }

    // Topaz 的 enhance 動輒 5-10 分鐘，給更寬的等待 budget。
    const isHeavy = modelId === "fal-ai/topaz/video-enhance";
    const awaited = await submitAndAwait({
      userId: input.userId,
      intent: "enhance-video",
      modelId,
      input: falInput,
      route: "videoSpecialist.enhance",
      waitTimeoutMs: isHeavy ? 600_000 : 300_000,
    });

    logger.info("video_enhance_completed", {
      userId: input.userId,
      operation: input.operation,
      request_id: awaited.request_id,
      modelId: awaited.modelId,
      status: awaited.status,
    });

    return {
      success: awaited.status !== "failed",
      status: awaited.status,
      jobId: awaited.request_id,
      intent: "enhance-video",
      modelId: awaited.modelId,
      videoUrl: awaited.video_url,
      originalModel: awaited.originalModel,
      message:
        awaited.status === "completed"
          ? `影片優化完成（${input.operation}，模型 ${awaited.modelId}）`
          : awaited.status === "pending"
            ? `影片優化仍在處理：${awaited.request_id}`
            : `影片優化失敗：${awaited.error ?? "未知錯誤"}`,
      error: awaited.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("video_enhance_failed", {
      userId: input.userId,
      operation: input.operation,
      modelId,
      error: message,
    });
    return {
      success: false,
      status: "failed",
      jobId: "",
      intent: "enhance-video",
      modelId,
      message: `畫質優化失敗：${message}`,
      error: message,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 5: recommendModel — 純推理：依意圖 + 約束建議 modelId
// ────────────────────────────────────────────────────────────────────────────

export interface RecommendModelInput {
  intent: VideoIntent;
  /** 預期秒數。>10 秒會避開 Kling Pro 的高單價。 */
  durationSec?: number;
  /** 預算（點數）。給 financeRails 一個 hard cap，會在解釋裡反映。 */
  budgetPoints?: number;
  /** 期望品質傾向；不給就回 premium tier 的預設模型。 */
  qualityTier?: VideoQualityTier;
  /** 使用者的語意 hint，例如「電影感 / 動畫 / 商業 teaser」會偏向不同模型。 */
  hint?: string;
}

export interface RecommendModelResult {
  intent: VideoIntent;
  modelId: string;
  /** 同 tier 內的次佳選擇（fallback 用）。 */
  alternatives: string[];
  rationale: string;
}

export function recommendModel(
  input: RecommendModelInput,
): RecommendModelResult {
  const tier: VideoQualityTier = input.qualityTier ?? "premium";
  const tierTable = MODEL_BY_INTENT_TIER[input.intent] ?? {};
  const primary =
    tierTable[tier] ?? DEFAULT_MODEL_BY_INTENT[input.intent];

  // 列同 intent 下其他 tier 的模型作為備案，剔除主選。
  const allTiers = Object.entries(tierTable)
    .map(([, model]) => model)
    .filter((m): m is string => !!m && m !== primary);
  const intentDefault = DEFAULT_MODEL_BY_INTENT[input.intent];
  const alternatives = Array.from(
    new Set([...allTiers, intentDefault].filter(m => m !== primary)),
  );

  const rationaleParts: string[] = [
    `意圖 ${input.intent} + ${tier} tier 對應的旗艦：${primary}`,
  ];
  // 時長關卡：>10 秒的 Kling Pro 會非常貴，會建議改 standard / Wan
  if (
    typeof input.durationSec === "number" &&
    input.durationSec > 10 &&
    primary.includes("kling-video/v2.1/pro")
  ) {
    rationaleParts.push(
      `提醒：${input.durationSec}s 超過 10 秒在 Kling Pro 會雙倍計費；可考慮改 Standard 或 Wan 開源模型`,
    );
  }
  if (input.budgetPoints && input.budgetPoints < 30) {
    rationaleParts.push(
      `預算 ${input.budgetPoints} 點偏低，建議改走 draft tier（cogvideox-5b / ltx-video / wan-i2v）`,
    );
  }
  if (input.hint) {
    rationaleParts.push(`使用者意圖摘要：${input.hint}`);
  }

  return {
    intent: input.intent,
    modelId: primary,
    alternatives,
    rationale: rationaleParts.join("；"),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 6: estimateCost — 純推理：用 modelPricing 估點數，給財財試算
// ────────────────────────────────────────────────────────────────────────────

export interface EstimateCostInput {
  modelId: string;
  durationSec?: number;
}

export interface EstimateCostResult {
  modelId: string;
  totalPoints: number;
  breakdown: string;
}

export async function estimateCost(
  input: EstimateCostInput,
): Promise<EstimateCostResult> {
  const { estimatePoints } = await import("../modelPricing");
  const result = estimatePoints(input.modelId, {
    durationSec: input.durationSec,
  });
  return {
    modelId: result.modelId,
    totalPoints: result.totalPoints,
    breakdown: result.breakdown,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tool 7: planVideoWorkflow — 純推理：把使用者目標拆成多步驟工作流
// ────────────────────────────────────────────────────────────────────────────

export interface PlanVideoWorkflowInput {
  /** 使用者描述，例如「我要做一段 10 秒的療癒對嘴影片」。 */
  goal: string;
  /** 預期秒數；用來估第一個影片 step 的 duration。 */
  durationSec?: number;
  /** 是否要對嘴。沒填時用 goal 文字判斷（「對嘴 / 講話 / 旁白 + 角色 + 音」）。 */
  withLipSync?: boolean;
  /** 是否要旁白配音。 */
  withVoiceover?: boolean;
  /** 是否要 BGM。 */
  withMusic?: boolean;
  /** 是否要畫質優化。 */
  withEnhance?: boolean;
  /** 起點：使用者已有一張靜態圖（imageUrl）→ skip image step，直接 i2v。 */
  startingImageUrl?: string;
}

export interface PlanStep {
  stepId: string;
  spirit:
    | "image-specialist"
    | "video-specialist"
    | "voice-specialist"
    | "music-specialist"
    | "critic";
  tool: string;
  description: string;
  dependsOn: string[];
}

export interface PlanVideoWorkflowResult {
  steps: PlanStep[];
  estimatedTotalSec: number;
  notes: string[];
}

export function planVideoWorkflow(
  input: PlanVideoWorkflowInput,
): PlanVideoWorkflowResult {
  const goalLower = input.goal.toLowerCase();
  const wantsLipSync =
    input.withLipSync ??
    /對嘴|lip\s*sync|講話|說話|talking head|對口型/.test(input.goal);
  const wantsVoiceover =
    input.withVoiceover ??
    /旁白|配音|narration|voice over|voiceover/.test(input.goal);
  const wantsMusic =
    input.withMusic ??
    /配樂|bgm|背景音樂|music/.test(goalLower);
  const wantsEnhance =
    input.withEnhance ??
    /畫質|清晰|upscale|enhance|高解|4k|插補|smooth/.test(goalLower);

  const durationSec = input.durationSec ?? 5;
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  let etaSec = 0;

  // Step 1: 圖（除非使用者已有起點圖）
  if (!input.startingImageUrl) {
    steps.push({
      stepId: "step-image",
      spirit: "image-specialist",
      tool: "imageSpecialist.generate",
      description: "圖圖：生成影片首幀 / 主視覺",
      dependsOn: [],
    });
    etaSec += 30;
  } else {
    notes.push("使用者已提供起始圖，跳過 image step 直接 i2v");
  }

  // Step 2: 影片本體（i2v）
  steps.push({
    stepId: "step-video",
    spirit: "video-specialist",
    tool: "videoSpecialist.imageToVideo",
    description: `影影：用首幀生成 ${durationSec}s 影片`,
    dependsOn: input.startingImageUrl ? [] : ["step-image"],
  });
  etaSec += Math.max(60, durationSec * 12);

  // Step 3: 配音（若需要對嘴或旁白）
  if (wantsLipSync || wantsVoiceover) {
    steps.push({
      stepId: "step-voice",
      spirit: "voice-specialist",
      tool: "voiceSpecialist.generateSpeech",
      description: "聲聲：TTS 配音 / 旁白",
      dependsOn: [],
    });
    etaSec += 25;
  }

  // Step 4: 對嘴（speech-to-video）— 取代 step-video 的角色或疊在影片上
  if (wantsLipSync) {
    steps.push({
      stepId: "step-lipsync",
      spirit: "video-specialist",
      tool: "videoSpecialist.lipSync",
      description: "影影：對嘴影片（圖 + 配音 → 對嘴）",
      dependsOn: [
        input.startingImageUrl ? "step-voice" : "step-image",
        "step-voice",
      ],
    });
    etaSec += 90;
  }

  // Step 5: BGM
  if (wantsMusic) {
    steps.push({
      stepId: "step-music",
      spirit: "music-specialist",
      tool: "musicSpecialist.generate",
      description: "音音：BGM 配樂",
      dependsOn: [],
    });
    etaSec += 45;
  }

  // Step 6: enhance
  if (wantsEnhance) {
    const before = wantsLipSync ? "step-lipsync" : "step-video";
    steps.push({
      stepId: "step-enhance",
      spirit: "video-specialist",
      tool: "videoSpecialist.enhance",
      description: "影影：畫質優化（upscale / enhance）",
      dependsOn: [before],
    });
    etaSec += 180;
  }

  // Step 7: critic
  steps.push({
    stepId: "step-review",
    spirit: "critic",
    tool: "review",
    description: "品品：交付前看一輪",
    dependsOn: steps.map(s => s.stepId),
  });
  etaSec += 20;

  if (durationSec > 10) {
    notes.push("影片超過 10 秒，建議用 standard tier 模型節省點數");
  }
  if (wantsLipSync && !wantsVoiceover) {
    notes.push("對嘴需要先有配音音檔；已自動安排 voiceover step");
  }

  return {
    steps,
    estimatedTotalSec: etaSec,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Static helpers — 給 UI / planner 的模型清單與場景化提示詞
// ────────────────────────────────────────────────────────────────────────────

export function getVideoModels(): {
  success: boolean;
  models: Array<{
    id: string;
    name: string;
    description: string;
    intent: VideoIntent;
    tier: VideoQualityTier;
    maxDuration: number;
    strengths: string[];
  }>;
} {
  return {
    success: true,
    models: [
      // text-to-video
      {
        id: "fal-ai/wan-t2v",
        name: "WAN T2V 2.1",
        description: "720p 開源文生影，穩定且多語",
        intent: "text-to-video",
        tier: "standard",
        maxDuration: 6,
        strengths: ["穩定", "多語", "開源"],
      },
      {
        id: "fal-ai/minimax/hailuo-02/pro/text-to-video",
        name: "MiniMax Hailuo 02 Pro t2v",
        description: "1080p 高擬真文生影，6s/10s",
        intent: "text-to-video",
        tier: "premium",
        maxDuration: 10,
        strengths: ["寫實", "穩定", "高解析"],
      },
      {
        id: "fal-ai/veo3",
        name: "Google Veo 3",
        description: "唯一原生同步音訊，cinematic motion 表現最佳",
        intent: "text-to-video",
        tier: "ultra",
        maxDuration: 8,
        strengths: ["音訊同步", "電影感", "高擬真"],
      },
      // image-to-video
      {
        id: "fal-ai/kling-video/v2.1/pro/image-to-video",
        name: "Kling V2.1 Pro i2v",
        description: "Kling 旗艦圖生影；首尾幀、aspect_ratio、motion intensity",
        intent: "image-to-video",
        tier: "ultra",
        maxDuration: 10,
        strengths: ["運鏡", "電影感", "首尾幀"],
      },
      {
        id: "fal-ai/runway-gen4-turbo/image-to-video",
        name: "Runway Gen4 Turbo i2v",
        description: "Runway Gen4 商業級 5s/10s，6 種比例",
        intent: "image-to-video",
        tier: "ultra",
        maxDuration: 10,
        strengths: ["商業 teaser", "穩定", "多比例"],
      },
      {
        id: "fal-ai/wan-i2v",
        name: "WAN I2V 2.1",
        description: "720p 開源圖生影，CP 值高",
        intent: "image-to-video",
        tier: "standard",
        maxDuration: 5,
        strengths: ["CP 值", "穩定", "開源"],
      },
      {
        id: "fal-ai/pixverse/v4.5/image-to-video",
        name: "PixVerse V4.5 i2v",
        description: "社群短片節奏；5/8s，多種卡通 / 漫畫風格",
        intent: "image-to-video",
        tier: "standard",
        maxDuration: 8,
        strengths: ["動漫", "風格化", "社群"],
      },
      // video-to-video
      {
        id: "fal-ai/kling-video/v2.1/standard/video-to-video",
        name: "Kling V2.1 v2v",
        description: "影片風格轉換 / restyle",
        intent: "video-to-video",
        tier: "standard",
        maxDuration: 10,
        strengths: ["風格轉換", "restyle"],
      },
      // speech-to-video
      {
        id: "fal-ai/wan/v2.2-14b/speech-to-video",
        name: "Wan 2.2 對嘴",
        description: "靜態頭像 + 音訊 → 對嘴影片（≈24fps）",
        intent: "speech-to-video",
        tier: "standard",
        maxDuration: 8,
        strengths: ["對嘴", "穩定", "短片"],
      },
      {
        id: "fal-ai/echomimic-v3",
        name: "EchoMimic V3 對嘴",
        description: "精準對嘴 + 表情連動，pose_style 0-45 控制動作幅度",
        intent: "speech-to-video",
        tier: "premium",
        maxDuration: 10,
        strengths: ["表情", "精準", "可控"],
      },
      {
        id: "fal-ai/stable-avatar",
        name: "Stable Avatar 長片",
        description: "音訊驅動頭像，最長 5 分鐘長片連續對嘴",
        intent: "speech-to-video",
        tier: "ultra",
        maxDuration: 300,
        strengths: ["長片", "Podcast", "課程旁白"],
      },
      // enhance
      {
        id: "fal-ai/topaz/video-enhance",
        name: "Topaz Video Enhance",
        description: "Topaz AI 影片畫質升級旗艦",
        intent: "enhance-video",
        tier: "premium",
        maxDuration: 60,
        strengths: ["畫質", "降噪", "影像復原"],
      },
      {
        id: "fal-ai/rife-v4.6/video",
        name: "RIFE 4.6 插補",
        description: "插補幀率（24fps → 48/96fps）",
        intent: "enhance-video",
        tier: "draft",
        maxDuration: 60,
        strengths: ["插補", "流暢", "快"],
      },
      {
        id: "fal-ai/bytedance/upscaler/video",
        name: "ByteDance Video Upscaler",
        description: "影片解析度放大 2x / 4x",
        intent: "enhance-video",
        tier: "standard",
        maxDuration: 60,
        strengths: ["放大", "穩定", "快"],
      },
    ],
  };
}

export function getVideoGenerationTips(
  scenario?: VideoIntent | "general",
): {
  success: boolean;
  tips: string[];
} {
  const generalTips = [
    "描述運鏡方式：「推軌」、「環繞」、「空拍俯視」",
    "指定動作和速度：「緩慢移動」、「快速奔跑」、「靜止特寫」",
    "加入時間和氛圍：「日落時分」、「夜間霓虹」、「清晨薄霧」",
    "避免過於複雜的場景轉換，單一鏡頭效果較好",
    "較短的影片（3-5 秒）通常比長影片品質更穩定",
  ];
  const byScenario: Record<VideoIntent, string[]> = {
    "text-to-video": [
      "從一個明確主體開始：「一隻橘貓在窗台」勝過「動物在某處」",
      "把運鏡與動作分開寫：先描述主體與場景，再說「鏡頭緩慢推進」",
      "Veo3 / Hailuo 02 對運鏡描述特別敏感，可指定「dolly in」「pan left」",
    ],
    "image-to-video": [
      "起點圖要有清楚主體與留白空間，避免主體頂滿畫面",
      "用 motion 參數（subtle / moderate / dynamic）控制動作幅度",
      "Kling Pro 支援首尾幀（end_image_url）— 想做轉場時非常好用",
      "想保持角色一致時，可考慮 Vidu Q1 reference-to-video 一次最多 3 張參考",
    ],
    "video-to-video": [
      "v2v 風格化最好用「短片 + 強風格描述」，例如「卡通水彩風」",
      "原片解析度 ≥720p、單一場景、運鏡簡單時轉換最穩",
      "搭配 strength 0.5-0.75 可在保留原構圖與套用新風格間取平衡",
    ],
    "speech-to-video": [
      "對嘴需要先有人聲音檔；先請聲聲產 TTS 再交給影影",
      "頭像圖建議：正面、嘴部清楚、背景單純",
      "Wan 2.2 約 24fps、最長 8 秒；長片旁白用 Stable Avatar（最長 5 分鐘）",
    ],
    "enhance-video": [
      "Topaz enhance 適合「畫質不夠清晰」的影片；upscale 適合「解析度太低」",
      "插補（RIFE）會把 24fps 補成 48/96fps，慢動作鏡頭特別有效",
      "enhance 動輒 5-10 分鐘，跑前先 ping 財財估算點數",
    ],
  };
  if (!scenario || scenario === "general") {
    return { success: true, tips: generalTips };
  }
  return {
    success: true,
    tips: [...byScenario[scenario], ...generalTips.slice(0, 2)],
  };
}
