/**
 * falModelCapabilities.ts — fal.ai 模型能力矩陣
 *
 * 用途：標註每個 fal 模型支援哪些工作室功能。前端 useEnsureCompatibleModel
 * 在使用者啟用某個功能（自注意力 token 權重、LoRA 注入、特殊比例）時會
 * 檢查當前 modelId 是否相容，否則自動切到清單中第一個相容的模型並 toast。
 *
 * 也用於工具箱模型選單上的「能力徽章」（綠燈 = 支援、灰 = 不支援）。
 */

export type ModalityCategory = "image" | "video" | "audio" | "voice";

export interface FalModelCapabilityFeatures {
  /** 接受 (token:1.2) 加權提示語法（多為 SD 系模型） */
  tokenWeights: boolean;
  /** 接受 lora_path / loraUrl 注入 */
  loraInjection: boolean;
  /** 接受寬螢幕比例（21:9 / 32:9） */
  aspectRatioWide: boolean;
  /** 接受傳統比例（4:3 / 3:2） */
  aspectRatioStandard: boolean;
  /** 接受負面提示詞 */
  negativePrompt: boolean;
  /** 接受 seed 參數 */
  seed: boolean;
}

export interface FalModelCapability {
  modelId: string;
  modality: ModalityCategory;
  features: FalModelCapabilityFeatures;
}

const NONE: FalModelCapabilityFeatures = {
  tokenWeights: false,
  loraInjection: false,
  aspectRatioWide: false,
  aspectRatioStandard: false,
  negativePrompt: false,
  seed: false,
};

const ALL_IMAGE_FEATURES: FalModelCapabilityFeatures = {
  tokenWeights: true,
  loraInjection: true,
  aspectRatioWide: true,
  aspectRatioStandard: true,
  negativePrompt: true,
  seed: true,
};

/** 模型能力清單（依模型族系群組） */
export const FAL_MODEL_CAPABILITIES: FalModelCapability[] = [
  // ─── Stable Diffusion 系（完整支援自注意力 + LoRA） ──
  {
    modelId: "fal-ai/lora",
    modality: "image",
    features: { ...ALL_IMAGE_FEATURES, aspectRatioWide: false }, // image_size 而非 aspect_ratio
  },
  {
    modelId: "fal-ai/stable-diffusion-v35-large",
    modality: "image",
    features: ALL_IMAGE_FEATURES,
  },
  {
    modelId: "fal-ai/fast-sdxl",
    modality: "image",
    features: { ...ALL_IMAGE_FEATURES, aspectRatioWide: false },
  },

  // ─── FLUX 系（部分支援 LoRA，不解析 token weight 語法） ──
  {
    modelId: "fal-ai/flux/dev",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: true,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: false,
      seed: true,
    },
  },
  {
    modelId: "fal-ai/flux/schnell",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: false,
      seed: true,
    },
  },
  {
    modelId: "fal-ai/flux-pro/v1.1",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: false,
      seed: true,
    },
  },

  // ─── Gemini Nano-Banana 系（不解析 token weight，廣比例） ──
  {
    modelId: "fal-ai/nano-banana-2",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: false,
      seed: true,
    },
  },
  {
    modelId: "fal-ai/nano-banana-pro",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: false,
      seed: true,
    },
  },

  // ─── ByteDance SeeDream 系 ──
  {
    modelId: "fal-ai/bytedance/seedream/v4/text-to-image",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: true,
      aspectRatioStandard: true,
      negativePrompt: true,
      seed: true,
    },
  },

  // ─── Google Imagen 系（標準比例only） ──
  {
    modelId: "fal-ai/imagen4/preview",
    modality: "image",
    features: {
      tokenWeights: false,
      loraInjection: false,
      aspectRatioWide: false,
      aspectRatioStandard: true,
      negativePrompt: true,
      seed: true,
    },
  },

  // ─── 圖片編輯（語意式 edit）── 一律無 LoRA / token weight
  // edit 模型的 input 為 image_url + prompt，aspectRatio 由原圖決定，故 wide/standard 皆 false
  {
    modelId: "fal-ai/nano-banana-pro/edit",
    modality: "image",
    features: { ...NONE, seed: false },
  },
  {
    modelId: "fal-ai/nano-banana/edit",
    modality: "image",
    features: { ...NONE, seed: false },
  },
  {
    modelId: "fal-ai/nano-banana-2/edit",
    modality: "image",
    features: { ...NONE, aspectRatioWide: true, aspectRatioStandard: true, seed: false },
  },
  {
    modelId: "fal-ai/bytedance/seedream/v4.5/edit",
    modality: "image",
    features: { ...NONE, negativePrompt: true, seed: true },
  },
  {
    modelId: "fal-ai/bytedance/seedream/v5/lite/edit",
    modality: "image",
    features: { ...NONE, negativePrompt: true, seed: true },
  },
  {
    modelId: "xai/grok-imagine-image/edit",
    modality: "image",
    features: { ...NONE, seed: false },
  },
  {
    modelId: "fal-ai/gpt-image-1.5/edit",
    modality: "image",
    features: { ...NONE, seed: false },
  },
  {
    modelId: "fal-ai/flux-pro/kontext",
    modality: "image",
    features: { ...NONE, seed: true },
  },
  {
    modelId: "fal-ai/flux-2-pro/edit",
    modality: "image",
    features: { ...NONE, seed: true },
  },

  // ─── Video 系（一律無 token weight、無 LoRA） ──
  {
    modelId: "fal-ai/kling-video/v2.1/pro/text-to-video",
    modality: "video",
    features: { ...NONE, aspectRatioWide: true, aspectRatioStandard: true, seed: true },
  },
  {
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    modality: "video",
    features: { ...NONE, aspectRatioWide: true, aspectRatioStandard: true, seed: true },
  },
  {
    modelId: "fal-ai/wan-t2v",
    modality: "video",
    features: { ...NONE, aspectRatioWide: true, aspectRatioStandard: true, seed: true },
  },

  // ─── Audio / Voice ──
  {
    modelId: "fal-ai/ace-step",
    modality: "audio",
    features: NONE,
  },
  {
    modelId: "fal-ai/stable-audio",
    modality: "audio",
    features: NONE,
  },
  {
    modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
    modality: "voice",
    features: NONE,
  },
];

