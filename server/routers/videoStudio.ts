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
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { recordErrorTrace } from "../services/brainAutoRepair";

// ─── fal.ai 呼叫工具（與 proStudio 相同模式） ────────────────────────────────

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RUN_BASE = "https://fal.run";

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

/** 使用 queue 非同步提交任務，立即回傳 request_id */
async function falQueueSubmit(
  modelId: string,
  input: Record<string, unknown>,
  jobId?: number
): Promise<{ request_id: string }> {
  const key = getFalKey();
  // 若設定了 VITE_SITE_URL 且有 jobId，加入 webhook 回呼讓後端持久化結果
  const siteUrl = process.env.VITE_SITE_URL?.trim();
  const webhookUrl =
    siteUrl && jobId
      ? `${siteUrl}/api/webhook/fal`
      : undefined;
  const body: Record<string, unknown> = { ...input };
  if (webhookUrl) body._webhookUrl = webhookUrl;
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}${webhookUrl ? `?fal_webhook=${encodeURIComponent(webhookUrl)}` : ""}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.text();
    recordErrorTrace({
      userId: 0,
      modality: "video",
      engine: modelId,
      prompt: "[falQueueSubmit]",
      errorMessage: err.slice(0, 500),
      errorCode: "FAL_SUBMIT_ERROR",
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `fal.ai submit 錯誤 [${modelId}]: ${err}`,
    });
  }
  return res.json();
}

async function falQueueStatus(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(
    `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`,
    {
      headers: { Authorization: `Key ${key}` },
    }
  );
  if (!res.ok)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "查詢狀態失敗",
    });
  return res.json();
}

async function falQueueResult(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(
    `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`,
    {
      headers: { Authorization: `Key ${key}` },
    }
  );
  if (!res.ok)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "取得結果失敗",
    });
  return res.json();
}

async function falRun(
  modelId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.text();
    recordErrorTrace({
      userId: 0,
      modality: "video",
      engine: modelId,
      prompt: "[falRun]",
      errorMessage: err.slice(0, 500),
      errorCode: "FAL_RUN_ERROR",
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `fal.ai 錯誤 [${modelId}]: ${err}`,
    });
  }
  return res.json();
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

// ─── Router ──────────────────────────────────────────────────────────────────

