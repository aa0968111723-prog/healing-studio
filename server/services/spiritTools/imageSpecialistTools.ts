/**
 * server/services/spiritTools/imageSpecialistTools.ts
 *
 * 圖圖 (image-specialist) 的真實工具集 — 從「會跑 dispatchGenerationJob 的薄殼」
 * 升級成「真的會推薦模型、改寫 prompt、回傳真實 catalog 模型清單」的 AI agent。
 *
 * 之前的問題：
 *   - getImageModels 寫死 5 條跟 catalog 不同步的別名
 *   - 沒有「給意圖 → 推薦模型」的 recommendModel
 *   - 沒有「短 prompt → 結構化長 prompt」的 enhancePrompt
 *   - generate/edit/upscale 用 alias modelId（"flux-1.1-pro" / "clarity-upscaler"）
 *     沒有把 modelId/aspectRatio 等參數透過 catalog 驗證
 *
 * 本檔提供 7 個工具：
 *   - generateImage(...)          — 出圖（會跑 dispatchGenerationJob）
 *   - editImage(...)              — 圖編輯
 *   - upscaleImage(...)           — 圖放大
 *   - getImageModels(category?)   — 從 MODEL_PRICING_CATALOG 讀真實清單
 *   - recommendModel(intent, ...) — 給意圖（寫實／草稿／品牌…）→ 推薦最佳 modelId
 *   - enhancePrompt(prompt, ...)  — 短 prompt 擴寫成結構化 prompt
 *   - getImageGenerationTips()    — 場景化提示詞秘訣
 */

import { logger } from "../../_core/logger";
import {
  MODEL_PRICING_CATALOG,
  estimatePoints,
  getModelPricing,
  type ModelPricing,
} from "../modelPricing";

// ─── 出圖 / 編輯 / 放大 ────────────────────────────────────────────────────

/** Catalog 內預設的「無腦選一張」模型 — 已透過 catalog 驗證存在。 */
const DEFAULT_TEXT_TO_IMAGE_MODEL = "fal-ai/flux-pro/v1.1";
const DEFAULT_IMAGE_TO_IMAGE_MODEL = "fal-ai/flux-pro/kontext";
const DEFAULT_UPSCALE_MODEL = "fal-ai/aura-sr";

/**
 * Generate an image. modelId 預設用 catalog 真實的 flux-pro/v1.1；
 * 若 LLM 給的是別名（"flux-1.1-pro"）會由 generationJobDispatcher 內的
 * SPIRIT_TOOL_FAL_ALIAS 解析，不在這裡再做一層 mapping，免得跟 dispatcher 漂移。
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
  modelId?: string;
  estimatedPoints?: number;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const modelId = input.modelId || DEFAULT_TEXT_TO_IMAGE_MODEL;
    const numImages = Math.max(1, Math.min(8, input.numImages ?? 1));
    const estimate = estimatePoints(modelId, { imageCount: numImages });

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: input.prompt,
      modelId,
      params: {
        aspect_ratio: input.aspectRatio || "1:1",
        num_images: numImages,
        negative_prompt: input.negativePrompt,
        seed: input.seed,
      },
    });

    logger.info("image_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
      estimatedPoints: estimate.totalPoints,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId: result.modelId,
      estimatedPoints: estimate.totalPoints,
      message: `圖片生成已啟動（${result.modelId}，預估 ${estimate.totalPoints} 點）：作業 ID ${result.jobId}`,
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
  modelId?: string;
  estimatedPoints?: number;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const modelId = input.modelId || DEFAULT_IMAGE_TO_IMAGE_MODEL;
    const estimate = estimatePoints(modelId, { imageCount: 1 });

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: input.prompt,
      modelId,
      params: {
        image_url: input.imageUrl,
        strength: input.strength ?? 0.75,
        mask_url: input.maskUrl,
      },
    });

    logger.info("image_edit_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
      hasMask: !!input.maskUrl,
      estimatedPoints: estimate.totalPoints,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId: result.modelId,
      estimatedPoints: estimate.totalPoints,
      message: `圖片編輯已啟動（${result.modelId}，預估 ${estimate.totalPoints} 點）：作業 ID ${result.jobId}`,
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
  modelId?: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  modelId?: string;
  estimatedPoints?: number;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const modelId = input.modelId || DEFAULT_UPSCALE_MODEL;
    const estimate = estimatePoints(modelId, { imageCount: 1 });

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "image",
      prompt: "upscale",
      modelId,
      params: {
        image_url: input.imageUrl,
        scale_factor: input.scaleFactor || 2,
      },
    });

    logger.info("image_upscale_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
      scaleFactor: input.scaleFactor,
      estimatedPoints: estimate.totalPoints,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId: result.modelId,
      estimatedPoints: estimate.totalPoints,
      message: `圖片放大已啟動（${result.modelId}，預估 ${estimate.totalPoints} 點）：作業 ID ${result.jobId}`,
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

// ─── 從 catalog 讀真實模型清單 ─────────────────────────────────────────────

export type ImageModelCategory = "text-to-image" | "image-to-image" | "all";

export interface ImageModelInfo {
  modelId: string;
  label: string;
  provider: string;
  category: string;
  tier: string;
  basePoints: number;
  maxPoints: number;
  /** 對 imageCount=1 估算的點數，含 minPoints clamp，給 LLM 報價時直接使用。 */
  pointsForOneImage: number;
}

