export interface ImageUpscaleModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
}

/**
 * 全站光球代理可共用的「影像放大模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能先依提示詞語意做 rule-based 初步選模。
 * 2) 讓 planner / system prompt 可注入模型能力與限制，降低錯誤 setModel。
 */
export const IMAGE_UPSCALE_MODEL_REGISTRY: readonly ImageUpscaleModelProfile[] = [
  {
    modelId: "fal-ai/seedvr/upscale/image",
    label: "SeedVR Upscale",
    provider: "fal",
    strengths: ["真實照片", "高品質放大", "細節修復", "支援目標解析度"],
    avoidWhen: ["只求最低成本", "極速批次草稿"],
    promptKeywords: [
      "4k",
      "8k",
      "high quality",
      "photoreal",
      "restore detail",
      "enhance",
      "sharpen",
      "realistic",
    ],
  },
  {
    modelId: "fal-ai/aura-sr",
    label: "AuraSR",
    provider: "fal",
    strengths: ["快速", "通用超解析", "批次預覽"],
    avoidWhen: ["重度壓縮雜訊修復", "精準目標解析度控制"],
    promptKeywords: ["fast", "quick", "preview", "draft", "batch", "general upscaling"],
  },
];

export interface ImageUpscaleModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankImageUpscaleModelsByPrompt(prompt: string): ImageUpscaleModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = IMAGE_UPSCALE_MODEL_REGISTRY.map(model => {
    const matchedKeywords = model.promptKeywords.filter(keyword => normalized.includes(keyword));
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      rationale: score > 0 ? `命中關鍵詞: ${matchedKeywords.join(", ")}` : "無直接關鍵詞命中，保留為備選",
    };
  });

  return matches.sort((a, b) => b.score - a.score);
}

export function pickBestImageUpscaleModel(prompt: string): ImageUpscaleModelMatch {
  const [best] = rankImageUpscaleModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "fal-ai/seedvr/upscale/image",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到全能預設模型 SeedVR Upscale",
  };
}
