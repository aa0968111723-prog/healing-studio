/**
 * videoStudio.ts — 影片專業工作室 Router
 *
 * 整合 fal.ai 頂尖影片生成模型，提供統一的 tRPC API 介面。
 *
 * ────────────────────────────────────────────────────────────
 * 五大功能分類：
 *  1. 文生影（Text-to-Video）
 *  2. 圖生影（Image-to-Video）
 *  3. 影生影（Video-to-Video）
 *  4. 影像畫質優化（Upscale / Enhancement）
 *  5. 進階精緻控制（Advanced Control）
 * ────────────────────────────────────────────────────────────
 *
 * 精選 FAL.AI 模型（v2026-04）：
 *  文生影：Kling v2.1, Wan v2.1, MiniMax Hailuo, Veo 3 Flash, Sora Turbo, LTX-2
 *  圖生影：Kling v2.1 I2V, Wan I2V, CogVideoX-5B I2V, Runway Gen4, Pixverse v4.5
 *  影生影：Wan VideoToVideo, Stable Video Diffusion, ByteDance ConsisID
 *  畫質優化：Topaz Video AI, ByteDance Upscaler, Frame Interpolation
 *  進階控制：AnimateDiff + ControlNet, DepthCrafter, CamMaster Camera Control
 */

import { z } from "zod";
import { safeExternalUrl, safeExternalUrlOptional } from "../utils/validateSafeUrl";
import { brainProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { FAL_QUEUE_BASE } from "../_core/providerFacade";
import { signWebhookToken, signFalWebhookNonce } from "../_core/webhookTokens";
import { recordErrorTrace } from "../services/brainAutoRepair";
import { traceToolRun } from "../services/langsmithTracer";
import { localizeResultUrls } from "../services/internalMedia";
import { dispatchFalQueueTask } from "../services/falDispatcher";
import { falQueueFetchWithPrefixFallback } from "../services/falQueueClient";
import { getFalModelById, resolveActiveModelId } from "../services/falModels";
import {
  doPostGenComplete,
  unifiedAssetPrefix,
} from "../services/postGenActions";
import {
  getVideoCompiler,
  type CameraModeId,
  type VideoBlock,
} from "../services/videoCompiler";
import { resolveFalSafetyChecker } from "../services/security/contentModeration";

// ─── fal.ai 呼叫工具（與 proStudio 相同模式；base URL 來自 providerFacade）───

function getFalKey(): string {
  const key = process.env.FAL_API_KEY;
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "FAL_API_KEY 未設定，請在 Railway → Environment Variables 中新增",
    });
  return key;
}

/** 使用 queue 非同步提交任務（透過 falDispatcher 統一派發），立即回傳 request_id */
async function falQueueSubmit(
  modelId: string,
  input: Record<string, unknown>,
  jobId?: number
): Promise<{ request_id: string }> {
  // 若設定了 VITE_SITE_URL，一律帶 webhook 回呼。
  //  - 有 jobId（理論上沒走過這條,VideoStudio 入口先送 fal 才建 backgroundJob）→
  //    直接帶 ?jobId=<id> 走最快路徑。
  //  - 沒有 jobId（VideoStudio klingTextToVideo 等）→ 走通用 /api/webhook/fal,
  //    webhook handler 會用 payload.request_id 反查 resultJson.requestId 找到 job。
  //
  // 之前條件是 `siteUrl && jobId`，所以 VideoStudio 全線都跳過 webhook,
  // 完成時只能靠 BackgroundTasksContext 5 秒輪詢 + checkStudioJob 拉結果。
  // 一旦 polling 端某條 modelId 路徑（例如 Kling Pro/i2v 深巢狀 modelId）
  // 命不中 fal queue endpoint,影片就只剩「processing 30 分鐘 → 超時失敗」
  // 一條路 — 或更糟,完成卻沒寫入 URL,UI 顯示完成卻無預覽/無下載。
  // AIDV-158：附帶 per-job capability token（handler 端會驗，缺/錯 token 一律 4xx）。
  //  - 有 jobId → 簽 fal:<jobId>。
  //  - 無 jobId（靠 request_id 反查的入口）→ 簽一次性 server-origin nonce（fal:n:<nonce>）。
  const siteUrl = process.env.VITE_SITE_URL?.trim();
  let webhookUrl: string | undefined;
  if (siteUrl) {
    if (jobId) {
      const falToken = signWebhookToken("fal", jobId);
      webhookUrl = `${siteUrl}/api/webhook/fal?jobId=${jobId}${falToken ? `&token=${falToken}` : ""}`;
    } else {
      const falSigned = signFalWebhookNonce();
      webhookUrl = falSigned
        ? `${siteUrl}/api/webhook/fal?fnonce=${falSigned.nonce}&token=${falSigned.token}`
        : `${siteUrl}/api/webhook/fal`;
    }
  }

  try {
    const result = await dispatchFalQueueTask({
      modelId,
      input,
      webhookUrl,
      route: "trpc.videoStudio.*",
      modality: "video",
    });
    return { request_id: result.request_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `fal.ai submit 錯誤 [${modelId}]: ${msg}`,
    });
  }
}