/**
 * 從 MODEL_PRICING_CATALOG 撈出真實的圖片模型清單，不再寫死過時別名。
 * category 可選 "text-to-image" / "image-to-image" / "all"（預設 all）。
 * 結果依 tier (free → ultra) → basePoints 遞增排序，最便宜放最前面。
 */
export function getImageModels(category: ImageModelCategory = "all"): {
  success: boolean;
  category: ImageModelCategory;
  count: number;
  models: ImageModelInfo[];
} {
  const TIER_RANK: Record<string, number> = {
    free: 0,
    economy: 1,
    standard: 2,
    premium: 3,
    ultra: 4,
  };

  const allowedCategories: Set<string> =
    category === "all"
      ? new Set(["text-to-image", "image-to-image"])
      : new Set([category]);

  const rows: ImageModelInfo[] = Object.values(MODEL_PRICING_CATALOG)
    .filter(p => allowedCategories.has(p.category))
    .map(p => ({
      modelId: p.modelId,
      label: p.label,
      provider: p.provider,
      category: p.category,
      tier: p.tier,
      basePoints: p.basePoints,
      maxPoints: p.maxPoints,
      pointsForOneImage: estimatePoints(p.modelId, { imageCount: 1 }).totalPoints,
    }))
    .sort((a, b) => {
      const tierDiff = (TIER_RANK[a.tier] ?? 99) - (TIER_RANK[b.tier] ?? 99);
      if (tierDiff !== 0) return tierDiff;
      return a.basePoints - b.basePoints;
    });

  return {
    success: true,
    category,
    count: rows.length,
    models: rows,
  };
}

// ─── 推薦模型：給意圖 → 挑最適合的 catalog modelId ─────────────────────────

export type ImageIntent =
  | "realistic"   // 寫實 / 攝影 / 商業
  | "draft"       // 草稿 / 快迭代 / 點數最低
  | "illustration"// 插畫 / 海報 / 東方風
  | "brand"       // 品牌 / 乾淨光 / 設計感
  | "lora"        // 要套 LoRA
  | "edit"        // 圖編輯 / inpaint
  | "upscale"     // 圖片放大
  | "text-design" // 文字設計 / logo / 海報含字
  | "anatomy"     // 人體 / 解剖 / 醫學插圖
  | "anime";      // 動漫風

export interface RecommendModelResult {
  intent: ImageIntent;
  /** 主推 — 第一個 fallback 用主推；找不到再退到 generic. */
  recommendation: {
    modelId: string;
    label: string;
    provider: string;
    tier: string;
    pointsForOneImage: number;
    reasoning: string;
  };
  /** 同類別下其他選項，按性價比排序最多 3 個。 */
  alternatives: Array<{
    modelId: string;
    label: string;
    tier: string;
    pointsForOneImage: number;
    reasoning: string;
  }>;
}

