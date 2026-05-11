/**
 * server/services/spiritTools/imageSpecialistTools.ts
 *
 * Tools for image-specialist (圖圖) spirit.
 * Handles image generation, editing, upscaling, and style transfer.
 */

import { logger } from "../../_core/logger";

/**
 * Generate an image using the preferred image engine
 */
export async function generateImage(input: {
  userId: number;
  prompt: string;
  modelId?: string;
  aspectRatio?: string;
  numImages?: number;
  negativePrompt?: string;
  seed?: number;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    // Import generation service dynamically to avoid circular dependencies
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: input.prompt,
      modelId: input.modelId || "flux-1.1-pro",
      params: {
        aspect_ratio: input.aspectRatio || "1:1",
        num_images: input.numImages || 1,
        negative_prompt: input.negativePrompt,
        seed: input.seed,
      },
    });

    logger.info("image_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId: input.modelId,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `圖片生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("image_generation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `生成失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Edit an existing image (img2img, inpainting, outpainting)
 */
export async function editImage(input: {
  userId: number;
  imageUrl: string;
  prompt: string;
  strength?: number;
  maskUrl?: string;
  modelId?: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: input.prompt,
      modelId: input.modelId || "flux-1.1-pro",
      params: {
        image_url: input.imageUrl,
        strength: input.strength || 0.75,
        mask_url: input.maskUrl,
      },
    });

    logger.info("image_edit_started", {
      userId: input.userId,
      jobId: result.jobId,
      hasImageUrl: !!input.imageUrl,
      hasMask: !!input.maskUrl,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `圖片編輯已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("image_edit_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `編輯失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Upscale an image to higher resolution
 */
export async function upscaleImage(input: {
  userId: number;
  imageUrl: string;
  scaleFactor?: number;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: "upscale",
      modelId: "clarity-upscaler",
      params: {
        image_url: input.imageUrl,
        scale_factor: input.scaleFactor || 2,
      },
    });

    logger.info("image_upscale_started", {
      userId: input.userId,
      jobId: result.jobId,
      scaleFactor: input.scaleFactor,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `圖片放大已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("image_upscale_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `放大失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get available image models
 */
export function getImageModels(): {
  success: boolean;
  models: Array<{
    id: string;
    name: string;
    description: string;
    strengths: string[];
    speed: "fast" | "medium" | "slow";
  }>;
} {
  return {
    success: true,
    models: [
      {
        id: "flux-1.1-pro",
        name: "Flux 1.1 Pro",
        description: "最快速的高品質圖片生成",
        strengths: ["速度", "品質", "穩定性"],
        speed: "fast",
      },
      {
        id: "flux-pro",
        name: "Flux Pro",
        description: "專業級圖片生成",
        strengths: ["細節", "真實感", "藝術性"],
        speed: "medium",
      },
      {
        id: "sd3-large",
        name: "Stable Diffusion 3",
        description: "開源圖片生成旗艦",
        strengths: ["開源", "可調性", "社群支援"],
        speed: "medium",
      },
      {
        id: "ideogram-v2",
        name: "Ideogram v2",
        description: "擅長文字渲染和設計",
        strengths: ["文字", "logo", "海報"],
        speed: "fast",
      },
      {
        id: "recraft-v3",
        name: "Recraft v3",
        description: "向量風格和插畫",
        strengths: ["向量", "插畫", "風格化"],
        speed: "fast",
      },
    ],
  };
}

/**
 * Get image generation tips and best practices
 */
export function getImageGenerationTips(scenario?: string): {
  success: boolean;
  tips: string[];
} {
  const generalTips = [
    "使用具體的描述詞，例如「一隻橘色虎斑貓」而非「一隻貓」",
    "加入風格關鍵字，如「電影感」、「水彩畫」、「3D 渲染」",
    "指定光線和氛圍，如「柔和的晨光」、「戲劇性的側光」",
    "提及構圖細節，如「特寫」、「鳥瞰視角」、「黃金比例」",
    "使用 negative prompt 排除不想要的元素",
  ];

  const scenarioTips: Record<string, string[]> = {
    portrait: [
      "指定表情和情緒：「微笑」、「沉思」、「自信」",
      "描述髮型、服裝、配飾",
      "提及背景模糊 (bokeh) 來突出主體",
      "使用「專業人像攝影」、「85mm 鏡頭」等關鍵字",
    ],
    landscape: [
      "描述天氣和時段：「日落」、「薄霧」、「暴風雨前」",
      "提及視角：「廣角」、「全景」、「空拍」",
      "加入前景元素增加層次感",
      "使用「風景攝影」、「高動態範圍」等詞",
    ],
    product: [
      "純色背景或工作室設定",
      "描述材質：「啞光」、「金屬質感」、「透明玻璃」",
      "加入陰影和反射細節",
      "使用「產品攝影」、「去背」、「白色背景」",
    ],
    artistic: [
      "明確指定藝術風格：「印象派」、「賽博龐克」、「超現實」",
      "提及知名藝術家風格作為參考",
      "使用藝術媒材關鍵字：「油畫」、「水墨」、「數位藝術」",
      "實驗性嘗試不同的提示詞組合",
    ],
  };

  const tips = scenario && scenarioTips[scenario]
    ? [...scenarioTips[scenario], ...generalTips.slice(0, 2)]
    : generalTips;

  return {
    success: true,
    tips,
  };
}
