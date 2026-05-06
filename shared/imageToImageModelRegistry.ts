export interface ImageToImageModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  category: "control" | "upscale" | "edit" | "pose" | "style-transfer";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
}

/**
 * 全站光球代理可共用的「圖生圖 / 進階控制模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞語意先做 rule-based 初步選模（ControlNet、姿勢、深度等）。
 * 2) 讓 planner prompt 可以插入模型能力描述，降低 setModel 幻覺。
 * 3) 涵蓋進階控制模型：ControlNet、姿勢偵測、深度感知、風格遷移、臉部ID等。
 */
export const IMAGE_TO_IMAGE_MODEL_REGISTRY: readonly ImageToImageModelProfile[] = [
  // ══════════════════════════════════════════════════════════
  // 進階控制模型 (Advanced Control)
  // ══════════════════════════════════════════════════════════
  {
    modelId: "fal-ai/flux/dev/controlnet",
    label: "Flux ControlNet",
    provider: "fal",
    category: "control",
    strengths: ["姿勢控制", "深度感知", "邊緣偵測", "結構保留"],
    avoidWhen: ["完全自由生成", "不需結構控制"],
    promptKeywords: ["controlnet", "pose", "depth", "edge", "structure", "layout", "composition"],
  },
  {
    modelId: "fal-ai/dwpose",
    label: "DWPose 骨骼姿勢偵測",
    provider: "fal",
    category: "pose",
    strengths: ["骨骼提取", "姿勢識別", "手部偵測", "臉部關鍵點"],
    avoidWhen: ["不需姿勢控制", "風景靜物"],
    promptKeywords: ["pose", "skeleton", "body", "hands", "face", "keypoints", "posture"],
  },

  // ══════════════════════════════════════════════════════════
  // 風格遷移與編輯 (Style Transfer & Editing)
  // ══════════════════════════════════════════════════════════
  {
    modelId: "fal-ai/flux/dev/image-to-image",
    label: "Flux Dev i2i",
    provider: "fal",
    category: "style-transfer",
    strengths: ["風格轉換", "細節保留", "結構維持", "藝術風格化"],
    avoidWhen: ["需要完全重繪", "極端變形"],
    promptKeywords: ["style", "transform", "artistic", "painting", "illustration", "reimagine"],
  },
  {
    modelId: "fal-ai/stable-diffusion-v3-medium/image-to-image",
    label: "SD3 Medium i2i",
    provider: "fal",
    category: "style-transfer",
    strengths: ["通用編輯", "負面提示詞", "可控性"],
    avoidWhen: ["極高品質要求", "商業級輸出"],
    promptKeywords: ["edit", "modify", "change", "adjust", "refine", "negative prompt"],
  },
  {
    modelId: "fal-ai/ip-adapter-face-id",
    label: "IP-Adapter FaceID",
    provider: "fal",
    category: "style-transfer",
    strengths: ["臉部保留", "身分一致", "風格遷移", "人物替換"],
    avoidWhen: ["非人物主體", "不需臉部保留"],
    promptKeywords: ["face", "identity", "character", "portrait", "person", "facial"],
  },

  // ══════════════════════════════════════════════════════════
  // 實用工具 (Utilities)
  // ══════════════════════════════════════════════════════════
  {
    modelId: "fal-ai/imageutils/rembg",
    label: "RemBG 去背",
    provider: "fal",
    category: "edit",
    strengths: ["背景移除", "快速", "智能分離", "批次處理"],
    avoidWhen: ["複雜背景前景混合", "需要精細邊緣"],
    promptKeywords: ["remove background", "transparent", "cutout", "isolation", "background removal"],
  },
];

export function summarizeImageToImageModelRegistry(limit = 12): string {
  const items = IMAGE_TO_IMAGE_MODEL_REGISTRY.slice(0, Math.max(1, limit)).map(model => ({
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    category: model.category,
    strengths: model.strengths,
    avoidWhen: model.avoidWhen,
    promptKeywords: model.promptKeywords,
  }));

  return JSON.stringify({
    total: IMAGE_TO_IMAGE_MODEL_REGISTRY.length,
    items,
    selectionPolicy: {
      matcher: "keyword-overlap + category-awareness",
      fallbackModelId: "fal-ai/flux/dev/image-to-image",
      note: "Choose based on task: control (ControlNet/pose) → style-transfer (i2i) → edit (RemBG). Fallback to Flux Dev i2i for general editing.",
    },
  });
}

export interface ImageToImageModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
  category: ImageToImageModelProfile["category"];
}

export function rankImageToImageModelsByPrompt(prompt: string): ImageToImageModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = IMAGE_TO_IMAGE_MODEL_REGISTRY.map(model => {
    const matchedKeywords = model.promptKeywords.filter(keyword => normalized.includes(keyword));
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      category: model.category,
      rationale: score > 0
        ? `命中關鍵詞: ${matchedKeywords.join(", ")}`
        : "無直接關鍵詞命中，保留為備選",
    };
  });

  return matches.sort((a, b) => b.score - a.score);
}

export function pickBestImageToImageModel(prompt: string): ImageToImageModelMatch {
  const [best] = rankImageToImageModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  // Fallback: 根據提示詞類型選擇預設模型
  const normalized = prompt.toLowerCase();

  // 如果提到去背相關
  if (normalized.includes("background") || normalized.includes("transparent") || normalized.includes("去背")) {
    return {
      modelId: "fal-ai/imageutils/rembg",
      score: 0,
      matchedKeywords: [],
      category: "edit",
      rationale: "提到背景處理，回退到 RemBG 去背工具",
    };
  }

  // 如果提到姿勢或骨骼
  if (normalized.includes("pose") || normalized.includes("姿勢") || normalized.includes("骨骼")) {
    return {
      modelId: "fal-ai/dwpose",
      score: 0,
      matchedKeywords: [],
      category: "pose",
      rationale: "提到姿勢相關，回退到 DWPose 姿勢偵測",
    };
  }

  // 如果提到控制、結構、佈局
  if (normalized.includes("control") || normalized.includes("structure") || normalized.includes("layout") ||
      normalized.includes("控制") || normalized.includes("結構") || normalized.includes("佈局")) {
    return {
      modelId: "fal-ai/flux/dev/controlnet",
      score: 0,
      matchedKeywords: [],
      category: "control",
      rationale: "提到控制相關，回退到 Flux ControlNet",
    };
  }

  // 預設：通用圖生圖
  return {
    modelId: "fal-ai/flux/dev/image-to-image",
    score: 0,
    matchedKeywords: [],
    category: "style-transfer",
    rationale: "未命中任何關鍵詞，回退到全能預設模型 Flux Dev i2i",
  };
}