interface IntentRule {
  intent: ImageIntent;
  /** 候選 modelId 列表（依推薦順序，第一個是主推；若不在 catalog 會跳過）。 */
  candidates: string[];
  /** 主推為什麼選它。 */
  reasoning: string;
  /** 替代品的通用 reason；對每個 alt 會與其 tier label 拼接。 */
  altReasoningPrefix: string;
}

const INTENT_RULES: Record<ImageIntent, IntentRule> = {
  realistic: {
    intent: "realistic",
    candidates: [
      "fal-ai/flux-pro/v1.1",
      "fal-ai/flux/dev",
      "gemini/imagen-3",
      "fal-ai/imagen4/preview",
    ],
    reasoning: "寫實 / 商業 / 光影層次 — FLUX Pro 1.1 是寫實最穩的選擇",
    altReasoningPrefix: "寫實感",
  },
  draft: {
    intent: "draft",
    candidates: [
      "fal-ai/flux/schnell",
      "fal-ai/fast-sdxl",
      "gemini/imagen-3-fast",
    ],
    reasoning: "草稿 / 快迭代 — Schnell 約 1 點 / 張，便宜到可以連抽 8 張挑",
    altReasoningPrefix: "草稿用",
  },
  illustration: {
    intent: "illustration",
    candidates: [
      "fal-ai/bytedance/seedream/v4/text-to-image",
      "fal-ai/aura-flow",
      "fal-ai/stable-diffusion-v3-medium",
    ],
    reasoning: "插畫 / 海報 / 東方風 — SeeDream v4 對水墨 / 東方審美最對味",
    altReasoningPrefix: "插畫感",
  },
  brand: {
    intent: "brand",
    candidates: [
      "fal-ai/imagen4/preview",
      "gemini/imagen-3",
      "fal-ai/flux-pro/v1.1",
    ],
    reasoning: "品牌 / 乾淨光 / 設計感 — Imagen 4 出來的光線質感最像產品照",
    altReasoningPrefix: "品牌感",
  },
  lora: {
    intent: "lora",
    candidates: [
      "fal-ai/stable-diffusion-v35-large",
      "fal-ai/lora",
    ],
    reasoning: "要套 LoRA — SD 3.5 Large 對 LoRA 兼容度最高，trigger word 一貼就有效",
    altReasoningPrefix: "也吃 LoRA",
  },
  edit: {
    intent: "edit",
    candidates: [
      "fal-ai/flux-pro/kontext",
      "fal-ai/bytedance/seedream/v4.5/edit",
      "fal-ai/nano-banana-pro/edit",
      "fal-ai/gpt-image-1.5/edit",
    ],
    reasoning: "語意式圖編輯 — FLUX Kontext 對「保留主體只改背景」這類指令最聽話",
    altReasoningPrefix: "圖編輯",
  },
  upscale: {
    intent: "upscale",
    candidates: [
      "fal-ai/aura-sr",
      "fal-ai/seedvr/upscale/image",
    ],
    reasoning: "圖片放大 — AuraSR 約 1 點 / 張，2x~4x 都穩定不糊",
    altReasoningPrefix: "放大",
  },
  "text-design": {
    intent: "text-design",
    candidates: [
      "fal-ai/ideogram/v2",
      "fal-ai/imagen4/preview",
    ],
    reasoning: "海報 / logo / 文字渲染 — Ideogram v2 是目前能把字寫對最穩的模型",
    altReasoningPrefix: "也能寫字",
  },
  anatomy: {
    intent: "anatomy",
    candidates: [
      "fal-ai/flux-pro/v1.1",
      "fal-ai/stable-diffusion-v35-large",
    ],
    reasoning: "解剖 / 醫學插圖 — FLUX Pro 1.1 的人體結構精準度最高，建議 batch=3-4 挑最準的",
    altReasoningPrefix: "解剖",
  },
  anime: {
    intent: "anime",
    candidates: [
      "fal-ai/bytedance/seedream/v4/text-to-image",
      "fal-ai/stable-diffusion-v35-large",
      "fal-ai/aura-flow",
    ],
    reasoning: "動漫 / 二次元 — SeeDream v4 與 SD3.5 都吃 anime LoRA，先試 SeeDream 不用 LoRA 就有味",
    altReasoningPrefix: "動漫感",
  },
};

