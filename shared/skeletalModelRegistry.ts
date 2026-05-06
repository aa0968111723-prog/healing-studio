export interface SkeletalModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  category: "image-to-3d" | "image-to-world";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
}

/**
 * 全站光球代理可共用的「骨骼 / 3D 模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞內容，先做規則式模型分流。
 * 2) 讓 planner / agent 在回答「用哪個 3D 模型」時可引用統一資料來源。
 */
export const SKELETAL_MODEL_REGISTRY: readonly SkeletalModelProfile[] = [
  {
    modelId: "fal-ai/trellis-2",
    label: "Trellis 2",
    provider: "fal",
    category: "image-to-3d",
    strengths: ["高細節", "角色雕塑", "拓樸穩定"],
    avoidWhen: ["超大場景", "極速預覽"],
    promptKeywords: ["character", "statue", "sculpt", "hero asset", "high detail"],
  },
  {
    modelId: "fal-ai/sam-3/3d-objects",
    label: "SAM 3D Objects",
    provider: "fal",
    category: "image-to-3d",
    strengths: ["單物件", "乾淨輪廓", "商品建模"],
    avoidWhen: ["複雜多物件", "大範圍場景"],
    promptKeywords: ["single object", "product", "clean silhouette", "turntable"],
  },
  {
    modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
    label: "Hunyuan3D v3",
    provider: "fal",
    category: "image-to-3d",
    strengths: ["泛用", "速度平衡", "角色與道具皆可"],
    avoidWhen: ["極限寫實紋理"],
    promptKeywords: ["prop", "game asset", "stylized", "balanced"],
  },
  {
    modelId: "fal-ai/hyper3d/rodin",
    label: "Hyper3D Rodin",
    provider: "fal",
    category: "image-to-3d",
    strengths: ["快速迭代", "概念驗證", "低門檻"],
    avoidWhen: ["最終交付級細節"],
    promptKeywords: ["quick 3d", "concept", "draft mesh", "blockout"],
  },
  {
    modelId: "fal-ai/hunyuan_world/image-to-world",
    label: "Hunyuan World",
    provider: "fal",
    category: "image-to-world",
    strengths: ["場景生成", "環境佈局", "世界觀草圖"],
    avoidWhen: ["單角色精雕"],
    promptKeywords: ["environment", "world", "scene", "terrain", "level layout"],
  },
];

export interface SkeletalModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankSkeletalModelsByPrompt(prompt: string): SkeletalModelMatch[] {
  const normalized = prompt.toLowerCase();

  return SKELETAL_MODEL_REGISTRY.map(model => {
    const matchedKeywords = model.promptKeywords.filter(keyword => normalized.includes(keyword));
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      rationale: score > 0 ? `命中關鍵詞: ${matchedKeywords.join(", ")}` : "無直接關鍵詞命中，保留為備選",
    };
  }).sort((a, b) => b.score - a.score);
}

export function pickBestSkeletalModel(prompt: string): SkeletalModelMatch {
  const [best] = rankSkeletalModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到泛用預設 Hunyuan3D v3",
  };
}
