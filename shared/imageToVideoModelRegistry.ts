export interface ImageToVideoModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
}

/**
 * 全站光球代理可共用的「圖生影模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞語意先做 rule-based 初步選模。
 * 2) 讓 planner prompt 可插入模型能力描述，降低 setModel 幻覺。
 */
export const IMAGE_TO_VIDEO_MODEL_REGISTRY: readonly ImageToVideoModelProfile[] = [
  {
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    label: "Kling 2.1 Pro I2V",
    provider: "fal",
    strengths: ["動作穩定", "鏡頭感", "電影感運鏡", "寫實場景"],
    avoidWhen: ["極速預覽", "超短時間草稿"],
    promptKeywords: ["cinematic", "camera move", "realistic", "slow motion", "dramatic"],
  },
  {
    modelId: "fal-ai/runway-gen3/turbo/image-to-video",
    label: "Runway Gen-3 Turbo I2V",
    provider: "fal",
    strengths: ["速度快", "社群短片", "快速迭代", "廣告分鏡測試"],
    avoidWhen: ["極致細節", "長鏡頭敘事一致性"],
    promptKeywords: ["fast", "social", "quick", "teaser", "promo"],
  },
];

export interface ImageToVideoModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankImageToVideoModelsByPrompt(prompt: string): ImageToVideoModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = IMAGE_TO_VIDEO_MODEL_REGISTRY.map(model => {
    const matchedKeywords = model.promptKeywords.filter(keyword => normalized.includes(keyword));
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      rationale: score > 0
        ? `命中關鍵詞: ${matchedKeywords.join(", ")}`
        : "無直接關鍵詞命中，保留為備選",
    };
  });

  return matches.sort((a, b) => b.score - a.score);
}

export function pickBestImageToVideoModel(prompt: string): ImageToVideoModelMatch {
  const [best] = rankImageToVideoModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到全能預設模型 Kling 2.1 Pro I2V",
  };
}