/**
 * 給定使用者意圖，從 catalog 內挑出最適合的 modelId + 同類別下的替代品。
 * 永遠回傳 catalog 內真的存在的 modelId（candidates 中找不到時跳到下一個）。
 * 若所有 candidates 都跑掉了，退到 DEFAULT_TEXT_TO_IMAGE_MODEL。
 */
export function recommendModel(input: {
  intent: ImageIntent;
  /** 任意自由描述，目前用來做 reasoning 文案 personalisation；未來可以做關鍵字 boost。 */
  useCase?: string;
}): { success: boolean; result: RecommendModelResult } {
  const rule = INTENT_RULES[input.intent];
  const candidates = (rule?.candidates ?? []).filter(id => getModelPricing(id));

  const headId = candidates[0] ?? DEFAULT_TEXT_TO_IMAGE_MODEL;
  const head = getModelPricing(headId) as ModelPricing;
  const headPoints = estimatePoints(head.modelId, { imageCount: 1 }).totalPoints;

  const altList = candidates.slice(1, 4).map(id => {
    const p = getModelPricing(id) as ModelPricing;
    return {
      modelId: p.modelId,
      label: p.label,
      tier: p.tier,
      pointsForOneImage: estimatePoints(p.modelId, { imageCount: 1 }).totalPoints,
      reasoning: `${rule.altReasoningPrefix}，${p.tier} tier，約 ${estimatePoints(p.modelId, { imageCount: 1 }).totalPoints} 點 / 張`,
    };
  });

  return {
    success: true,
    result: {
      intent: input.intent,
      recommendation: {
        modelId: head.modelId,
        label: head.label,
        provider: head.provider,
        tier: head.tier,
        pointsForOneImage: headPoints,
        reasoning: rule?.reasoning ?? "Catalog 預設 — 平衡品質與成本",
      },
      alternatives: altList,
    },
  };
}

// ─── Prompt 擴寫：短句 → 結構化長 prompt ──────────────────────────────────

export type PromptStyle =
  | "photoreal"
  | "cinematic"
  | "anime"
  | "watercolor"
  | "oil-painting"
  | "3d-render"
  | "vector"
  | "minimal";

export type PromptMood =
  | "warm"
  | "cool"
  | "dramatic"
  | "soft"
  | "vibrant"
  | "moody";

export interface EnhancePromptResult {
  original: string;
  enhanced: string;
  /** 加上的維度，給 LLM 解釋給使用者看為什麼這版比較強。 */
  addedDimensions: string[];
  /** 若使用者沒指定 aspect / mood，會給推薦值。 */
  suggestedAspect: string;
  suggestedNegative: string;
}

const STYLE_LEXICON: Record<PromptStyle, { keywords: string; camera?: string }> = {
  photoreal: {
    keywords: "photorealistic, 85mm lens, shallow depth of field, ultra detailed",
    camera: "85mm portrait lens, f/1.8",
  },
  cinematic: {
    keywords: "cinematic lighting, anamorphic lens flare, film grain, color graded",
    camera: "anamorphic 2.39:1 framing",
  },
  anime: {
    keywords: "anime illustration, clean lineart, cel shaded, vibrant palette",
  },
  watercolor: {
    keywords: "watercolor painting, soft wash, paper texture, hand-painted feel",
  },
  "oil-painting": {
    keywords: "oil painting, thick brush strokes, classical composition, museum quality",
  },
  "3d-render": {
    keywords: "octane render, ray traced, subsurface scattering, ultra high detail",
  },
  vector: {
    keywords: "flat vector illustration, geometric shapes, clean palette, minimal shading",
  },
  minimal: {
    keywords: "minimal composition, negative space, monochrome palette, geometric",
  },
};

