export interface TextToImageModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
}

/**
 * 全站光球代理可共用的「文字生圖模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞語意先做 rule-based 初步選模。
 * 2) 讓 planner prompt 可以插入模型能力描述，降低 setModel 幻覺。
 */
export const TEXT_TO_IMAGE_MODEL_REGISTRY: readonly TextToImageModelProfile[] = [
  {
    modelId: "fal-ai/flux-pro/v1.1",
    label: "FLUX Pro 1.1",
    provider: "fal",
    strengths: ["寫實", "高細節", "商業視覺", "文字排版穩定"],
    avoidWhen: ["低延遲", "極速草稿"],
    promptKeywords: ["photoreal", "realistic", "cinematic", "product shot", "advertising"],
  },
  {
    modelId: "fal-ai/flux/schnell",
    label: "FLUX Schnell",
    provider: "fal",
    strengths: ["快速", "草稿", "低延遲"],
    avoidWhen: ["極高細節", "複雜排版文字"],
    promptKeywords: ["quick", "draft", "fast", "concept", "thumbnail"],
  },
  {
    modelId: "fal-ai/stable-diffusion-v35-large",
    label: "SD 3.5 Large",
    provider: "fal",
    strengths: ["LoRA", "負面提示詞", "可控性高"],
    avoidWhen: ["只求極速"],
    promptKeywords: ["lora", "style transfer", "negative prompt", "masterpiece", "illustration"],
  },
  {
    modelId: "fal-ai/bytedance/seedream/v4/text-to-image",
    label: "SeeDream v4",
    provider: "fal",
    strengths: ["東方審美", "海報", "插畫"],
    avoidWhen: ["嚴格品牌字體控制"],
    promptKeywords: ["poster", "anime", "illustration", "chinese style", "oriental"],
  },
  {
    modelId: "fal-ai/imagen4/preview",
    label: "Imagen 4 Preview",
    provider: "fal",
    strengths: ["構圖穩定", "乾淨光影", "品牌感"],
    avoidWhen: ["實驗性 LoRA"],
    promptKeywords: ["clean", "minimal", "brand", "studio lighting", "editorial"],
  },
];


export function summarizeTextToImageModelRegistry(limit = 12): string {
  const items = TEXT_TO_IMAGE_MODEL_REGISTRY.slice(0, Math.max(1, limit)).map(model => ({
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    strengths: model.strengths,
    avoidWhen: model.avoidWhen,
    promptKeywords: model.promptKeywords,
  }));

  return JSON.stringify({
    total: TEXT_TO_IMAGE_MODEL_REGISTRY.length,
    items,
    selectionPolicy: {
      matcher: "keyword-overlap",
      fallbackModelId: "fal-ai/flux-pro/v1.1",
      note: "When no keywords match, fallback to a general-purpose model.",
    },
  });
}

export interface TextToImageModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function rankTextToImageModelsByPrompt(prompt: string): TextToImageModelMatch[] {
  const normalized = prompt.toLowerCase();
  const matches = TEXT_TO_IMAGE_MODEL_REGISTRY.map(model => {
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

export function pickBestTextToImageModel(prompt: string): TextToImageModelMatch {
  const [best] = rankTextToImageModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  return {
    modelId: "fal-ai/flux-pro/v1.1",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到全能預設模型 FLUX Pro 1.1",
  };
}
