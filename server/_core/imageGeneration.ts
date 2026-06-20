/**
 * imageGeneration.ts — 圖片生成介面（fal.ai Flux Pro）
 *
 * ⚠️ 目前沒有任何呼叫端 — 4 種模態都已改走 falDispatcher / 各 studio
 * router。這個檔案保留作為「最小參考實作」，新功能不要再用。若日後需
 * 要恢復使用，userId 必須當作參數傳入，並用 `unifiedAssetPrefix` 組
 * `generated/studio/<userId>/<source>/<modelId>` 統一前綴（請見
 * services/postGenActions.ts.unifiedAssetPrefix）。
 *
 * 需要環境變數：FAL_API_KEY
 */

import { callFalModel } from "../services/falModels";
import { storagePut } from "../storage";
import { resolveFalSafetyChecker } from "../services/security/contentModeration";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
  aspectRatio?: string;
  negativePrompt?: string;
  seed?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
};

export type GenerateImageResponse = {
  url?: string;
};

/**
 * 生成圖片（fal.ai Flux Pro）
 * 失敗時直接拋出錯誤，不回傳假資料
 */
export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_API_KEY 未設定，無法生成圖片。請在環境變數中設定 FAL_API_KEY。"
    );
  }

  // Build fal.ai input
  const falInput: Record<string, unknown> = {
    prompt: options.prompt,
    num_images: 1,
    // AIDV-65：OFF＝維持現行值（false）；ON＝開回 fal safety checker（true）。
    enable_safety_checker: resolveFalSafetyChecker(false),
  };

  if (options.aspectRatio) {
    falInput.aspect_ratio = options.aspectRatio;
  }
  if (options.negativePrompt) {
    falInput.negative_prompt = options.negativePrompt;
  }
  if (options.seed !== undefined) {
    falInput.seed = options.seed;
  }
  if (options.numInferenceSteps !== undefined) {
    falInput.num_inference_steps = options.numInferenceSteps;
  }
  if (options.guidanceScale !== undefined) {
    falInput.guidance_scale = options.guidanceScale;
  }

  // Attach reference image if provided (use first valid URL)
  const refImageUrl = options.originalImages?.find(img => img.url)?.url;
  if (refImageUrl) {
    falInput.image_url = refImageUrl;
  }

  // Choose model: image-to-image if reference provided, else text-to-image
  const modelId = refImageUrl
    ? "fal-ai/flux/dev/image-to-image"
    : "fal-ai/flux-pro/v1.1";

  const result = await callFalModel({
    modelId,
    input: falInput,
    timeoutMs: 120_000,
  });

  // Extract image URL from fal.ai response
  const images = (result.data as any)?.images as
    | Array<{ url: string }>
    | undefined;
  const firstImage = images?.[0];

  if (!firstImage?.url) {
    throw new Error(
      `fal.ai ${modelId} 未回傳圖片結果（response: ${JSON.stringify(result.data).substring(0, 200)}）`
    );
  }

  // Download and re-upload to our S3 bucket for stable URL
  let finalUrl: string = firstImage.url;
  try {
    const res = await fetch(firstImage.url);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") ? "jpg" : "png";
      // ⚠️ 此分支現在沒有呼叫端；保留前綴標記讓未來如果重新接上能立刻
      // 在 S3 看出是 legacy 路徑 — 真要走，請改用 unifiedAssetPrefix。
      const { url } = await storagePut(
        `generated/studio/_legacy/imageGeneration/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
        buffer,
        contentType
      );
      finalUrl = url;
    }
  } catch {
    // storagePut 失敗時直接使用 fal.ai 的臨時 URL
  }

  return { url: finalUrl };
}