const MOOD_LEXICON: Record<PromptMood, string> = {
  warm: "warm golden tones, soft afternoon light",
  cool: "cool blue palette, overcast atmospheric light",
  dramatic: "dramatic side lighting, deep shadows, high contrast",
  soft: "soft diffuse light, dreamy atmosphere, gentle gradient",
  vibrant: "vibrant saturated colors, energetic composition",
  moody: "moody low-key lighting, cinematic shadows, mysterious vibe",
};

// Order matters: more-specific needles first. "story" wins over "ig" for
// "IG story" → 9:16, even though both substrings match.
const ASPECT_BY_USE: Array<[string, string]> = [
  ["story", "9:16"],
  ["reel", "9:16"],
  ["tiktok", "9:16"],
  ["youtube", "16:9"],
  ["banner", "16:9"],
  ["poster", "3:4"],
  ["instagram", "1:1"],
  ["ig", "1:1"],
];

/**
 * 把短句擴寫成結構化長 prompt — 主體 + 動作 + 場景 + 光線 + 風格 + 鏡頭 + 質感。
 * 不會偷加使用者沒指定的內容（例如人臉細節 / 商標）— 只補通用美學維度。
 */
export function enhancePrompt(input: {
  prompt: string;
  style?: PromptStyle;
  mood?: PromptMood;
  /** 自由用途字串（"IG 限動" / "海報" / "YouTube" …），會 map 到推薦 aspect。 */
  useCase?: string;
}): { success: boolean; result: EnhancePromptResult } {
  const original = input.prompt.trim();
  const parts: string[] = [original];
  const dimensions: string[] = [];

  if (input.style) {
    const lex = STYLE_LEXICON[input.style];
    if (lex) {
      parts.push(lex.keywords);
      dimensions.push(`style:${input.style}`);
      if (lex.camera) {
        parts.push(lex.camera);
        dimensions.push("camera");
      }
    }
  }
  if (input.mood) {
    const moodLine = MOOD_LEXICON[input.mood];
    if (moodLine) {
      parts.push(moodLine);
      dimensions.push(`mood:${input.mood}`);
    }
  }

  // 通用補強（只在使用者沒寫過時加）
  const lowered = original.toLowerCase();
  if (!/composition|構圖|rule of thirds/.test(lowered)) {
    parts.push("balanced composition, rule of thirds");
    dimensions.push("composition");
  }
  if (!/quality|detail|高細節|質感/.test(lowered)) {
    parts.push("highly detailed, professional quality");
    dimensions.push("quality");
  }

  // 推薦 aspect — 走有序的清單，較具體的關鍵字（story / poster）優先
  // 蓋過泛用的（ig / instagram）。對「IG story」這種混合會選 9:16。
  let suggestedAspect = "1:1";
  if (input.useCase) {
    const k = input.useCase.toLowerCase();
    for (const [needle, aspect] of ASPECT_BY_USE) {
      if (k.includes(needle)) {
        suggestedAspect = aspect;
        break;
      }
    }
  }

  // Negative prompt baseline — 通用通用排除
  const suggestedNegative =
    "low quality, blurry, distorted, extra fingers, deformed, watermark, signature, text artifacts";

  return {
    success: true,
    result: {
      original,
      enhanced: parts.join(", "),
      addedDimensions: dimensions,
      suggestedAspect,
      suggestedNegative,
    },
  };
}

// ─── Tips（保留原本場景化提示詞秘訣） ─────────────────────────────────────

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
    "要重複出同一角色 → 一定鎖 seed，或先去 /models 訓 LoRA",
    "預算敏感的草稿 → 先 Schnell 連抽 4-8 張挑方向，鎖定後再升 FLUX Pro",
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
    anatomy: [
      "永遠用精確學術名稱：anterior view / posterior view / lateral view",
      "標明系統：skeletal / muscular / nervous / circulatory",
      "加 educational purpose, labeled diagram, medical textbook style",
      "建議 batch=3-4 張挑解剖最準的",
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
