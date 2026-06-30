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
import { safeMediaUrl, safeMediaUrlOptional } from "../lib/urlValidator";
import { generationProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { FAL_QUEUE_BASE, FAL_RUN_BASE } from "../_core/providerFacade";
import { signFalWebhookNonce } from "../_core/webhookTokens";
import { recordErrorTrace } from "../services/brainAutoRepair";
import { localizeResultUrls } from "../services/internalMedia";
import { traceToolRun } from "../services/langsmithTracer";
import { estimatePoints } from "../services/modelPricing";
import { dispatchFalQueueTask } from "../services/falDispatcher";
import { falQueueFetchWithPrefixFallback } from "../services/falQueueClient";
import {
  doPostGenComplete,
  unifiedAssetPrefix,
} from "../services/postGenActions";

// ─── AIDV-678: fal.ai 回傳型別 ────────────────────────────────────────────────

interface FalImageItem {
  url: string;
  [k: string]: unknown;
}

/** 涵蓋圖片、3D、upscale 等各類 fal.ai 端點輸出的寬鬆結構型別 */
interface FalResultLike {
  images?: FalImageItem[];
  image?: { url?: string; [k: string]: unknown };
  image_url?: string;
  data?: { images?: FalImageItem[]; image?: { url?: string }; seed?: number };
  output?: { images?: FalImageItem[] };
  model_glb?: { url?: string };
  model_mesh?: { url?: string };
  model_urls?: {
    glb?: { url?: string };
    obj?: { url?: string };
    usdz?: { url?: string };
    fbx?: { url?: string };
  };
  gaussian_splat?: { url?: string };
  artifacts_zip?: { url?: string };
  individual_glbs?: Array<{ url?: string }>;
  textures?: Array<{ url?: string }>;
  thumbnail?: { url?: string };
  world_file?: { url?: string };
  seed?: number;
  prompt?: string;
  status?: string;
  state?: string;
  error?: string;
  message?: string;
  [k: string]: unknown;
}

/** AIDV-678: Zod schema — fal.ai 圖片結果最小契約（至少含 images[].url） */
const FalImageResultSchema = z
  .object({
    images: z.array(z.object({ url: z.string() }).passthrough()).optional(),
    image: z.object({ url: z.string() }).passthrough().optional(),
    image_url: z.string().optional(),
    seed: z.number().optional(),
  })
  .passthrough();

// ─── fal.ai 呼叫工具（透過 falDispatcher 統一派發，享有 fallback chain；
//     base URL 來自 providerFacade 單一來源）─────────────────────────────────

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

async function falQueueSubmit(
  modelId: string,
  input: Record<string, unknown>
): Promise<{ request_id: string }> {
  // 帶 fal.ai webhook 回呼，瀏覽器關閉時 webhookFal 會以 request_id 反查
  // resultJson.requestId 對應的 backgroundJob 並寫回結果（不依賴前端輪詢）。
  // AIDV-158：此流程在送 fal 時尚無 jobId（job 由前端後建、靠 request_id 反查），
  // 無法簽 fal:<jobId>，改簽一次性 server-origin nonce（fal:n:<nonce>），證明回呼 URL
  // 由持有 JWT_SECRET 的自家伺服器所鑄；handler 端會驗（缺/錯 token 一律 4xx）。
  const siteUrl = process.env.VITE_SITE_URL?.trim();
  const falSigned = signFalWebhookNonce();
  const webhookUrl = siteUrl
    ? falSigned
      ? `${siteUrl}/api/webhook/fal?fnonce=${falSigned.nonce}&token=${falSigned.token}`
      : `${siteUrl}/api/webhook/fal`
    : undefined;

  try {
    const result = await dispatchFalQueueTask({
      modelId,
      input,
      webhookUrl,
      route: "trpc.imageStudio.*",
      modality: "image",
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
      runName: "image-studio/fal-queue-status",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.imageStudio.check*",
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
    runName: "image-studio/fal-queue-status",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.imageStudio.check*",
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
): Promise<FalResultLike> {
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
      runName: "image-studio/fal-queue-result",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.imageStudio.check*",
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
  const raw = await res.json();
  const parsed = FalImageResultSchema.safeParse(raw);
  const data: FalResultLike = parsed.success ? parsed.data : (raw as FalResultLike);
  void traceToolRun({
    runName: "image-studio/fal-queue-result",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.imageStudio.check*",
    method: "GET",
    inputs: { request_id: requestId },
    outputs: {
      status: data.status ?? "unknown",
      request_id: requestId,
      has_result: true,
    },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

async function falRun(
  modelId: string,
  input: Record<string, unknown>,
  timeoutMs = 120_000
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = await res.text();
    void traceToolRun({
      runName: "image-studio/fal-run",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.imageStudio.*",
      method: "POST",
      inputs: { input_keys: Object.keys(input) },
      error: err.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    recordErrorTrace({
      userId: 0,
      modality: "image",
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
  const data = await res.json();
  void traceToolRun({
    runName: "image-studio/fal-run",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.imageStudio.*",
    method: "POST",
    inputs: { input_keys: Object.keys(input) },
    outputs: { has_data: Boolean(data) },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

async function falQueueRun(
  modelId: string,
  input: Record<string, unknown>,
  waitSec = 180
): Promise<FalResultLike> {
  const { request_id } = await falQueueSubmit(modelId, input);
  // 直接回傳 request_id，不在後端等待（防止 504 Timeout）
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}

/** 統一解析 fal.ai 圖片回應，回傳第一張圖片 URL */
function extractImageUrl(raw: FalResultLike): string | null {
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

function extractAllImageUrls(raw: FalResultLike): string[] {
  const imgs = raw?.images || raw?.data?.images || raw?.output?.images || [];
  return Array.isArray(imgs)
    ? (imgs as FalImageItem[]).map(i => i.url).filter(Boolean) as string[]
    : [];
}

// ─── 共用 Input Schema ──────────────────────────────────────────────────────

const ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:1",
  "1:4",
  "21:9",
  "auto",
] as const;
const IMAGE_SIZES = [
  "square",
  "square_hd",
  "portrait_4_3",
  "portrait_16_9",
  "landscape_4_3",
  "landscape_16_9",
] as const;

/** 標準品質負向提示詞 — 用於未提供 negative_prompt 時的預設值 */
const DEFAULT_NEGATIVE_PROMPT =
  "low quality, blurry, distorted, deformed, artifacts, watermark, text, signature, cropped, out of frame, worst quality, jpeg artifacts";

/** 安全地合併負向提示詞：用戶提供的 + 預設品質保護 */
function mergeNegativePrompt(userNegative?: string): string {
  if (!userNegative || userNegative.trim() === "")
    return DEFAULT_NEGATIVE_PROMPT;
  return `${userNegative}, ${DEFAULT_NEGATIVE_PROMPT}`;
}

/**
 * 將任意 aspect_ratio 正規化為模型實際支援的最近似值。
 * - `auto` → 優先取 "1:1"；若不支援則取第一個
 * - 其他值 → 以數值距離找最接近的支援比例
 * 可用於 seedreamV4、imagen4、nanoBananaProEdit 等限制比例集合的端點，
 * 防止傳入不支援的比例時 fal.ai 回 400 錯誤。
 */
export function normalizeAspectRatio(
  ratio: string,
  supportedRatios: readonly string[]
): string {
  if (supportedRatios.includes(ratio)) return ratio;
  if (ratio === "auto") {
    return supportedRatios.includes("1:1") ? "1:1" : supportedRatios[0];
  }
  const parts = ratio.split(":");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return supportedRatios[0];
  const target = w / h;
  let best = supportedRatios[0];
  let bestDiff = Infinity;
  for (const r of supportedRatios) {
    if (r === "auto") continue;
    const rParts = r.split(":");
    const rw = Number(rParts[0]);
    const rh = Number(rParts[1]);
    if (rw <= 0 || rh <= 0) continue;
    const diff = Math.abs(rw / rh - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

/** SeeDream v4 支援的比例集合（共 7 種） */
const SEEDREAM_V4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

/** Google Imagen 4 支援的比例集合（共 5 種） */
const IMAGEN4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

// ─── Router ──────────────────────────────────────────────────────────────────

export const imageStudioRouter = router({
  /** 確認 FAL_API_KEY 是否設定 */
  checkApiKey: publicProcedure.query(() => ({
    configured: !!process.env.FAL_API_KEY,
  })),

  // ═══════════════════════════════════════════════════════════════
  // 📸 文字生圖（Text-to-Image）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 1. fal-ai/nano-banana-2 — Gemini 3.1 Flash Image
   *    文字生圖，支援文字渲染、複雜場景構圖、視覺推理
   *    支援 aspect_ratio: auto | 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 4:1 | 1:4 | 8:1 | 1:8
   *    支援 image_urls[] 多圖參考（最多 14 張）
   */
  nanoBanana2: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        aspect_ratio: z.enum(ASPECT_RATIOS).optional().default("auto"),
        image_urls: z.array(safeMediaUrl).max(14).optional(),
        num_images: z.number().min(1).max(4).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio,
        num_images: input.num_images,
      };
      if (input.image_urls?.length) payload.image_urls = input.image_urls;

      const raw = (await falQueueRun(
        "fal-ai/nano-banana-2",
        payload,
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 2. fal-ai/nano-banana-pro — Gemini 3 Pro Image（最高品質）
   *    支援文字生圖 + 多圖參考（最多 14 張）
   */
  nanoBananaPro: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        aspect_ratio: z.enum(ASPECT_RATIOS).optional().default("auto"),
        image_urls: z.array(safeMediaUrl).max(14).optional(),
        num_images: z.number().min(1).max(4).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio,
        num_images: input.num_images,
      };
      if (input.image_urls?.length) payload.image_urls = input.image_urls;

      const raw = (await falQueueRun(
        "fal-ai/nano-banana-pro",
        payload,
        180
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 3. fal-ai/bytedance/seedream/v4/text-to-image — SeeDream v4
   *    ByteDance 高品質文字生圖，支援中文提示詞
   */
  seedreamV4: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        aspect_ratio: z.string().optional().default("1:1"),
        negative_prompt: z.string().optional(),
        num_images: z.number().min(1).max(4).optional().default(1),
        seed: z.number().int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/bytedance/seedream/v4/text-to-image",
        {
          prompt: input.prompt,
          aspect_ratio: normalizeAspectRatio(input.aspect_ratio ?? "1:1", SEEDREAM_V4_RATIOS),
          negative_prompt: mergeNegativePrompt(input.negative_prompt),
          num_images: input.num_images,
          ...(input.seed !== undefined && { seed: input.seed }),
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? raw?.data?.seed ?? null,
        raw,
      };
    }),

  /**
   * 4. fal-ai/imagen4/preview — Google Imagen 4 Preview
   *    Google 最新圖片生成模型，高真實感
   */
  imagen4: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        aspect_ratio: z.string().optional().default("1:1"),
        num_images: z.number().min(1).max(4).optional().default(1),
        negative_prompt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/imagen4/preview",
        {
          prompt: input.prompt,
          aspect_ratio: normalizeAspectRatio(input.aspect_ratio ?? "1:1", IMAGEN4_RATIOS),
          num_images: input.num_images,
          negative_prompt: mergeNegativePrompt(input.negative_prompt),
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? raw?.data?.seed ?? null,
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
  nanoBananaProEdit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        image_urls: z.array(safeMediaUrl).max(13).optional(), // 額外參考圖
        aspect_ratio: z.string().optional().default("auto"),
        num_images: z.number().min(1).max(4).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const normalizedRatio = normalizeAspectRatio(
        input.aspect_ratio ?? "auto",
        ASPECT_RATIOS
      );
      const raw = (await falQueueRun(
        "fal-ai/nano-banana-pro/edit",
        {
          prompt: input.prompt,
          image_urls: urls,
          aspect_ratio: normalizedRatio,
          num_images: input.num_images,
        },
        180
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 6. fal-ai/nano-banana/edit — Gemini 2.0 Flash Image 編輯（較快）
   */
  nanoBananaEdit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        image_urls: z.array(safeMediaUrl).max(13).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = (await falQueueRun("fal-ai/nano-banana/edit", {
        prompt: input.prompt,
        image_urls: urls,
      }));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 7. fal-ai/bytedance/seedream/v4.5/edit — SeeDream v4.5 編輯
   *    ByteDance 高品質圖片語意編輯
   */
  seedreamV45Edit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        strength: z.number().min(0).max(1).optional().default(0.8),
        negative_prompt: z.string().optional(),
        num_images: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.image_url,
        strength: input.strength,
        negative_prompt: mergeNegativePrompt(input.negative_prompt),
        num_images: input.num_images,
      };
      if (input.seed !== undefined) payload.seed = input.seed;
      const raw = (await falQueueRun(
        "fal-ai/bytedance/seedream/v4.5/edit",
        payload,
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 8. fal-ai/bytedance/seedream/v5/lite/edit — SeeDream v5 Lite 編輯
   *    更快速的 v5 輕量版編輯
   */
  seedreamV5LiteEdit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        strength: z.number().min(0).max(1).optional().default(0.8),
        negative_prompt: z.string().optional(),
        num_images: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.image_url,
        strength: input.strength,
        negative_prompt: mergeNegativePrompt(input.negative_prompt),
        num_images: input.num_images,
      };
      if (input.seed !== undefined) payload.seed = input.seed;
      const raw = (await falQueueRun(
        "fal-ai/bytedance/seedream/v5/lite/edit",
        payload,
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 9. xai/grok-imagine-image/edit — xAI Grok 圖片編輯
   *    Grok 原生多模態圖片編輯
   */
  grokEdit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "xai/grok-imagine-image/edit",
        {
          prompt: input.prompt,
          image_url: input.image_url,
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 10. fal-ai/gpt-image-1.5/edit — GPT Image 1.5 圖片編輯
   *     OpenAI GPT Image 1.5，支援 mask（可選），高語意理解
   */
  gptImage15Edit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        mask_url: safeMediaUrlOptional,
        size: z
          .enum(["auto", "1024x1024", "1536x1024", "1024x1536"])
          .optional()
          .default("auto"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        image_url: input.image_url,
        size: input.size,
      };
      if (input.mask_url) payload.mask_url = input.mask_url;

      const raw = (await falQueueRun(
        "fal-ai/gpt-image-1.5/edit",
        payload,
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 11. fal-ai/flux-pro/kontext — FLUX.1 Kontext Pro
   *     BFL 最新上下文感知圖片編輯，精準局部修改
   *     支援 guidance_scale, num_inference_steps, seed
   */
  fluxKontext: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        guidance_scale: z.number().min(1).max(30).optional().default(3.5),
        num_inference_steps: z.number().min(1).max(50).optional().default(28),
        seed: z.number().optional(),
        output_format: z.enum(["jpeg", "png"]).optional().default("jpeg"),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/flux-pro/kontext",
        {
          prompt: input.prompt,
          image_url: input.image_url,
          guidance_scale: input.guidance_scale,
          num_inference_steps: input.num_inference_steps,
          seed: input.seed,
          output_format: input.output_format,
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? raw?.data?.seed ?? null,
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
  nanoBanana2Edit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        image_urls: z.array(safeMediaUrl).max(13).optional(),
        aspect_ratio: z
          .enum([
            "auto",
            "21:9",
            "16:9",
            "3:2",
            "4:3",
            "5:4",
            "1:1",
            "4:5",
            "3:4",
            "2:3",
            "9:16",
            "4:1",
            "1:4",
            "8:1",
            "1:8",
          ])
          .optional()
          .default("auto"),
        resolution: z.enum(["0.5K", "1K", "2K", "4K"]).optional().default("1K"),
        num_images: z.number().min(1).max(4).optional().default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.resolution === "4K") {
        const plan = await db.getUserSubscription(ctx.user.id);
        const isPaid =
          !!plan &&
          (plan.status === "active" || plan.status === "trialing") &&
          plan.planId.toLowerCase() !== "free";
        if (!isPaid) throw new TRPCError({ code: "FORBIDDEN", message: "4K 解析度需付費方案" });
      }
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = (await falQueueRun(
        "fal-ai/nano-banana-2/edit",
        {
          prompt: input.prompt,
          image_urls: urls,
          aspect_ratio: input.aspect_ratio,
          resolution: input.resolution,
          num_images: input.num_images,
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        raw,
      };
    }),

  /**
   * 13-NEW. fal-ai/flux-2-pro/edit — FLUX 2 Pro 圖片編輯
   *   image_urls[]（必填）+ prompt；image_size 可選
   */
  flux2ProEdit: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        image_url: safeMediaUrl,
        image_urls: z.array(safeMediaUrl).max(2).optional(),
        image_size: z
          .enum([
            "auto",
            "square_hd",
            "square",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
          ])
          .optional()
          .default("auto"),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const urls = [input.image_url, ...(input.image_urls ?? [])];
      const raw = (await falQueueRun(
        "fal-ai/flux-2-pro/edit",
        {
          prompt: input.prompt,
          image_urls: urls,
          image_size: input.image_size,
          ...(input.seed !== undefined && { seed: input.seed }),
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? null,
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
  seedVRUpscale: generationProcedure
    .input(
      z.object({
        image_url: safeMediaUrl,
        upscale_mode: z.enum(["factor", "target"]).optional().default("factor"),
        upscale_factor: z.number().min(1).max(4).optional().default(2),
        target_resolution: z
          .enum(["720p", "1080p", "1440p", "2160p"])
          .optional()
          .default("1080p"),
        noise_scale: z.number().min(0).max(1).optional().default(0.1),
        output_format: z.enum(["png", "jpg", "webp"]).optional().default("jpg"),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/seedvr/upscale/image",
        {
          image_url: input.image_url,
          upscale_mode: input.upscale_mode,
          upscale_factor: input.upscale_factor,
          target_resolution: input.target_resolution,
          noise_scale: input.noise_scale,
          output_format: input.output_format,
          ...(input.seed !== undefined && { seed: input.seed }),
        },
        180
      ));
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
  dwPose: generationProcedure
    .input(
      z.object({
        image_url: safeMediaUrl,
        draw_mode: z
          .enum([
            "full-pose",
            "body-pose",
            "face-pose",
            "hand-pose",
            "face-hand-mask",
            "face-mask",
            "hand-mask",
          ])
          .optional()
          .default("body-pose"),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/dwpose",
        {
          image_url: input.image_url,
          draw_mode: input.draw_mode,
        },
        60
      ));
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
  stableDiffusion35: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        negative_prompt: z.string().optional().default(""),
        num_inference_steps: z.number().min(1).max(50).optional().default(28),
        guidance_scale: z.number().min(1).max(20).optional().default(3.5),
        num_images: z.number().min(1).max(4).optional().default(1),
        image_size: z
          .enum([
            "square_hd",
            "square",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
          ])
          .optional()
          .default("landscape_4_3"),
        seed: z.number().optional(),
        output_format: z.enum(["jpeg", "png"]).optional().default("jpeg"),
        // ControlNet
        controlnet_image_url: safeMediaUrlOptional,
        controlnet_path: z.string().optional(),
        controlnet_scale: z.number().min(0).max(2).optional().default(1),
        // LoRA (single for simplicity)
        lora_path: z.string().optional(),
        lora_scale: z.number().min(0).max(2).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        negative_prompt: mergeNegativePrompt(input.negative_prompt),
        num_inference_steps: input.num_inference_steps,
        guidance_scale: input.guidance_scale,
        num_images: input.num_images,
        image_size: input.image_size,
        output_format: input.output_format,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.controlnet_image_url && input.controlnet_path) {
        payload.controlnet = {
          path: input.controlnet_path,
          control_image_url: input.controlnet_image_url,
          conditioning_scale: input.controlnet_scale,
        };
      }
      if (input.lora_path) {
        payload.loras = [{ path: input.lora_path, scale: input.lora_scale }];
      }
      const raw = (await falQueueRun(
        "fal-ai/stable-diffusion-v35-large",
        payload,
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 17-NEW. fal-ai/fast-sdxl — SDXL 快速文字生圖
   *   支援 negative_prompt、image_size、LoRA、IP-Adapter
   */
  fastSdxl: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        negative_prompt: z.string().optional().default(""),
        image_size: z
          .enum([
            "square_hd",
            "square",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
          ])
          .optional()
          .default("square_hd"),
        num_images: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
        lora_path: z.string().optional(),
        lora_scale: z.number().min(0).max(2).optional().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        negative_prompt: mergeNegativePrompt(input.negative_prompt),
        image_size: input.image_size,
        num_images: input.num_images,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.lora_path) {
        payload.loras = [{ path: input.lora_path, scale: input.lora_scale }];
      }
      const raw = (await falQueueRun("fal-ai/fast-sdxl", payload, 90));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 18-NEW. fal-ai/lora — Stable Diffusion + LoRA 生圖
   *   支援任意 HuggingFace LoRA URL，image_size、negative_prompt
   */
  sdLora: generationProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        negative_prompt: z.string().optional().default(""),
        model_name: z
          .string()
          .optional()
          .default("stabilityai/stable-diffusion-xl-base-1.0"),
        image_size: z
          .enum([
            "square_hd",
            "square",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
          ])
          .optional()
          .default("square_hd"),
        num_images: z.number().min(1).max(4).optional().default(1),
        seed: z.number().optional(),
        loras: z
          .array(
            z.object({
              path: z.string(),
              scale: z.number().optional().default(1),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/lora",
        {
          model_name: input.model_name,
          prompt: input.prompt,
          negative_prompt: mergeNegativePrompt(input.negative_prompt),
          image_size: input.image_size,
          num_images: input.num_images,
          ...(input.seed !== undefined && { seed: input.seed }),
          ...(input.loras?.length && { loras: input.loras }),
        },
        120
      ));
      return {
        image_url: extractImageUrl(raw),
        images: extractAllImageUrls(raw),
        seed: raw?.seed ?? null,
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
  trellis2: generationProcedure
    .input(
      z.object({
        image_url: safeMediaUrl,
        resolution: z.enum(["512", "1024", "1536"]).optional().default("1024"),
        texture_size: z
          .enum(["1024", "2048", "4096"])
          .optional()
          .default("2048"),
        remesh: z.boolean().optional().default(true),
        seed: z.number().optional(),
        // Stage guidance params (simplified)
        ss_guidance_strength: z.number().optional().default(7.5),
        shape_slat_guidance_strength: z.number().optional().default(7.5),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/trellis-2",
        {
          image_url: input.image_url,
          resolution: Number(input.resolution),
          texture_size: Number(input.texture_size),
          remesh: input.remesh,
          ss_guidance_strength: input.ss_guidance_strength,
          shape_slat_guidance_strength: input.shape_slat_guidance_strength,
          ...(input.seed !== undefined && { seed: input.seed }),
        },
        300
      ));
      const glbUrl = raw?.model_glb?.url || null;
      return { model_glb_url: glbUrl, raw };
    }),

  /**
   * 20-NEW. fal-ai/sam-3/3d-objects — SAM 3D 物件 3D 重建
   *   image_url + 可選 prompt（文字描述要偵測的物件）
   *   輸出：model_glb.url, gaussian_splat.url, artifacts_zip.url
   */
  sam3dObjects: generationProcedure
    .input(
      z.object({
        image_url: safeMediaUrl,
        prompt: z.string().optional().default("object"),
        export_textured_glb: z.boolean().optional().default(true),
        detection_threshold: z.number().min(0.1).max(1).optional(),
        seed: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/sam-3/3d-objects",
        {
          image_url: input.image_url,
          prompt: input.prompt,
          export_textured_glb: input.export_textured_glb,
          ...(input.detection_threshold !== undefined && {
            detection_threshold: input.detection_threshold,
          }),
          ...(input.seed !== undefined && { seed: input.seed }),
        },
        300
      ));
      return {
        model_glb_url: raw?.model_glb?.url || null,
        gaussian_splat_url: raw?.gaussian_splat?.url || null,
        artifacts_zip_url: raw?.artifacts_zip?.url || null,
        individual_glbs: (raw?.individual_glbs || [])
          .map(f => f?.url)
          .filter(Boolean) as string[],
        raw,
      };
    }),

  /**
   * 21-NEW. fal-ai/hunyuan3d-v3/image-to-3d — 混元 3D v3
   *   input_image_url（必填）；可選 back/left/right 視角補充圖
   *   enable_pbr, generate_type (Normal/LowPoly/Geometry), face_count
   *   輸出：model_glb.url + model_urls（glb/obj/usdz/fbx）
   */
  hunyuan3d: generationProcedure
    .input(
      z.object({
        input_image_url: safeMediaUrl,
        back_image_url: safeMediaUrlOptional,
        left_image_url: safeMediaUrlOptional,
        right_image_url: safeMediaUrlOptional,
        enable_pbr: z.boolean().optional().default(true),
        face_count: z
          .number()
          .min(40000)
          .max(1500000)
          .optional()
          .default(500000),
        generate_type: z
          .enum(["Normal", "LowPoly", "Geometry"])
          .optional()
          .default("Normal"),
        polygon_type: z
          .enum(["triangle", "quadrilateral"])
          .optional()
          .default("triangle"),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        input_image_url: input.input_image_url,
        enable_pbr: input.enable_pbr,
        face_count: input.face_count,
        generate_type: input.generate_type,
        polygon_type: input.polygon_type,
      };
      if (input.back_image_url) payload.back_image_url = input.back_image_url;
      if (input.left_image_url) payload.left_image_url = input.left_image_url;
      if (input.right_image_url)
        payload.right_image_url = input.right_image_url;

      const raw = (await falQueueRun(
        "fal-ai/hunyuan3d-v3/image-to-3d",
        payload,
        300
      ));
      return {
        model_glb_url: raw?.model_glb?.url || null,
        thumbnail_url: raw?.thumbnail?.url || null,
        model_urls: {
          glb: raw?.model_urls?.glb?.url || null,
          obj: raw?.model_urls?.obj?.url || null,
          usdz: raw?.model_urls?.usdz?.url || null,
          fbx: raw?.model_urls?.fbx?.url || null,
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
  rodin3d: generationProcedure
    .input(
      z.object({
        prompt: z.string().optional().default(""),
        image_urls: z.array(safeMediaUrl).max(8).optional(),
        condition_mode: z.enum(["fuse", "concat"]).optional().default("concat"),
        geometry_file_format: z
          .enum(["glb", "usdz", "fbx", "obj", "stl"])
          .optional()
          .default("glb"),
        material: z.enum(["PBR", "Shaded"]).optional().default("PBR"),
        quality: z
          .enum(["high", "medium", "low", "extra-low"])
          .optional()
          .default("medium"),
        seed: z.number().optional(),
        use_hyper: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const payload: Record<string, unknown> = {
        prompt: input.prompt,
        condition_mode: input.condition_mode,
        geometry_file_format: input.geometry_file_format,
        material: input.material,
        quality: input.quality,
        use_hyper: input.use_hyper,
        ...(input.seed !== undefined && { seed: input.seed }),
      };
      if (input.image_urls?.length) payload.input_image_urls = input.image_urls;

      const raw = (await falQueueRun(
        "fal-ai/hyper3d/rodin",
        payload,
        300
      ));
      return {
        model_glb_url: raw?.model_mesh?.url || null,
        textures: (raw?.textures || []).map(t => t?.url).filter(Boolean) as string[],
        seed: raw?.seed ?? null,
        raw,
      };
    }),

  /**
   * 23-NEW. fal-ai/hunyuan_world/image-to-world — 混元 World 圖片轉 3D 世界
   *   image_url + labels_fg1 + labels_fg2 + classes（全部必填）
   *   輸出：world_file.url（.drc 或其他格式）
   */
  hunyuanWorld: generationProcedure
    .input(
      z.object({
        image_url: safeMediaUrl,
        labels_fg1: z.string().min(1).default("foreground objects"),
        labels_fg2: z.string().min(1).default("background elements"),
        classes: z.string().min(1).default("general scene"),
        export_drc: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const raw = (await falQueueRun(
        "fal-ai/hunyuan_world/image-to-world",
        {
          image_url: input.image_url,
          labels_fg1: input.labels_fg1,
          labels_fg2: input.labels_fg2,
          classes: input.classes,
          export_drc: input.export_drc,
        },
        300
      ));
      const worldUrl = raw?.world_file?.url || null;
      return { world_file_url: worldUrl, raw };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 📚 任務狀態查詢
  // ═══════════════════════════════════════════════════════════════

  /** 非同步任務狀態查詢 */
  jobStatus: generationProcedure
    .input(z.object({ request_id: z.string(), model: z.string() }))
    .query(async ({ input }) => falQueueStatus(input.request_id, input.model)),

  jobResult: generationProcedure
    .input(z.object({ request_id: z.string(), model: z.string() }))
    .query(async ({ ctx, input }) => {
      const raw = await falQueueResult(input.request_id, input.model);
      return localizeResultUrls(
        raw,
        unifiedAssetPrefix({
          userId: ctx.user.id,
          source: "image",
          modelId: input.model,
        })
      );
    }),

  /**
   * 通用圖片輪詢 API：每 3 秒輪詢一次直到完成
   * 支援所有 imageStudio 的异步任務（包括 3D, SD, 圖片編輯等）
   */
  checkImageStatus: generationProcedure
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
      )) as FalResultLike;
      const s = status?.status ?? status?.state;

      if (s === "COMPLETED") {
        const result = (await falQueueResult(
          input.requestId,
          input.modelId
        ));
        // 統一前綴：generated/studio/<userId>/image/<modelId>
        const localized = (await localizeResultUrls(
          result,
          unifiedAssetPrefix({
            userId: ctx.user.id,
            source: "image",
            modelId: input.modelId,
          })
        )) as FalResultLike;

        const primaryUrl =
          extractImageUrl(localized) ||
          localized?.model_glb?.url ||
          localized?.model_mesh?.url ||
          null;
        // 統一儲存管線：走 doPostGenComplete 寫入提示詞庫 + 資產庫 + 歷史
        // + AI 監控室。dedupeMarker 的存在檢查由 doPostGenComplete 自己做
        // （依 generation_history.compiledPrompt），呼叫端不必再寫一遍。
        const dedupeMarker = `[imageStudio:${input.modelId}:${input.requestId}]`;
        if (primaryUrl) {
          const promptText =
            typeof localized?.prompt === "string"
              ? localized.prompt
              : undefined;
          const estimate = estimatePoints(input.modelId);
          await doPostGenComplete({
            userId: ctx.user.id,
            modality: "image",
            modelId: input.modelId,
            prompt: promptText,
            resultUrl: primaryUrl,
            label: `Image Studio - ${input.modelId}`.slice(0, 100),
            sourceStudio: "image",
            dedupeMarker,
            parameterSnapshot: {
              sourceStudio: "image",
              modelId: input.modelId,
              requestId: input.requestId,
            },
            thumbnailUrl: extractImageUrl(localized) || primaryUrl,
            costCredits: estimate.totalPoints,
          });
        }

        return {
          status: "COMPLETED",
          image_url: extractImageUrl(localized),
          images: extractAllImageUrls(localized),
          // 3D 模型輸出
          model_glb_url:
            localized?.model_glb?.url || localized?.model_mesh?.url || null,
          raw: localized,
        };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        // 連動：記錄到錯誤線索系統 → 自動觸發爬網搜尋 → 建立修復提案
        recordErrorTrace({
          userId: 0,
          modality: "image",
          engine: input.modelId,
          prompt: `[非同步任務失敗] requestId=${input.requestId}`,
          errorMessage: errMsg,
          errorCode: "FAL_TASK_FAILED",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `任務失敗 [${input.modelId}]: ${errMsg}`,
        });
      }

      return { status: "IN_PROGRESS" };
    }),
});

export type ImageStudioRouter = typeof imageStudioRouter;