export const videoStudioRouter = router({
  /** FAL_API_KEY 是否設定（前端用來顯示提示） */
  checkApiKey: publicProcedure.query(() => {
    return { configured: !!process.env.FAL_API_KEY };
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎬 一、文生影 Text-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Kling v2.1 Text-to-Video（快手 Kling）
   * fal-ai/kling-video/v2.1/standard/text-to-video
   * 業界頂尖中文語意理解，5s/10s，支援 16:9 / 9:16 / 1:1
   */
  klingTextToVideo: protectedProcedure
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

      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/standard/text-to-video",
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
   * Wan v2.1 Text-to-Video（阿里 Wan）
   * fal-ai/wan-ai/wan2.1-t2v-720p
   * 開源最強影片生成，720p 高畫質，多語言提詞
   */
  wanTextToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        negativePrompt: z.string().max(1000).optional(),
        numFrames: z.number().min(16).max(81).default(81),
        resolution: z.enum(["480p", "720p"]).default("720p"),
        enableSafety: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/wan-ai/wan2.1-t2v-720p";

      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        num_frames: input.numFrames,
        enable_safety_checker: input.enableSafety,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;

      const result = (await falQueueRun(modelId, payload, 300)) as any;
      return {
        video_url: extractVideoUrl(result),
        request_id: result?.request_id ?? null,
        raw: result,
      };
    }),

  /**
   * MiniMax Hailuo-02 Text-to-Video
   * fal-ai/minimax/video-01
   * MiniMax 旗艦影片模型，電影級動態，6s
   */
  minimaxTextToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        promptOptimizer: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        prompt_optimizer: input.promptOptimizer,
      };
      // MiniMax Hailuo-02 升級版端點（原 video-01 已升級）
      const result = (await falQueueRun(
        "fal-ai/minimax/hailuo-02/pro/text-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Google Veo 3 Flash Text-to-Video
   * fal-ai/veo3
   * Google 最新旗艦影片模型，8s，具備原生音頻生成
   */
  veo3TextToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(3000),
        aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
        generateAudio: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        generate_audio: input.generateAudio,
      };
      const result = (await falQueueRun("fal-ai/veo3", payload, 480)) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * LTX-Video 13B Text-to-Video
   * fal-ai/ltx-video-13b-distilled
   * Lightricks 開源旗艦，超快速蒸餾版，720p
   */
  ltxTextToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        negativePrompt: z.string().max(500).optional(),
        numFrames: z.number().min(25).max(257).default(121),
        fps: z.number().min(8).max(30).default(25),
        height: z.number().min(256).max(720).default(480),
        width: z.number().min(256).max(1280).default(848),
        guidanceScale: z.number().min(1).max(5).default(3),
        seed: z.number().optional(),
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
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      const result = (await falQueueRun(
        "fal-ai/ltx-video-13b-distilled",
        payload,
        240
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Sora Turbo (OpenAI) Text-to-Video
   * fal-ai/sora — 注意：OpenAI Sora 在 fal.ai 的可用性不穩定
   * 此端點如失效將自動降級到 LTX-Video 13B
   */
  soraTextToVideo: protectedProcedure
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
      // 嘗試 Sora 端點如失效則降級到 LTX-Video
      try {
        const result = (await falQueueRun("fal-ai/sora", payload, 480)) as any;
        return { video_url: extractVideoUrl(result), raw: result };
      } catch (e: any) {
        if (e?.message?.includes("404") || e?.message?.includes("not found")) {
          // Sora 端點不可用，降級到 LTX-Video-13B
          const fallbackPayload: Record<string, unknown> = {
            prompt: input.prompt,
            num_frames: 121,
            fps: 25,
            height: 480,
            width: 848,
          };
          const result = (await falQueueRun(
            "fal-ai/ltx-video-13b-distilled",
            fallbackPayload,
            300
          )) as any;
          return {
            video_url: extractVideoUrl(result),
            raw: result,
            degraded: true,
          };
        }
        throw e;
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🖼️ 二、圖生影 Image-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Kling v2.1 Image-to-Video
   * fal-ai/kling-video/v2.1/standard/image-to-video
   * 最自然的圖片動態化，支援起始幀 + 結束幀
   */
  klingImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: z.string().url(),
        tailImageUrl: z.string().url().optional(),
        negativePrompt: z.string().max(1000).optional(),
        duration: z.enum(["5", "10"]).default("5"),
        cfgScale: z.number().min(0).max(1).default(0.5),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: input.duration,
        cfg_scale: input.cfgScale,
      };
      if (input.tailImageUrl) payload.tail_image_url = input.tailImageUrl;
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;

      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/standard/image-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Wan 2.1 Image-to-Video
   * fal-ai/wan-ai/wan2.1-i2v-720p
   * 開源最強圖生影，720p，靈活參數控制
   */
  wanImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: z.string().url(),
        numFrames: z.number().min(16).max(81).default(81),
        resolution: z.enum(["480p", "720p"]).default("720p"),
      })
    )
    .mutation(async ({ input }) => {
      // Wan i2v 正確 endpoint
      const modelId = "fal-ai/wan-ai/wan2.1-i2v-720p";

      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        num_frames: input.numFrames,
      };
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
   * Runway Gen4，電影級品質，5s/10s
   */
  runwayImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url(),
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
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: parseInt(input.duration),
        ratio: input.ratio,
      };
      const result = (await falQueueRun(
        "fal-ai/runway-gen4-turbo/image-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * PixVerse v4.5 Image-to-Video
   * fal-ai/pixverse/v4.5/image-to-video
   * PixVerse 旗艦，強大的物理動態，支援特效模板
   */
  pixverseImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url(),
        negativePrompt: z.string().max(500).optional(),
        duration: z.enum(["4", "8"]).default("4"),
        quality: z.enum(["360p", "540p", "720p", "1080p"]).default("720p"),
        motionMode: z.enum(["normal", "fast"]).default("normal"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        duration: parseInt(input.duration),
        quality: input.quality,
        motion_mode: input.motionMode,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;

      const result = (await falQueueRun(
        "fal-ai/pixverse/v4.5/image-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * MiniMax Hailuo-02 Image-to-Video
   * fal-ai/minimax/video-01/image-to-video
   * MiniMax 圖生影，超強首幀固定效果
   */
  minimaxImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url(),
        promptOptimizer: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        prompt_optimizer: input.promptOptimizer,
      };
      // MiniMax Hailuo-02 升級版端點
      const result = (await falQueueRun(
        "fal-ai/minimax/hailuo-02/pro/image-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎞️ 三、影生影 Video-to-Video
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wan Video-to-Video（影片風格化）
   * fal-ai/wan-ai/wan2.1-v2v-480p
   * 將現有影片依照提詞重新渲染風格
   */
  wanVideoToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        videoUrl: z.string().url(),
        strength: z.number().min(0.1).max(1.0).default(0.7),
      })
    )
    .mutation(async ({ input }) => {
      // DEF-09 修正：改用正確的影生影端點（wan-t2v 是文生影，不接受 video_url）
      const result = (await falQueueRun(
        "fal-ai/wan-ai/wan2.1-v2v-480p",
        {
          prompt: input.prompt,
          video_url: input.videoUrl,
          strength: input.strength,
        },
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Kling v2.1 Video-to-Video（影片重繪）
   * fal-ai/kling-video/v2.1/standard/video-to-video
   * Kling 高品質影片重繪，保持原始動態
   */
  klingVideoToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2500),
        videoUrl: z.string().url(),
        cfgScale: z.number().min(0).max(1).default(0.5),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        video_url: input.videoUrl,
        cfg_scale: input.cfgScale,
      };
      const result = (await falQueueRun(
        "fal-ai/kling-video/v2.1/standard/video-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * LTX-Video Keyframe-to-Video
   * fal-ai/ltx-video/image-to-video
   * 以圖片為關鍵幀生成流暢影片動態
   */
  ltxImageToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url(),
        negativePrompt: z.string().max(500).optional(),
        numFrames: z.number().min(25).max(257).default(121),
        fps: z.number().min(8).max(30).default(25),
        guidanceScale: z.number().min(1).max(5).default(3),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        num_frames: input.numFrames,
        fps: input.fps,
        guidance_scale: input.guidanceScale,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      const result = (await falQueueRun(
        "fal-ai/ltx-video/image-to-video",
        payload,
        240
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ✨ 四、影像畫質優化 Upscale / Enhancement
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ByteDance Video Upscaler (2x/4x)
   * fal-ai/bytedance/upscaler/video
   * 業界頂尖影片超分辨率，2x 或 4x 放大
   */
  videoUpscale: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        upscaleFactor: z.enum(["2", "4"]).default("2"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        video_url: input.videoUrl,
        upscale_factor: parseInt(input.upscaleFactor),
      };
      const result = (await falQueueRun(
        "fal-ai/bytedance/upscaler/video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Video Frame Interpolation（補幀）
   * fal-ai/rife-v4.6/video
   * RIFE v4.6 高品質補幀，2x/4x 幀率提升
   */
  frameInterpolation: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        multiplier: z.enum(["2", "4"]).default("2"),
        outputFps: z.number().min(24).max(120).default(60),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        video_url: input.videoUrl,
        multiplier: parseInt(input.multiplier),
        output_fps: input.outputFps,
      };
      const result = (await falQueueRun(
        "fal-ai/rife-v4.6/video",
        payload,
        240
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Topaz Video Enhance AI
   * fal-ai/topaz/video-enhance
   * Topaz Labs 專業影片降噪 + 超解析
   */
  topazEnhance: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        model: z
          .enum(["iris", "artemis", "theia", "gaia", "nyx"])
          .default("iris"),
        outputScale: z.number().min(1).max(4).default(2),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        video_url: input.videoUrl,
        model: input.model,
        output_scale: input.outputScale,
      };
      const result = (await falQueueRun(
        "fal-ai/topaz/video-enhance",
        payload,
        600
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎛️ 五、進階精緻控制 Advanced Control
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CamMaster Camera Control
   * fal-ai/cammaster
   * 精確鏡頭運動控制（推拉搖移旋轉），基於圖生影
   */
  camMaster: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url(),
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
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.imageUrl,
        camera_motion: input.cameraMotion,
        duration: input.duration,
      };
      const result = (await falQueueRun(
        "fal-ai/cammaster",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * AnimateDiff + ControlNet（逐幀姿勢控制）
   * fal-ai/animatediff-v2v
   * 基於骨架姿勢 / Canny 邊緣精確控制影片動作
   */
  animateDiff: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        negativePrompt: z.string().max(500).optional(),
        videoUrl: z.string().url(),
        controlNet: z
          .enum(["openpose", "canny", "depth", "none"])
          .default("openpose"),
        guidanceScale: z.number().min(1).max(20).default(7.5),
        numSteps: z.number().min(10).max(50).default(25),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        video_url: input.videoUrl,
        controlnet_conditioning_scale: 1.0,
        guidance_scale: input.guidanceScale,
        num_inference_steps: input.numSteps,
      };
      if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
      if (input.seed !== undefined) payload.seed = input.seed;

      // controlnet mode
      if (input.controlNet !== "none") {
        payload.controlnet_type = input.controlNet;
      }

      const result = (await falQueueRun(
        "fal-ai/animatediff-v2v",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * DepthCrafter（深度感知影片生成）
   * fal-ai/depthcrafter
   * 從單目影片重建深度時序，用於 3D 視差效果
   */
  depthCrafter: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        numDenoising: z.number().min(1).max(25).default(25),
        guidance: z.number().min(1).max(20).default(1.0),
        windowSize: z.number().min(4).max(110).default(110),
        overlap: z.number().min(1).max(25).default(25),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        video_url: input.videoUrl,
        num_denoising_steps: input.numDenoising,
        guidance_scale: input.guidance,
        window_size: input.windowSize,
        overlap: input.overlap,
        max_res: 1024,
      };
      const result = (await falQueueRun(
        "fal-ai/depthcrafter",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  /**
   * Vidu Q1 Reference-to-Video（角色一致性）
   * fal-ai/vidu/q1/reference-to-video
   * 保持角色外觀一致性，最多 3 參考圖
   */
  viduReferenceToVideo: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        imageUrls: z.array(z.string().url()).min(1).max(3),
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
      const result = (await falQueueRun(
        "fal-ai/vidu/q1/reference-to-video",
        payload,
        300
      )) as any;
      return { video_url: extractVideoUrl(result), raw: result };
    }),

  // ─── 非同步任務狀態查詢（共用） ─────────────────────────────────────────────

  /**
   * 查詢非同步 queue 任務的當前狀態
   * 前端可用 request_id 輪詢進度
   */
  jobStatus: protectedProcedure
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
  checkVideoStatus: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        modelId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
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
        return {
          status: "COMPLETED" as const,
          video_url: extractVideoUrl(result),
          raw: result,
        };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        // 連動：記錄到錯誤線索系統 → 自動觸發爬網搜尋 → 建立修復提案
        recordErrorTrace({
          userId: 0,
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