async function falQueueStatus(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await falQueueFetchWithPrefixFallback(
    modelId,
    requestId,
    "/status",
    key
  );
  if (!res.ok) {
    void traceToolRun({
      runName: "video-studio/fal-queue-status",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.videoStudio.check*",
      method: "GET",
      inputs: { request_id: requestId },
      error: `HTTP ${res.status}`,
      durationMs: Date.now() - startedAt,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "查詢狀態失敗",
    });
  }
  const data = await res.json();
  void traceToolRun({
    runName: "video-studio/fal-queue-status",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.videoStudio.check*",
    method: "GET",
    inputs: { request_id: requestId },
    outputs: {
      status: (data as { status?: string })?.status ?? "unknown",
      request_id: requestId,
    },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

async function falQueueResult(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await falQueueFetchWithPrefixFallback(
    modelId,
    requestId,
    "",
    key
  );
  if (!res.ok) {
    void traceToolRun({
      runName: "video-studio/fal-queue-result",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.videoStudio.check*",
      method: "GET",
      inputs: { request_id: requestId },
      error: `HTTP ${res.status}`,
      durationMs: Date.now() - startedAt,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "取得結果失敗",
    });
  }
  const data = await res.json();
  void traceToolRun({
    runName: "video-studio/fal-queue-result",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.videoStudio.check*",
    method: "GET",
    inputs: { request_id: requestId },
    outputs: {
      status: (data as { status?: string })?.status ?? "unknown",
      request_id: requestId,
      has_result: true,
    },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

async function falQueueRun(
  modelId: string,
  input: Record<string, unknown>,
  _waitSec = 300 // 參數已废棄，不在後端等待（防止 504）
): Promise<unknown> {
  const { request_id } = await falQueueSubmit(modelId, input);
  // 立即回傳 request_id，前端每 3 秒輪詢 checkVideoStatus
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}

// ─── 提取影片 URL 的通用助手 ─────────────────────────────────────────────────

function extractVideoUrl(result: any): string | null {
  return (
    result?.video?.url ??
    result?.video_url ??
    result?.output?.url ??
    result?.data?.video?.url ??
    result?.data?.video_url ??
    result?.videos?.[0]?.url ??
    null
  );
}

// ─── Pre-flight model substitution ────────────────────────────────────────
// Many fal-ai endpoints we expose were short-circuited or removed upstream
// (cammaster / depthcrafter / topaz / rife / bytedance upscaler / kling
// standard t2v / sora). The catalog tracks this via `disabled: true` plus
// an explicit `replacement` working modelId. We transparently rewrite the
// dispatch target here, so:
//   - the user-facing dropdown / model selection keeps showing the
//     historical label (no UI churn, no regressions in saved brain configs)
//   - the actual fal queue submit goes to a working sibling endpoint, so
//     generation completes and the result gets saved to R2 as normal
//   - the response carries `model_requested` / `model_used` / `degraded` so
//     the UI can surface "上游暫停，已使用 X 代替" without hiding the swap.
//
// If a disabled entry ever lacks a `replacement` (none currently — see
// falModels.ts catalog), we fall back to the legacy throw with the same
// PRECONDITION_FAILED code the UI already handles.
function resolveModelOrThrow(modelId: string): {
  modelId: string;
  substituted: boolean;
  original: string;
  reason?: string;
  replacementLabel?: string;
} {
  const cfg = getFalModelById(modelId);
  if (!cfg) {
    return { modelId, substituted: false, original: modelId };
  }
  if (cfg.disabled && !cfg.replacement) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `模型 ${cfg.label}（${modelId}）目前在 fal.ai 上游不可用且無等效替代品。` +
        (cfg.disabledReason ? ` 原因：${cfg.disabledReason}` : "") +
        " 請改選同分頁中其他可用的模型。",
    });
  }
  return resolveActiveModelId(modelId);
}

/**
 * Backwards-compatible wrapper. Working models hit this and pass straight
 * through. The 8 broken-upstream models all now carry a `replacement`
 * field in the catalog, so they no longer throw here — the call sites
 * for those 8 use `resolveModelOrThrow` directly to obtain the rewritten
 * modelId. Kept so the 14 non-broken call sites elsewhere in this file
 * continue to compile / read naturally.
 */
function assertModelEnabled(modelId: string): void {
  resolveModelOrThrow(modelId);
}

/**
 * Helper to merge substitution telemetry into a router response so every
 * disabled-model path emits a consistent `{ model_requested, model_used,
 * degraded, degraded_reason }` triplet. UI reads these to render the
 * amber "上游暫停，已使用 X 代替" callout instead of a hard error toast.
 */
function withSubstitutionMeta<T extends Record<string, unknown>>(
  body: T,
  resolved: ReturnType<typeof resolveModelOrThrow>
): T & {
  model_used: string;
  model_requested: string;
  degraded?: boolean;
  degraded_reason?: string;
} {
  if (!resolved.substituted) {
    return { ...body, model_used: resolved.modelId, model_requested: resolved.original };
  }
  return {
    ...body,
    model_used: resolved.modelId,
    model_requested: resolved.original,
    degraded: true,
    degraded_reason:
      `所選模型 ${resolved.original} 目前在 fal.ai 上游不可用` +
      (resolved.reason ? `（${resolved.reason}）` : "") +
      (resolved.replacementLabel
        ? `，已自動使用 ${resolved.replacementLabel}（${resolved.modelId}）代替`
        : `，已自動使用 ${resolved.modelId} 代替`),
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const videoStudioRouter = router({
  /** FAL_API_KEY 是否設定（前端用來顯示提示） */
  checkApiKey: publicProcedure.query(() => {
    return { configured: !!process.env.FAL_API_KEY };
  }),

  /**
   * 列出所有 router-mapped fal modelId 的可用狀態。
   * 前端用來顯示「上游已停用」的灰底卡片，避免使用者按下後等 5 分鐘失敗。
   */
  modelAvailability: publicProcedure.query(() => {
    const ROUTER_MODEL_IDS = [
      // t2v
      "fal-ai/kling-video/v2.1/standard/text-to-video",
      "fal-ai/wan-t2v",
      "fal-ai/minimax/hailuo-02/pro/text-to-video",
      "fal-ai/veo3",
      "fal-ai/veo3/pro",
      "fal-ai/ltx-video-13b-distilled",
      "fal-ai/sora",
      // i2v
      "fal-ai/kling-video/v2.1/standard/image-to-video",
      "fal-ai/kling-video/v2.1/pro/image-to-video",
      "fal-ai/wan-i2v",
      "fal-ai/runway-gen4-turbo/image-to-video",
      "fal-ai/pixverse/v4.5/image-to-video",
      "fal-ai/minimax/hailuo-02/pro/image-to-video",
      "fal-ai/ltx-video/image-to-video",
      // v2v
      "fal-ai/wan/v2.1/video-to-video",
      "fal-ai/kling-video/v2.1/standard/video-to-video",
      // enhance
      "fal-ai/bytedance/upscaler/video",
      "fal-ai/rife-v4.6/video",
      "fal-ai/topaz/video-enhance",
      // control
      "fal-ai/cammaster",
      "fal-ai/animatediff-v2v",
      "fal-ai/depthcrafter",
      "fal-ai/vidu/q1/reference-to-video",
    ] as const;

    const out: Record<
      string,
      {
        disabled: boolean;
        reason?: string;
        label?: string;
        replacement?: string;
        replacementLabel?: string;
      }
    > = {};
    for (const id of ROUTER_MODEL_IDS) {
      const cfg = getFalModelById(id);
      const replacementCfg = cfg?.replacement
        ? getFalModelById(cfg.replacement)
        : undefined;
      out[id] = {
        disabled: !!cfg?.disabled,
        reason: cfg?.disabledReason,
        label: cfg?.label,
        replacement: cfg?.replacement,
        replacementLabel: replacementCfg?.label,
      };
    }
    return out;
  }),

  /**
   * compilePrompt — 把使用者的情緒/積木轉為「相機運動 + 主體 + 動作 + 環境光影」
   * 完整提詞。包裝 server/services/videoCompiler.ts，先前完全未接 tRPC，
   * 現在前端可以直接呼叫並把結果寫回任一 t2v / i2v 模型的 prompt 欄位。
   */
  compilePrompt: brainProcedure
    .input(
      z.object({
        blocks: z
          .array(
            z.object({
              id: z.string().min(1),
              category: z.enum([
                "subject",
                "action",
                "environment",
                "camera",
                "mood",
                "style",
              ]),
              label: z.string().min(1),
              prompt: z.string().min(1),
            })
          )
          .max(20)
          .default([]),
        freePrompt: z.string().max(2500).optional(),
        moodKeywords: z.array(z.string().max(60)).max(10).optional(),
        targetDurationSec: z.number().int().min(3).max(20).optional(),
        forceCameraMode: z
          .enum([
            "static",
            "dolly_in",
            "dolly_out",
            "pan_left",
            "pan_right",
            "tilt_up",
            "tilt_down",
            "orbit",
            "crane_up",
            "crane_down",
            "tracking",
            "handheld",
            "aerial_descent",
            "aerial_ascent",
            "push_in",
            "pull_out",
          ])
          .optional(),
        firstFrameUrl: safeExternalUrlOptional,
        lastFrameUrl: safeExternalUrlOptional,
        firstFrameDesc: z.string().max(500).optional(),
        lastFrameDesc: z.string().max(500).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3"]).optional(),
        slowMotion: z.boolean().optional(),
        styleOverride: z.string().max(80).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const compiler = getVideoCompiler();
      const result = compiler.compile({
        blocks: input.blocks as VideoBlock[],
        freePrompt: input.freePrompt,
        moodKeywords: input.moodKeywords,
        targetDurationSec: input.targetDurationSec,
        forceCameraMode: input.forceCameraMode as CameraModeId | undefined,
        firstFrameUrl: input.firstFrameUrl,
        lastFrameUrl: input.lastFrameUrl,
        firstFrameDesc: input.firstFrameDesc,
        lastFrameDesc: input.lastFrameDesc,
        aspectRatio: input.aspectRatio,
        slowMotion: input.slowMotion,
        styleOverride: input.styleOverride,
      });
      // 對前端只回必要欄位（編譯日誌龐大但對 UI 無用）
      return {
        prompt: result.prompt,
        shotCount: result.shotCount,
        estimatedDurationSec: result.estimatedDurationSec,
        cameraMode: result.cameraMode,
        cameraStabilityScore: result.cameraStabilityScore,
        styleTag: result.styleTag,
        aspectRatio: result.aspectRatio,
        emotionTranslations: result.emotionTranslations,
        jumpBlockCount: result.jumpBlockCount,
      };
    }),

  /** 列出所有支援的相機運動模式（給前端 dropdown 用） */
  listCameraModes: publicProcedure.query(() => {
    return getVideoCompiler().getAvailableCameraModes();
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎬 一、文生影 Text-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Kling v2.1 Text-to-Video（快手 Kling）
   * fal-ai/kling-video/v2.1/standard/text-to-video
   * 業界頂尖中文語意理解，5s/10s，支援 16:9 / 9:16 / 1:1
   */
  klingTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        negativePrompt: z.string().max(1000).optional(),
        duration: z.enum(["5", "10"]).default("5"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        cfgScale: z.number().min(0).max(1).default(0.5),
        /** 動態強度 — 0=靜態畫面, 1=高動態，預設 0.5 均衡 */
        motionIntensity: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        cfg_scale: input.cfgScale,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.motionIntensity !== undefined)
        payload.motion_intensity = input.motionIntensity;

      const resolved = resolveModelOrThrow(
        "fal-ai/kling-video/v2.1/standard/text-to-video"
      );
      const result = (await falQueueRun(resolved.modelId, payload, 300)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  /**
   * Wan v2.1 Text-to-Video（阿里 Wan）
   * fal-ai/wan-t2v
   * 開源最強影片生成，720p 高畫質，多語言提詞
   */
  wanTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        negativePrompt: z.string().max(1000).optional(),
        numFrames: z.number().min(16).max(81).default(81),
        resolution: z.enum(["480p", "720p"]).default("720p"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        enableSafety: z.boolean().default(false),
        /** 隨機種子 — 固定可重現相同生成結果，留空則隨機 */
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/wan-t2v";

      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        num_frames: input.numFrames,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        // AIDV-65：OFF＝維持現行值（input.enableSafety）；ON＝開回 fal safety checker（true）。
        enable_safety_checker: resolveFalSafetyChecker(input.enableSafety),
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled(modelId);
      const result = (await falQueueRun(modelId, payload, 300)) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * MiniMax Hailuo-02 Pro Text-to-Video
   * fal-ai/minimax/hailuo-02/pro/text-to-video
   * MiniMax 旗艦影片模型，電影級動態；6s/10s，1080p/768p，可指定畫面比例與提詞優化
   */
  minimaxTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        promptOptimizer: z.boolean().default(true),
        duration: z.enum(["6", "10"]).default("6"),
        resolution: z.enum(["768p", "1080p"]).default("1080p"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        prompt_optimizer: input.promptOptimizer,
        duration: input.duration,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
      };
      // MiniMax Hailuo-02 Pro 升級版端點（原 video-01 已升級）
      assertModelEnabled("fal-ai/minimax/hailuo-02/pro/text-to-video");
      const result = (await falQueueRun(
        "fal-ai/minimax/hailuo-02/pro/text-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Google Veo 3 Flash Text-to-Video
   * fal-ai/veo3
   * Google 最新旗艦影片模型，8s，唯一原生同步音訊生成；可指定 negative_prompt / seed
   */
  veo3TextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(3000),
        negativePrompt: z.string().max(1000).optional(),
        aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
        generateAudio: z.boolean().default(true),
        /** fal 端會用這個指令幫你補強提詞細節（畫面層次、光影） */
        enhancePrompt: z.boolean().default(true),
        /** 隨機種子 — 固定可重現相同生成結果 */
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        generate_audio: input.generateAudio,
        enhance_prompt: input.enhancePrompt,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/veo3");
      const result = (await falQueueRun("fal-ai/veo3", payload, 480)) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Google Veo 3 Pro Text-to-Video
   * fal-ai/veo3/pro
   * Veo 3 旗艦 Pro 版：更高擬真、更好的色彩還原、原生同步音訊
   * 與 Veo 3 Standard 共用 schema，但定價與 timeout 較高
   */
  veo3ProTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(3000),
        negativePrompt: z.string().max(1000).optional(),
        aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
        generateAudio: z.boolean().default(true),
        enhancePrompt: z.boolean().default(true),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        generate_audio: input.generateAudio,
        enhance_prompt: input.enhancePrompt,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/veo3/pro");
      const result = (await falQueueRun(
        "fal-ai/veo3/pro",
        payload,
        600
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * LTX-Video 13B Text-to-Video
   * fal-ai/ltx-video-13b-distilled
   * Lightricks 開源旗艦，超快速蒸餾版，720p；可指定 seed / guidance_scale / expand_prompt
   */
  ltxTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        negativePrompt: z.string().max(500).optional(),
        // 25 fps × 5 秒 = 125 frames（對齊 modelPricing.ts "每5秒"）
        numFrames: z.number().min(25).max(257).default(125),
        fps: z.number().min(8).max(30).default(25),
        height: z.number().min(256).max(720).default(480),
        width: z.number().min(256).max(1280).default(848),
        guidanceScale: z.number().min(1).max(5).default(3),
        seed: z.number().int().nonnegative().optional(),
        /** fal 端會用這個指令幫你補強提詞細節 */
        expandPrompt: z.boolean().default(true),
        numInferenceSteps: z.number().int().min(4).max(50).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        num_frames: input.numFrames,
        fps: input.fps,
        height: input.height,
        width: input.width,
        guidance_scale: input.guidanceScale,
        expand_prompt: input.expandPrompt,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;
      if (input.numInferenceSteps !== undefined)
        payload.num_inference_steps = input.numInferenceSteps;

      assertModelEnabled("fal-ai/ltx-video-13b-distilled");
      const result = (await falQueueRun(
        "fal-ai/ltx-video-13b-distilled",
        payload,
        240
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Sora Turbo (OpenAI) Text-to-Video
   * fal-ai/sora — 注意：OpenAI Sora 在 fal.ai 的可用性不穩定
   * 此端點如失效將自動降級到 LTX-Video 13B
   */
  soraTextToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        duration: z.number().min(5).max(20).default(10),
        resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
      };
      // Catalog-driven substitution: fal-ai/sora is flagged disabled with
      // replacement → fal-ai/veo3 (same ultra-tier text-to-video; harness
      // round 5 confirmed veo3 works). Veo3 accepts the same prompt /
      // duration / aspect_ratio fields as our payload, so no payload
      // remapping is needed when substitution kicks in. If the user
      // explicitly chose Sora and the catalog isn't substituting (e.g. we
      // someday restore Sora upstream), the original payload still flows.
      const resolved = resolveModelOrThrow("fal-ai/sora");
      const result = (await falQueueRun(resolved.modelId, payload, 480)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🖼️ 二、圖生影 Image-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Kling v2.1 Standard Image-to-Video
   * fal-ai/kling-video/v2.1/standard/image-to-video
   * 最自然的圖片動態化，支援起始幀 + 結束幀；可指定 motion_intensity / aspect_ratio / seed
   */
  klingImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: safeExternalUrl,
        tailImageUrl: safeExternalUrlOptional,
        negativePrompt: z.string().max(1000).optional(),
        duration: z.enum(["5", "10"]).default("5"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        cfgScale: z.number().min(0).max(1).default(0.5),
        /** 動態強度 — 0=靜態畫面, 1=高動態 */
        motionIntensity: z.number().min(0).max(1).optional(),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        cfg_scale: input.cfgScale,
      };
      if (input.tailImageUrl) payload.tail_image_url = input.tailImageUrl;
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.motionIntensity !== undefined)
        payload.motion_intensity = input.motionIntensity;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/kling-video/v2.1/standard/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/standard/image-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Kling v2.1 Pro Image-to-Video
   * fal-ai/kling-video/v2.1/pro/image-to-video
   * Kling Pro 旗艦圖生影：更細膩的動態、更精準的角色一致性；ultra tier
   * 與 Standard 同 schema，但定價較高（Pro pricing 已存在於 modelPricing.ts）
   */
  klingProImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: safeExternalUrl,
        tailImageUrl: safeExternalUrlOptional,
        negativePrompt: z.string().max(1000).optional(),
        duration: z.enum(["5", "10"]).default("5"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        cfgScale: z.number().min(0).max(1).default(0.5),
        motionIntensity: z.number().min(0).max(1).optional(),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        cfg_scale: input.cfgScale,
      };
      if (input.tailImageUrl) payload.tail_image_url = input.tailImageUrl;
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.motionIntensity !== undefined)
        payload.motion_intensity = input.motionIntensity;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/kling-video/v2.1/pro/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/pro/image-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Wan 2.1 Image-to-Video
   * fal-ai/wan-i2v
   * 開源最強圖生影，720p，靈活參數控制
   */
  wanImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: safeExternalUrl,
        negativePrompt: z.string().max(1000).optional(),
        numFrames: z.number().min(16).max(81).default(81),
        resolution: z.enum(["480p", "720p"]).default("720p"),
        /** 隨機種子 — 固定可重現相同動態軌跡，留空則隨機 */
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Wan i2v 正確 endpoint（已驗證 200）
      const modelId = "fal-ai/wan-i2v";

      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        num_frames: input.numFrames,
        resolution: input.resolution,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled(modelId);
      const result = (await falQueueRun(modelId, payload, 300)) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Runway Gen4 Turbo Image-to-Video
   * fal-ai/runway-gen4-turbo/image-to-video
   * Runway Gen4，電影級品質，5s/10s；可指定 ratio 與 seed
   */
  runwayImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: safeExternalUrl,
        duration: z.enum(["5", "10"]).default("5"),
        ratio: z
          .enum([
            "1280:720",
            "720:1280",
            "1104:832",
            "832:1104",
            "960:960",
            "1584:672",
          ])
          .default("1280:720"),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: parseInt(input.duration),
        ratio: input.ratio,
      };
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/runway-gen4-turbo/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/runway-gen4-turbo/image-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * PixVerse v4.5 Image-to-Video
   * fal-ai/pixverse/v4.5/image-to-video
   * PixVerse 旗艦，強大的物理動態，支援特效模板；可指定 aspect_ratio / style / seed
   */
  pixverseImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: safeExternalUrl,
        negativePrompt: z.string().max(500).optional(),
        // fal PixVerse v4.5 接受 "5" / "8"（pre-v4.5 才有 4s）
        duration: z.enum(["5", "8"]).default("5"),
        quality: z.enum(["360p", "540p", "720p", "1080p"]).default("720p"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        motionMode: z.enum(["normal", "fast"]).default("normal"),
        /** PixVerse v4.5 風格：留空為寫實；可選動漫 / 3D / 黏土 / 漫畫 / 賽博龐克 */
        style: z
          .enum(["anime", "3d_animation", "clay", "comic", "cyberpunk"])
          .optional(),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: parseInt(input.duration),
        quality: input.quality,
        aspect_ratio: input.aspectRatio,
        motion_mode: input.motionMode,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.style) payload.style = input.style;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/pixverse/v4.5/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/pixverse/v4.5/image-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * MiniMax Hailuo-02 Pro Image-to-Video
   * fal-ai/minimax/hailuo-02/pro/image-to-video
   * MiniMax 圖生影，超強首幀固定效果；6s/10s，1080p/768p
   */
  minimaxImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: safeExternalUrl,
        promptOptimizer: z.boolean().default(true),
        duration: z.enum(["6", "10"]).default("6"),
        resolution: z.enum(["768p", "1080p"]).default("1080p"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        prompt_optimizer: input.promptOptimizer,
        duration: input.duration,
        resolution: input.resolution,
      };
      // MiniMax Hailuo-02 Pro 升級版端點
      assertModelEnabled("fal-ai/minimax/hailuo-02/pro/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/minimax/hailuo-02/pro/image-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎞️ 三、影生影 Video-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wan Video-to-Video（影片風格化）
   * fal-ai/wan/v2.1/video-to-video
   * 將現有影片依照提詞重新渲染風格；可指定 strength / negative_prompt / seed
   */
  wanVideoToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        videoUrl: safeExternalUrl,
        negativePrompt: z.string().max(1000).optional(),
        strength: z.number().min(0.1).max(1.0).default(0.7),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // DEF-09 修正：正確 WAN V2V endpoint（已驗證 fal-ai/wan/v2.1/video-to-video = 200）
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        video_url: input.videoUrl,
        strength: input.strength,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/wan/v2.1/video-to-video");
      const result = (await falQueueRun(
        "fal-ai/wan/v2.1/video-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * Kling v2.1 Video-to-Video（影片重繪）
   * fal-ai/kling-video/v2.1/standard/video-to-video
   * Kling 高品質影片重繪，保持原始動態；可指定 cfg_scale / negative_prompt / seed
   */
  klingVideoToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        videoUrl: safeExternalUrl,
        negativePrompt: z.string().max(1000).optional(),
        cfgScale: z.number().min(0).max(1).default(0.5),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        video_url: input.videoUrl,
        cfg_scale: input.cfgScale,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/kling-video/v2.1/standard/video-to-video");
      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/standard/video-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * LTX-Video Keyframe-to-Video
   * fal-ai/ltx-video/image-to-video
   * 以圖片為關鍵幀生成流暢影片動態
   */
  ltxImageToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: safeExternalUrl,
        negativePrompt: z.string().max(500).optional(),
        // 25 fps × 5 秒 = 125 frames（對齊 modelPricing.ts "每5秒"）
        numFrames: z.number().min(25).max(257).default(125),
        fps: z.number().min(8).max(30).default(25),
        guidanceScale: z.number().min(1).max(5).default(3),
        seed: z.number().int().nonnegative().optional(),
        expandPrompt: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        num_frames: input.numFrames,
        fps: input.fps,
        guidance_scale: input.guidanceScale,
        expand_prompt: input.expandPrompt,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      assertModelEnabled("fal-ai/ltx-video/image-to-video");
      const result = (await falQueueRun(
        "fal-ai/ltx-video/image-to-video",
        payload,
        240
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ✨ 四、影像畫質優化 Upscale / Enhancement
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ByteDance Video Upscaler (2x/4x)
   * fal-ai/bytedance/upscaler/video
   * 業界頂尖影片超分辨率，2x 或 4x 放大；premium 層級，計價依影片時長
   */
  videoUpscale: brainProcedure
    .input(
      z.object({
        videoUrl: safeExternalUrl,
        upscaleFactor: z.enum(["2", "4"]).default("2"),
      })
    )
    .mutation(async ({ input }) => {
      // Catalog substitution: bytedance/upscaler/video → wan/v2.1/video-to-video.
      // Wan v2v has a different schema (needs prompt + strength), so we remap
      // the upscaler intent into a v2v "enhance details" pass that preserves
      // the user's video and yields a working artefact.
      const resolved = resolveModelOrThrow("fal-ai/bytedance/upscaler/video");
      const payload: Record<string, unknown> = resolved.substituted
        ? {
            prompt: `enhance and upscale, sharper details, ${input.upscaleFactor}x quality, photorealistic`,
            video_url: input.videoUrl,
            strength: 0.35,
          }
        : {
            video_url: input.videoUrl,
            upscale_factor: parseInt(input.upscaleFactor),
          };
      const result = (await falQueueRun(resolved.modelId, payload, 300)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  /**
   * Video Frame Interpolation（補幀）
   * fal-ai/rife-v4.6/video
   * RIFE v4.6 高品質補幀，2x/4x 幀率提升；可指定目標 fps（24-120），standard 層級
   */
  frameInterpolation: brainProcedure
    .input(
      z.object({
        videoUrl: safeExternalUrl,
        multiplier: z.enum(["2", "4"]).default("2"),
        outputFps: z.number().min(24).max(120).default(60),
      })
    )
    .mutation(async ({ input }) => {
      // Catalog substitution: rife-v4.6/video → wan/v2.1/video-to-video.
      // Wan v2v doesn't do true frame interpolation (RIFE generates synthetic
      // intermediate frames), but a low-strength v2v pass preserves the
      // source motion and renders a smoothed result. The user gets a video
      // artefact instead of a thrown error; UI surfaces the substitution.
      const resolved = resolveModelOrThrow("fal-ai/rife-v4.6/video");
      const payload: Record<string, unknown> = resolved.substituted
        ? {
            prompt: `smooth motion at ${input.outputFps}fps, fluid frame transitions, ${input.multiplier}x interpolated`,
            video_url: input.videoUrl,
            strength: 0.25,
          }
        : {
            video_url: input.videoUrl,
            multiplier: parseInt(input.multiplier),
            output_fps: input.outputFps,
          };
      const result = (await falQueueRun(resolved.modelId, payload, 240)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  /**
   * Topaz Video Enhance AI
   * fal-ai/topaz/video-enhance
   * Topaz Labs 專業影片降噪 + 超解析；ultra 層級，計價依影片時長
   * 內建模型：iris（人臉）/ artemis（一般）/ theia（細節）/ gaia（高解析）/ nyx（低光降噪）
   */
  topazEnhance: brainProcedure
    .input(
      z.object({
        videoUrl: safeExternalUrl,
        model: z
          .enum(["iris", "artemis", "theia", "gaia", "nyx"])
          .default("iris"),
        outputScale: z.number().min(1).max(4).default(2),
      })
    )
    .mutation(async ({ input }) => {
      // Catalog substitution: topaz/video-enhance → wan/v2.1/video-to-video.
      // We translate Topaz's denoise/enhance model presets into a v2v prompt
      // (iris=face, artemis=general, theia=detail, gaia=hi-res, nyx=low-light)
      // so the rendered video carries the user's enhancement intent.
      const TOPAZ_PROMPT_BY_MODEL: Record<string, string> = {
        iris: "enhance facial details, smooth skin, sharper eyes, photorealistic portrait",
        artemis: "general enhancement, denoise, sharper details, balanced quality",
        theia: "preserve fine details, sharper edges, enhanced texture",
        gaia: "high-resolution enhancement, crisp details, professional grade",
        nyx: "denoise low-light footage, clean shadows, preserve dark detail",
      };
      const resolved = resolveModelOrThrow("fal-ai/topaz/video-enhance");
      const payload: Record<string, unknown> = resolved.substituted
        ? {
            prompt: `${TOPAZ_PROMPT_BY_MODEL[input.model] ?? TOPAZ_PROMPT_BY_MODEL.artemis}, ${input.outputScale}x quality`,
            video_url: input.videoUrl,
            strength: 0.3,
          }
        : {
            video_url: input.videoUrl,
            model: input.model,
            output_scale: input.outputScale,
          };
      const result = (await falQueueRun(resolved.modelId, payload, 600)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎛️ 五、進階精緻控制 Advanced Control
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CamMaster Camera Control
   * fal-ai/cammaster
   * 精確鏡頭運動控制（17 種運鏡：靜止、推拉、上下移、左右搖、上下俯仰、
   * 順逆時針旋轉、水平/垂直環繞、升降鏡），基於圖生影；premium 層級
   */
  camMaster: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: safeExternalUrl,
        cameraMotion: z
          .enum([
            "static",
            "move_left",
            "move_right",
            "move_up",
            "move_down",
            "push_in",
            "pull_out",
            "pan_left",
            "pan_right",
            "tilt_up",
            "tilt_down",
            "roll_clockwise",
            "roll_counterclockwise",
            "orbit_left",
            "orbit_right",
            "crane_up",
            "crane_down",
          ])
          .default("push_in"),
        duration: z.number().min(3).max(10).default(5),
      })
    )
    .mutation(async ({ input }) => {
      // Catalog substitution: cammaster → kling-video/v2.1/pro/image-to-video.
      // Kling pro i2v doesn't have a `camera_motion` field, so we append the
      // selected motion to the prompt in natural language; kling's prompt
      // interpreter is strong enough to follow these cues.
      const CAM_DESCRIPTIONS: Record<string, string> = {
        static: "static camera, fixed shot",
        move_left: "camera slowly moves left, lateral tracking shot",
        move_right: "camera slowly moves right, lateral tracking shot",
        move_up: "camera rises smoothly, upward dolly",
        move_down: "camera descends smoothly, downward dolly",
        push_in: "camera pushes in toward subject, dolly-in",
        pull_out: "camera pulls back from subject, dolly-out",
        pan_left: "camera pans left horizontally",
        pan_right: "camera pans right horizontally",
        tilt_up: "camera tilts upward",
        tilt_down: "camera tilts downward",
        roll_clockwise: "camera rolls clockwise",
        roll_counterclockwise: "camera rolls counter-clockwise",
        orbit_left: "camera orbits the subject from the left, circular arc",
        orbit_right: "camera orbits the subject from the right, circular arc",
        crane_up: "crane shot rising upward, elevated view",
        crane_down: "crane shot descending, lowering view",
      };
      const resolved = resolveModelOrThrow("fal-ai/cammaster");
      const payload: Record<string, unknown> = resolved.substituted
        ? {
            prompt: `${input.prompt}. Camera motion: ${CAM_DESCRIPTIONS[input.cameraMotion] ?? input.cameraMotion}.`,
            image_url: input.imageUrl,
            duration: String(input.duration),
            aspect_ratio: "16:9",
            cfg_scale: 0.5,
          }
        : {
            prompt: input.prompt,
            image_url: input.imageUrl,
            camera_motion: input.cameraMotion,
            duration: input.duration,
          };
      const result = (await falQueueRun(resolved.modelId, payload, 300)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  /**
   * AnimateDiff + ControlNet（逐幀姿勢/邊緣/深度控制）
   * fal-ai/animatediff-v2v
   * 基於骨架姿勢 / Canny 邊緣 / Depth 深度精確控制影片動作；standard 層級
   */
  animateDiff: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        negativePrompt: z.string().max(500).optional(),
        videoUrl: safeExternalUrl,
        controlNet: z
          .enum(["openpose", "canny", "depth", "none"])
          .default("openpose"),
        /** ControlNet 條件強度 — 0=完全不參考原片, 1=完全鎖死原片骨架/邊緣 */
        controlnetScale: z.number().min(0).max(2).default(1.0),
        guidanceScale: z.number().min(1).max(20).default(7.5),
        numSteps: z.number().min(10).max(50).default(25),
        seed: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        video_url: input.videoUrl,
        controlnet_conditioning_scale: input.controlnetScale,
        guidance_scale: input.guidanceScale,
        num_inference_steps: input.numSteps,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      // controlnet mode
      if (input.controlNet !== "none") {
        payload.controlnet_type = input.controlNet;
      }

      assertModelEnabled("fal-ai/animatediff-v2v");
      const result = (await falQueueRun(
        "fal-ai/animatediff-v2v",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * DepthCrafter（深度感知影片生成）
   * fal-ai/depthcrafter
   * 從單目影片重建深度時序（depth time-series），用於 3D 視差效果或 ControlNet 深度條件；
   * 進階參數：num_denoising_steps（去噪步數，越高越精細）、guidance_scale、
   * window_size（時序視窗）、overlap（視窗重疊）、max_res（最大邊長）
   */
  depthCrafter: brainProcedure
    .input(
      z.object({
        videoUrl: safeExternalUrl,
        numDenoising: z.number().min(1).max(25).default(25),
        guidance: z.number().min(1).max(20).default(1.0),
        windowSize: z.number().min(4).max(110).default(110),
        overlap: z.number().min(1).max(25).default(25),
        maxRes: z.number().min(256).max(2048).default(1024),
      })
    )
    .mutation(async ({ input }) => {
      // Catalog substitution: depthcrafter → animatediff-v2v.
      // AnimateDiff supports a depth ControlNet which approximates the
      // "depth-aware video" intent of DepthCrafter without producing an
      // explicit depth time-series. We carry guidance_scale through and
      // map num_denoising_steps → num_inference_steps (analogous).
      const resolved = resolveModelOrThrow("fal-ai/depthcrafter");
      const payload: Record<string, unknown> = resolved.substituted
        ? {
            prompt:
              "depth-aware rendering, preserve spatial depth, accurate parallax, photorealistic",
            video_url: input.videoUrl,
            controlnet_type: "depth",
            controlnet_conditioning_scale: 1.0,
            guidance_scale: input.guidance,
            num_inference_steps: Math.min(50, Math.max(10, input.numDenoising)),
          }
        : {
            video_url: input.videoUrl,
            num_denoising_steps: input.numDenoising,
            guidance_scale: input.guidance,
            window_size: input.windowSize,
            overlap: input.overlap,
            max_res: input.maxRes,
          };
      const result = (await falQueueRun(resolved.modelId, payload, 300)) as any;
      return withSubstitutionMeta(
        {
          video_url: extractVideoUrl(result),
          request_id: result?.request_id ?? null,
          raw: result,
        },
        resolved
      );
    }),

  /**
   * Vidu Q1 Reference-to-Video（角色一致性）
   * fal-ai/vidu/q1/reference-to-video
   * 保持角色外觀一致性，最多 3 參考圖
   */
  viduReferenceToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrls: z.array(safeExternalUrl).min(1).max(3),
        duration: z.enum(["4", "8"]).default("4"),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
        resolution: z.enum(["720p", "1080p"]).default("720p"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_urls: input.imageUrls,
        duration: parseInt(input.duration),
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
      };
      assertModelEnabled("fal-ai/vidu/q1/reference-to-video");
      const result = (await falQueueRun(
        "fal-ai/vidu/q1/reference-to-video",
        payload,
        300
      )) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  // ─── 非同步任務狀態查詢（共用） ─────────────────────────────────────────────

  /**
   * 查詢非同步 queue 任務的當前狀態
   * 前端可用 request_id 輪詢進度
   */
  jobStatus: brainProcedure
    .input(
      z.object({
        requestId: z.string(),
        modelId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const status = (await falQueueStatus(
        input.requestId,
        input.modelId
      )) as any;
      return {
        status: status?.status ?? status?.state ?? "UNKNOWN",
        progress: status?.progress ?? null,
        logs: status?.logs ?? [],
      };
    }),

  /**
   * checkVideoStatus — 前端輪詢 API（每 3 秒呼叫一次）
   * 若已完成則回傳影片 URL，若失敗則丟出錯誤
   */
  checkVideoStatus: brainProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        modelId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const status = (await falQueueStatus(
        input.requestId,
        input.modelId
      )) as any;
      const s = status?.status ?? status?.state;

      if (s === "COMPLETED") {
        const result = (await falQueueResult(
          input.requestId,
          input.modelId
        )) as any;
        // 持久化到 S3，防止 fal.ai CDN URL 過期；遞迴本地化整個 result 樹。
        // 統一前綴：generated/studio/<userId>/video/<modelId>。
        const localized = (await localizeResultUrls(
          result,
          unifiedAssetPrefix({
            userId: ctx.user.id,
            source: "video",
            modelId: input.modelId,
          })
        )) as any;
        const video_url = extractVideoUrl(localized);

        // 統一儲存管線：寫入提示詞庫 + 資產庫 + 歷史 + AI 監控室。
        // checkVideoStatus 過去只回 URL，使用者影片永遠不進「我的資產」。
        // 同一個 requestId 會被輪詢多次，所以用 dedupeMarker 防重複插入。
        if (video_url) {
          const dedupeMarker = `[videoStudio:${input.modelId}:${input.requestId}]`;
          const promptText =
            typeof localized?.prompt === "string"
              ? localized.prompt
              : undefined;
          void doPostGenComplete({
            userId: ctx.user.id,
            modality: "video",
            modelId: input.modelId,
            prompt: promptText,
            resultUrl: video_url,
            label: `Video Studio - ${input.modelId}`.slice(0, 100),
            sourceStudio: "video",
            dedupeMarker,
            parameterSnapshot: {
              sourceStudio: "video",
              modelId: input.modelId,
              requestId: input.requestId,
            },
          });
        }

        return {
          status: "COMPLETED" as const,
          video_url,
          raw: localized,
        };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        // 連動：記錄到錯誤線索系統 → 自動觸發爬網搜尋 → 建立修復提案
        recordErrorTrace({
          userId: ctx.user?.id ?? 0,
          modality: "video",
          engine: input.modelId,
          prompt: `[非同步任務失敗] requestId=${input.requestId}`,
          errorMessage: errMsg,
          errorCode: "FAL_TASK_FAILED",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `影片任務失敗 [${input.modelId}]: ${errMsg}`,
        });
      }

      return { status: "IN_PROGRESS" as const, video_url: null, raw: null };
    }),
});
