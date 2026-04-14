/**
 * imageStudio.ts — 專業圖片創作室 Router
 *
 * ── 文字生圖（Text-to-Image）──
 *  1. fal-ai/nano-banana-2            Gemini 3.1 Flash Image
 *  2. fal-ai/nano-banana-pro          Gemini 3 Pro Image
 *  3. fal-ai/bytedance/seedream/v4/text-to-image  SeeDream v4
 *  4. fal-ai/imagen4/preview          Google Imagen 4 Preview
 *
 * ── 圖片編輯（Image Edit）──
 *  5. fal-ai/nano-banana-pro/edit     Gemini 3 Pro 編輯
 *  6. fal-ai/nano-banana/edit         Gemini 2.0 Flash 編輯
 *  7. fal-ai/nano-banana-2/edit       Gemini 3.1 Flash 編輯（NEW）
 *  8. fal-ai/bytedance/seedream/v4.5/edit  SeeDream v4.5 編輯
 *  9. fal-ai/bytedance/seedream/v5/lite/edit  SeeDream v5 Lite 編輯
 * 10. xai/grok-imagine-image/edit     xAI Grok 圖片編輯
 * 11. fal-ai/gpt-image-1.5/edit      GPT Image 1.5 編輯
 * 12. fal-ai/flux-pro/kontext        FLUX.1 Kontext Pro
 * 13. fal-ai/flux-2-pro/edit         FLUX 2 Pro 編輯（NEW）
 *
 * ── 影像放大（Upscale）──
 * 14. fal-ai/seedvr/upscale/image    SeedVR 影像放大（NEW）
 *
 * ── 骨骼姿勢偵測（Pose Detection）──
 * 15. fal-ai/dwpose                  DWPose 骨骼姿勢偵測（NEW）
 *
 * ── Stable Diffusion 系列（NEW）──
 * 16. fal-ai/stable-diffusion-v35-large   SD 3.5 Large + ControlNet + LoRA
 * 17. fal-ai/fast-sdxl                    SDXL 快速生圖
 * 18. fal-ai/lora                         SD + LoRA 生圖
 *
 * ── 圖片轉 3D（Image-to-3D）──
 * 19. fal-ai/trellis-2               Trellis 2 圖片生成 3D GLB（NEW）
 * 20. fal-ai/sam-3/3d-objects        SAM 3D 物件重建（NEW）
 * 21. fal-ai/hunyuan3d-v3/image-to-3d  混元 3D v3 電影級 3D（NEW）
 * 22. fal-ai/hyper3d/rodin           Rodin 文字/圖片生成 3D（NEW）
 * 23. fal-ai/hunyuan_world/image-to-world  混元 World 圖片轉世界（NEW）
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ─── fal.ai 呼叫工具（與 proStudio 相同架構）──────────────────────────────────

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RUN_BASE   = "https://fal.run";

function getFalKey(): string {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定，請在 Railway → Environment Variables 中新增" });
  return key;
}

async function falQueueSubmit(modelId: string, input: Record<string, unknown>): Promise<{ request_id: string }> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai submit 錯誤 [${modelId}]: ${err}` });
  }
  return res.json();
}

async function falQueueStatus(requestId: string, modelId: string): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`, {
    headers: { "Authorization": `Key ${key}` },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "查詢狀態失敗" });
  return res.json();
}

async function falQueueResult(requestId: string, modelId: string): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`, {
    headers: { "Authorization": `Key ${key}` },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "取得結果失敗" });
  return res.json();
}

async function falRun(modelId: string, input: Record<string, unknown>, timeoutMs = 120_000): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai 錯誤 [${modelId}]: ${err}` });
  }
  return res.json();
}

async function falQueueRun(modelId: string, input: Record<string, unknown>, waitSec = 180): Promise<unknown> {
  const { request_id } = await falQueueSubmit(modelId, input);
  // 直接回傳 request_id，不在後端等待（防止 504 Timeout）
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}

/** 統一解析 fal.ai 圖片回應，回傳第一張圖片 URL */
function extractImageUrl(raw: any): string | null {
  // 各模型回傳格式不一，嘗試多種路徑
  const img =
    raw?.images?.[0]?.url ||
    raw?.image?.url ||
    raw?.image_url ||
    raw?.data?.images?.[0]?.url ||
    raw?.data?.image?.url ||
    raw?.output?.images?.[0]?.url ||
    null;
  return img;
}