/** 取得單一模型的能力描述 */
export function getModelCapability(modelId: string): FalModelCapability | null {
  return FAL_MODEL_CAPABILITIES.find(c => c.modelId === modelId) ?? null;
}

/** 取得單一功能旗標（找不到模型回 false） */
export function getModelFeature(
  modelId: string,
  feature: keyof FalModelCapabilityFeatures
): boolean {
  const cap = getModelCapability(modelId);
  return cap?.features[feature] ?? false;
}

/** 主動使用中的功能集合（前端 hook 計算後傳入） */
export interface ActiveFeatureSet {
  tokenWeights?: boolean;
  loraInjection?: boolean;
  aspectRatioWide?: boolean;
  aspectRatioStandard?: boolean;
  negativePrompt?: boolean;
}

/** 給定當前模型與啟用的功能集合，回傳是否 100% 相容 */
export function isModelCompatibleWith(
  modelId: string,
  activeFeatures: ActiveFeatureSet
): boolean {
  const cap = getModelCapability(modelId);
  if (!cap) return true; // 未知模型不阻止使用者，僅 UI 端不顯示徽章
  for (const [feature, enabled] of Object.entries(activeFeatures) as Array<
    [keyof FalModelCapabilityFeatures, boolean | undefined]
  >) {
    if (enabled && !cap.features[feature]) return false;
  }
  return true;
}

/** 找出目前啟用的功能下，第一個相容的同模態模型（用於自動切換） */
export function findCompatibleModel(
  modality: ModalityCategory,
  activeFeatures: ActiveFeatureSet
): string | null {
  const candidate = FAL_MODEL_CAPABILITIES.find(
    c =>
      c.modality === modality &&
      isModelCompatibleWith(c.modelId, activeFeatures)
  );
  return candidate?.modelId ?? null;
}

/** 列出與當前模型不相容的功能名稱（用於 UI 警示） */
export function listIncompatibleFeatures(
  modelId: string,
  activeFeatures: ActiveFeatureSet
): Array<keyof FalModelCapabilityFeatures> {
  const cap = getModelCapability(modelId);
  if (!cap) return [];
  const out: Array<keyof FalModelCapabilityFeatures> = [];
  for (const [feature, enabled] of Object.entries(activeFeatures) as Array<
    [keyof FalModelCapabilityFeatures, boolean | undefined]
  >) {
    if (enabled && !cap.features[feature]) out.push(feature);
  }
  return out;
}

/** 人類可讀的功能名稱（用於 toast 與 UI 徽章） */
export const FEATURE_LABELS: Record<keyof FalModelCapabilityFeatures, string> = {
  tokenWeights: "自注意力（Token 權重）",
  loraInjection: "微調模型（LoRA）",
  aspectRatioWide: "寬螢幕比例（21:9）",
  aspectRatioStandard: "標準比例（4:3 / 3:2）",
  negativePrompt: "負面提示詞",
  seed: "隨機種子",
};