function extractAllImageUrls(raw: any): string[] {
  const imgs = raw?.images || raw?.data?.images || raw?.output?.images || [];
  return Array.isArray(imgs) ? imgs.map((i: any) => i?.url).filter(Boolean) : [];
}

// ─── 共用 Input Schema ──────────────────────────────────────────────────────

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:1", "1:4", "21:9", "auto"] as const;
const IMAGE_SIZES   = ["square", "square_hd", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"] as const;

// ─── Router ──────────────────────────────────────────────────────────────────

export const imageStudioRouter = router({

  /** 確認 FAL_API_KEY 是否設定 */
  checkApiKey: publicProcedure.query(() => ({ configured: !!process.env.FAL_API_KEY })),

  // ═══════════════════════════════════════════════════════════════
  // 📸 文字生圖（Text-to-Image）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 1. fal-ai/nano-banana-2 — Gemini 3.1 Flash Image
   *    文字生圖，支援文字渲染、複雜場景構圖、視覺推理
   *    支援 aspect_ratio: auto | 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 4:1 | 1:4 | 8:1 | 1:8
   *    支援 image_urls[] 多圖參考（最多 14 張）
   */
  nanoBanana2: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(4000),
      aspect_ratio: z.enum(ASPECT_RATIOS).optional().default("auto"),
      image_urls:   z.array(z.string().url()).max(14).optional(),
      num_images:   z.number().min(1).max(4).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:       input.prompt,
        aspect_ratio: input.aspect_ratio,
        num_images:   input.num_images,
      };
      if (input.image_urls?.length) payload.image_urls = input.image_urls;

      const raw = await falQueueRun("fal-ai/nano-banana-2", payload, 120) as any;
      return {
        image_url:  extractImageUrl(raw),
        images:     extractAllImageUrls(raw),
        seed:       raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 2. fal-ai/nano-banana-pro — Gemini 3 Pro Image（最高品質）
   *    支援文字生圖 + 多圖參考（最多 14 張）
   */
  nanoBananaPro: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(4000),
      aspect_ratio: z.enum(ASPECT_RATIOS).optional().default("auto"),
      image_urls:   z.array(z.string().url()).max(14).optional(),
      num_images:   z.number().min(1).max(4).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:       input.prompt,
        aspect_ratio: input.aspect_ratio,
        num_images:   input.num_images,
      };
      if (input.image_urls?.length) payload.image_urls = input.image_urls;

      const raw = await falQueueRun("fal-ai/nano-banana-pro", payload, 180) as any;
      return {
        image_url:  extractImageUrl(raw),
        images:     extractAllImageUrls(raw),
        seed:       raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 3. fal-ai/bytedance/seedream/v4/text-to-image — SeeDream v4
   *    ByteDance 高品質文字生圖，支援中文提示詞
   */
  seedreamV4: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(4000),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).optional().default("1:1"),
      negative_prompt: z.string().optional(),
      num_images:   z.number().min(1).max(4).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/bytedance/seedream/v4/text-to-image", {
        prompt:          input.prompt,
        aspect_ratio:    input.aspect_ratio,
        negative_prompt: input.negative_prompt,
        num_images:      input.num_images,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 4. fal-ai/imagen4/preview — Google Imagen 4 Preview
   *    Google 最新圖片生成模型，高真實感
   */
  imagen4: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(4000),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().default("1:1"),
      num_images:   z.number().min(1).max(4).optional().default(1),
      negative_prompt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/imagen4/preview", {
        prompt:          input.prompt,
        aspect_ratio:    input.aspect_ratio,
        num_images:      input.num_images,
        negative_prompt: input.negative_prompt,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🖌️ 圖片編輯（Image Edit）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 5. fal-ai/nano-banana-pro/edit — Gemini 3 Pro 圖片編輯
   *    多圖輸入，語意式局部/全局編輯（不需 mask）
   */
  nanoBananaProEdit: protectedProcedure
    .input(z.object({
      prompt:     z.string().min(1).max(4000),
      image_url:  z.string().url(),
      image_urls: z.array(z.string().url()).max(13).optional(), // 額外參考圖
    }))
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = await falQueueRun("fal-ai/nano-banana-pro/edit", {
        prompt:     input.prompt,
        image_urls: urls,
      }, 180) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 6. fal-ai/nano-banana/edit — Gemini 2.0 Flash Image 編輯（較快）
   */
  nanoBananaEdit: protectedProcedure
    .input(z.object({
      prompt:     z.string().min(1).max(4000),
      image_url:  z.string().url(),
      image_urls: z.array(z.string().url()).max(13).optional(),
    }))
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = await falQueueRun("fal-ai/nano-banana/edit", {
        prompt:     input.prompt,
        image_urls: urls,
      }) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 7. fal-ai/bytedance/seedream/v4.5/edit — SeeDream v4.5 編輯
   *    ByteDance 高品質圖片語意編輯
   */
  seedreamV45Edit: protectedProcedure
    .input(z.object({
      prompt:    z.string().min(1).max(4000),
      image_url: z.string().url(),
      strength:  z.number().min(0).max(1).optional().default(0.8),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/bytedance/seedream/v4.5/edit", {
        prompt:    input.prompt,
        image_url: input.image_url,
        strength:  input.strength,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 8. fal-ai/bytedance/seedream/v5/lite/edit — SeeDream v5 Lite 編輯
   *    更快速的 v5 輕量版編輯
   */
  seedreamV5LiteEdit: protectedProcedure
    .input(z.object({
      prompt:    z.string().min(1).max(4000),
      image_url: z.string().url(),
      strength:  z.number().min(0).max(1).optional().default(0.8),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/bytedance/seedream/v5/lite/edit", {
        prompt:    input.prompt,
        image_url: input.image_url,
        strength:  input.strength,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 9. xai/grok-imagine-image/edit — xAI Grok 圖片編輯
   *    Grok 原生多模態圖片編輯
   */
  grokEdit: protectedProcedure
    .input(z.object({
      prompt:    z.string().min(1).max(4000),
      image_url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("xai/grok-imagine-image/edit", {
        prompt:    input.prompt,
        image_url: input.image_url,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 10. fal-ai/gpt-image-1.5/edit — GPT Image 1.5 圖片編輯
   *     OpenAI GPT Image 1.5，支援 mask（可選），高語意理解
   */
  gptImage15Edit: protectedProcedure
    .input(z.object({
      prompt:    z.string().min(1).max(4000),
      image_url: z.string().url(),
      mask_url:  z.string().url().optional(),
      size:      z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]).optional().default("auto"),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:    input.prompt,
        image_url: input.image_url,
        size:      input.size,
      };
      if (input.mask_url) payload.mask_url = input.mask_url;

      const raw = await falQueueRun("fal-ai/gpt-image-1.5/edit", payload, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 11. fal-ai/flux-pro/kontext — FLUX.1 Kontext Pro
   *     BFL 最新上下文感知圖片編輯，精準局部修改
   *     支援 guidance_scale, num_inference_steps, seed
   */
  fluxKontext: protectedProcedure
    .input(z.object({
      prompt:              z.string().min(1).max(4000),
      image_url:           z.string().url(),
      guidance_scale:      z.number().min(1).max(30).optional().default(3.5),
      num_inference_steps: z.number().min(1).max(50).optional().default(28),
      seed:                z.number().optional(),
      output_format:       z.enum(["jpeg", "png"]).optional().default("jpeg"),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/flux-pro/kontext", {
        prompt:              input.prompt,
        image_url:           input.image_url,
        guidance_scale:      input.guidance_scale,
        num_inference_steps: input.num_inference_steps,
        seed:                input.seed,
        output_format:       input.output_format,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  // ✏️ 新增圖片編輯模型
  // ═══════════════════════════════════════════════════════════════

  /**
   * 7-NEW. fal-ai/nano-banana-2/edit — Gemini 3.1 Flash Image 編輯
   *   image_urls[]（必填）+ prompt + aspect_ratio + resolution（0.5K/1K/2K/4K）
   */
  nanoBanana2Edit: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(4000),
      image_url:    z.string().url(),
      image_urls:   z.array(z.string().url()).max(13).optional(),
      aspect_ratio: z.enum(["auto","21:9","16:9","3:2","4:3","5:4","1:1","4:5","3:4","2:3","9:16","4:1","1:4","8:1","1:8"]).optional().default("auto"),
      resolution:   z.enum(["0.5K","1K","2K","4K"]).optional().default("1K"),
      num_images:   z.number().min(1).max(4).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = await falQueueRun("fal-ai/nano-banana-2/edit", {
        prompt:       input.prompt,
        image_urls:   urls,
        aspect_ratio: input.aspect_ratio,
        resolution:   input.resolution,
        num_images:   input.num_images,
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 13-NEW. fal-ai/flux-2-pro/edit — FLUX 2 Pro 圖片編輯
   *   image_urls[]（必填）+ prompt；image_size 可選
   */
  flux2ProEdit: protectedProcedure
    .input(z.object({
      prompt:     z.string().min(1).max(4000),
      image_url:  z.string().url(),
      image_urls: z.array(z.string().url()).max(2).optional(),
      image_size: z.enum(["auto","square_hd","square","portrait_4_3","portrait_16_9","landscape_4_3","landscape_16_9"]).optional().default("auto"),
      seed:       z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = await falQueueRun("fal-ai/flux-2-pro/edit", {
        prompt:     input.prompt,
        image_urls: urls,
        image_size: input.image_size,
        ...(input.seed !== undefined && { seed: input.seed }),
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? null,
        raw,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🔍 影像放大（Upscale）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 14-NEW. fal-ai/seedvr/upscale/image — SeedVR 影像放大
   *   支援 factor 模式（×2/×4）或 target 模式（720p/1080p/1440p/2160p）
   */
  seedVRUpscale: protectedProcedure
    .input(z.object({
      image_url:         z.string().url(),
      upscale_mode:      z.enum(["factor","target"]).optional().default("factor"),
      upscale_factor:    z.number().min(1).max(4).optional().default(2),
      target_resolution: z.enum(["720p","1080p","1440p","2160p"]).optional().default("1080p"),
      noise_scale:       z.number().min(0).max(1).optional().default(0.1),
      output_format:     z.enum(["png","jpg","webp"]).optional().default("jpg"),
      seed:              z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/seedvr/upscale/image", {
        image_url:         input.image_url,
        upscale_mode:      input.upscale_mode,
        upscale_factor:    input.upscale_factor,
        target_resolution: input.target_resolution,
        noise_scale:       input.noise_scale,
        output_format:     input.output_format,
        ...(input.seed !== undefined && { seed: input.seed }),
      }, 180) as any;
      const imgUrl = raw?.image?.url || raw?.image_url || extractImageUrl(raw);
      return { image_url: imgUrl, seed: raw?.seed ?? null, raw };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🦴 骨骼姿勢偵測（Pose Detection）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 15-NEW. fal-ai/dwpose — DWPose 骨骼姿勢偵測
   *   輸入人物圖片，輸出骨骼姿勢圖（可用於 ControlNet 生圖）
   *   draw_mode: full-pose | body-pose | face-pose | hand-pose | ...
   */
  dwPose: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      draw_mode: z.enum(["full-pose","body-pose","face-pose","hand-pose","face-hand-mask","face-mask","hand-mask"]).optional().default("body-pose"),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/dwpose", {
        image_url: input.image_url,
        draw_mode: input.draw_mode,
      }, 60) as any;
      const poseUrl = raw?.image?.url || raw?.image_url || extractImageUrl(raw);
      return { pose_image_url: poseUrl, raw };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎨 Stable Diffusion 系列
  // ═══════════════════════════════════════════════════════════════

  /**
   * 16-NEW. fal-ai/stable-diffusion-v35-large — SD 3.5 Large
   *   支援 ControlNet（傳入 control_image_url + path）、LoRA（loras[]）、IP-Adapter
   *   image_size: square_hd | square | portrait_4_3 | portrait_16_9 | landscape_4_3 | landscape_16_9
   */
  stableDiffusion35: protectedProcedure
    .input(z.object({
      prompt:               z.string().min(1).max(4000),
      negative_prompt:      z.string().optional().default(""),
      num_inference_steps:  z.number().min(1).max(50).optional().default(28),
      guidance_scale:       z.number().min(1).max(20).optional().default(3.5),
      num_images:           z.number().min(1).max(4).optional().default(1),
      image_size:           z.enum(["square_hd","square","portrait_4_3","portrait_16_9","landscape_4_3","landscape_16_9"]).optional().default("landscape_4_3"),
      seed:                 z.number().optional(),
      output_format:        z.enum(["jpeg","png"]).optional().default("jpeg"),
      // ControlNet
      controlnet_image_url: z.string().url().optional(),
      controlnet_path:      z.string().optional(),
      controlnet_scale:     z.number().min(0).max(2).optional().default(1),
      // LoRA (single for simplicity)
      lora_path:            z.string().optional(),
      lora_scale:           z.number().min(0).max(2).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:              input.prompt,
        negative_prompt:     input.negative_prompt,
        num_inference_steps: input.num_inference_steps,
        guidance_scale:      input.guidance_scale,
        num_images:          input.num_images,
        image_size:          input.image_size,
        output_format:       input.output_format,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.controlnet_image_url && input.controlnet_path) {
        payload.controlnet = {
          path:               input.controlnet_path,
          control_image_url:  input.controlnet_image_url,
          conditioning_scale: input.controlnet_scale,
        };
      }
      if (input.lora_path) {
        payload.loras = [{ path: input.lora_path, scale: input.lora_scale }];
      }
      const raw = await falQueueRun("fal-ai/stable-diffusion-v35-large", payload, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 17-NEW. fal-ai/fast-sdxl — SDXL 快速文字生圖
   *   支援 negative_prompt、image_size、LoRA、IP-Adapter
   */
  fastSdxl: protectedProcedure
    .input(z.object({
      prompt:          z.string().min(1).max(4000),
      negative_prompt: z.string().optional().default(""),
      image_size:      z.enum(["square_hd","square","portrait_4_3","portrait_16_9","landscape_4_3","landscape_16_9"]).optional().default("square_hd"),
      num_images:      z.number().min(1).max(4).optional().default(1),
      seed:            z.number().optional(),
      lora_path:       z.string().optional(),
      lora_scale:      z.number().min(0).max(2).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:          input.prompt,
        negative_prompt: input.negative_prompt,
        image_size:      input.image_size,
        num_images:      input.num_images,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.lora_path) {
        payload.loras = [{ path: input.lora_path, scale: input.lora_scale }];
      }
      const raw = await falQueueRun("fal-ai/fast-sdxl", payload, 90) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 18-NEW. fal-ai/lora — Stable Diffusion + LoRA 生圖
   *   支援任意 HuggingFace LoRA URL，image_size、negative_prompt
   */
  sdLora: protectedProcedure
    .input(z.object({
      prompt:          z.string().min(1).max(4000),
      negative_prompt: z.string().optional().default(""),
      model_name:      z.string().optional().default("stabilityai/stable-diffusion-xl-base-1.0"),
      image_size:      z.enum(["square_hd","square","portrait_4_3","portrait_16_9","landscape_4_3","landscape_16_9"]).optional().default("square_hd"),
      num_images:      z.number().min(1).max(4).optional().default(1),
      seed:            z.number().optional(),
      loras:           z.array(z.object({ path: z.string(), scale: z.number().optional().default(1) })).optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/lora", {
        model_name:      input.model_name,
        prompt:          input.prompt,
        negative_prompt: input.negative_prompt,
        image_size:      input.image_size,
        num_images:      input.num_images,
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(input.loras?.length && { loras: input.loras }),
      }, 120) as any;
      return {
        image_url: extractImageUrl(raw),
        images:    extractAllImageUrls(raw),
        seed:      raw?.seed ?? null,
        raw,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🏔️ 圖片轉 3D（Image-to-3D）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 19-NEW. fal-ai/trellis-2 — Trellis 2 圖片生成 3D GLB
   *   image_url（必填）；resolution 512/1024/1536；texture_size 1024/2048/4096
   *   輸出：model_glb.url
   */
  trellis2: protectedProcedure
    .input(z.object({
      image_url:    z.string().url(),
      resolution:   z.enum(["512","1024","1536"]).optional().default("1024"),
      texture_size: z.enum(["1024","2048","4096"]).optional().default("2048"),
      remesh:       z.boolean().optional().default(true),
      seed:         z.number().optional(),
      // Stage guidance params (simplified)
      ss_guidance_strength:    z.number().optional().default(7.5),
      shape_slat_guidance_strength: z.number().optional().default(7.5),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/trellis-2", {
        image_url:                   input.image_url,
        resolution:                  Number(input.resolution),
        texture_size:                Number(input.texture_size),
        remesh:                      input.remesh,
        ss_guidance_strength:        input.ss_guidance_strength,
        shape_slat_guidance_strength: input.shape_slat_guidance_strength,
        ...(input.seed !== undefined && { seed: input.seed }),
      }, 300) as any;
      const glbUrl = raw?.model_glb?.url || null;
      return { model_glb_url: glbUrl, raw };
    }),

  /**
   * 20-NEW. fal-ai/sam-3/3d-objects — SAM 3D 物件 3D 重建
   *   image_url + 可選 prompt（文字描述要偵測的物件）
   *   輸出：model_glb.url, gaussian_splat.url, artifacts_zip.url
   */
  sam3dObjects: protectedProcedure
    .input(z.object({
      image_url:            z.string().url(),
      prompt:               z.string().optional().default("object"),
      export_textured_glb:  z.boolean().optional().default(true),
      detection_threshold:  z.number().min(0.1).max(1).optional(),
      seed:                 z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/sam-3/3d-objects", {
        image_url:           input.image_url,
        prompt:              input.prompt,
        export_textured_glb: input.export_textured_glb,
        ...(input.detection_threshold !== undefined && { detection_threshold: input.detection_threshold }),
        ...(input.seed !== undefined && { seed: input.seed }),
      }, 300) as any;
      return {
        model_glb_url:     raw?.model_glb?.url || null,
        gaussian_splat_url: raw?.gaussian_splat?.url || null,
        artifacts_zip_url: raw?.artifacts_zip?.url || null,
        individual_glbs:   (raw?.individual_glbs || []).map((f: any) => f?.url).filter(Boolean),
        raw,
      };
    }),

  /**
   * 21-NEW. fal-ai/hunyuan3d-v3/image-to-3d — 混元 3D v3
   *   input_image_url（必填）；可選 back/left/right 視角補充圖
   *   enable_pbr, generate_type (Normal/LowPoly/Geometry), face_count
   *   輸出：model_glb.url + model_urls（glb/obj/usdz/fbx）
   */
  hunyuan3d: protectedProcedure
    .input(z.object({
      input_image_url: z.string().url(),
      back_image_url:  z.string().url().optional(),
      left_image_url:  z.string().url().optional(),
      right_image_url: z.string().url().optional(),
      enable_pbr:      z.boolean().optional().default(true),
      face_count:      z.number().min(40000).max(1500000).optional().default(500000),
      generate_type:   z.enum(["Normal","LowPoly","Geometry"]).optional().default("Normal"),
      polygon_type:    z.enum(["triangle","quadrilateral"]).optional().default("triangle"),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        input_image_url: input.input_image_url,
        enable_pbr:      input.enable_pbr,
        face_count:      input.face_count,
        generate_type:   input.generate_type,
        polygon_type:    input.polygon_type,
      };
      if (input.back_image_url)  payload.back_image_url  = input.back_image_url;
      if (input.left_image_url)  payload.left_image_url  = input.left_image_url;
      if (input.right_image_url) payload.right_image_url = input.right_image_url;

      const raw = await falQueueRun("fal-ai/hunyuan3d-v3/image-to-3d", payload, 300) as any;
      return {
        model_glb_url:  raw?.model_glb?.url || null,
        thumbnail_url:  raw?.thumbnail?.url || null,
        model_urls:     {
          glb:  raw?.model_urls?.glb?.url || null,
          obj:  raw?.model_urls?.obj?.url || null,
          usdz: raw?.model_urls?.usdz?.url || null,
          fbx:  raw?.model_urls?.fbx?.url || null,
        },
        seed: raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 22-NEW. fal-ai/hyper3d/rodin — Rodin 文字或圖片生成 3D
   *   prompt（文字生 3D）或 input_image_urls[]（圖片生 3D）二選一/可兼用
   *   material: PBR/Shaded；quality: high/medium/low/extra-low
   *   geometry_file_format: glb/usdz/fbx/obj/stl
   *   輸出：model_mesh.url + textures[]
   */
  rodin3d: protectedProcedure
    .input(z.object({
      prompt:               z.string().optional().default(""),
      image_urls:           z.array(z.string().url()).max(8).optional(),
      condition_mode:       z.enum(["fuse","concat"]).optional().default("concat"),
      geometry_file_format: z.enum(["glb","usdz","fbx","obj","stl"]).optional().default("glb"),
      material:             z.enum(["PBR","Shaded"]).optional().default("PBR"),
      quality:              z.enum(["high","medium","low","extra-low"]).optional().default("medium"),
      seed:                 z.number().optional(),
      use_hyper:            z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt:               input.prompt,
        condition_mode:       input.condition_mode,
        geometry_file_format: input.geometry_file_format,
        material:             input.material,
        quality:              input.quality,
        use_hyper:            input.use_hyper,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.image_urls?.length) payload.input_image_urls = input.image_urls;

      const raw = await falQueueRun("fal-ai/hyper3d/rodin", payload, 300) as any;
      return {
        model_glb_url: raw?.model_mesh?.url || null,
        textures:      (raw?.textures || []).map((t: any) => t?.url).filter(Boolean),
        seed:          raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 23-NEW. fal-ai/hunyuan_world/image-to-world — 混元 World 圖片轉 3D 世界
   *   image_url + labels_fg1 + labels_fg2 + classes（全部必填）
   *   輸出：world_file.url（.drc 或其他格式）
   */
  hunyuanWorld: protectedProcedure
    .input(z.object({
      image_url:   z.string().url(),
      labels_fg1:  z.string().min(1).default("foreground objects"),
      labels_fg2:  z.string().min(1).default("background elements"),
      classes:     z.string().min(1).default("general scene"),
      export_drc:  z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const raw = await falQueueRun("fal-ai/hunyuan_world/image-to-world", {
        image_url:  input.image_url,
        labels_fg1: input.labels_fg1,
        labels_fg2: input.labels_fg2,
        classes:    input.classes,
        export_drc: input.export_drc,
      }, 300) as any;
      const worldUrl = raw?.world_file?.url || null;
      return { world_file_url: worldUrl, raw };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 📚 任務狀態查詢
  // ═══════════════════════════════════════════════════════════════

  /** 非同步任務狀態查詢 */
  jobStatus: protectedProcedure
    .input(z.object({ request_id: z.string(), model: z.string() }))
    .query(async ({ input }) => falQueueStatus(input.request_id, input.model)),

  jobResult: protectedProcedure
    .input(z.object({ request_id: z.string(), model: z.string() }))
    .query(async ({ input }) => falQueueResult(input.request_id, input.model)),

  /**
   * 通用圖片輪詢 API：每 3 秒輪詢一次直到完成
   * 支援所有 imageStudio 的异步任務（包括 3D, SD, 圖片編輯等）
   */
  checkImageStatus: protectedProcedure
    .input(z.object({
      requestId: z.string().min(1),
      modelId:   z.string().min(1),
    }))
    .query(async ({ input }) => {
      const status = await falQueueStatus(input.requestId, input.modelId) as any;
      const s = status?.status ?? status?.state;

      if (s === "COMPLETED") {
        const result = await falQueueResult(input.requestId, input.modelId) as any;
        return {
          status:        "COMPLETED",
          image_url:     extractImageUrl(result),
          images:        extractAllImageUrls(result),
          // 3D 模型輸出
          model_glb_url: result?.model_glb?.url || result?.model_mesh?.url || null,
          raw:           result,
        };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `任務失敗 [${input.modelId}]: ${errMsg}` });
      }

      return { status: "IN_PROGRESS" };
    }),
});

export type ImageStudioRouter = typeof imageStudioRouter;
