export type FineTuneModelProvider = "fal" | "replicate";

export interface FineTuneModelProfile {
  modelId: string;
  label: string;
  provider: FineTuneModelProvider;
  trainingTypes: string[];
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
  typicalDurationMinutes: [number, number];
}

/**
 * 全站光球代理可共用的「模型微調 / LoRA 訓練模型資料庫（SSOT）」。
 */
export const FINE_TUNE_MODEL_REGISTRY: readonly FineTuneModelProfile[] = [
  {
    modelId: "fal-ai/flux-lora-fast-training",
    label: "FLUX LoRA Fast Training",
    provider: "fal",
    trainingTypes: ["image_subject", "style_lora", "scene_lora"],
    strengths: ["通用 LoRA 訓練", "速度快", "成本相對穩定"],
    avoidWhen: ["純人像臉部細節優先", "影片時序一致性需求"],
    promptKeywords: ["lora", "style", "風格", "主體", "場景", "fast training"],
    typicalDurationMinutes: [5, 20],
  },
  {
    modelId: "fal-ai/flux-lora-portrait-trainer",
    label: "FLUX LoRA Portrait Trainer",
    provider: "fal",
    trainingTypes: ["portrait_lora"],
    strengths: ["人像一致性", "臉部特徵保留", "肖像微調"],
    avoidWhen: ["非人像素材", "純風格實驗"],
    promptKeywords: ["portrait", "face", "人像", "肖像", "角色臉部"],
    typicalDurationMinutes: [8, 25],
  },
  {
    modelId: "fal-ai/hunyuan-video-lora-training",
    label: "Hunyuan Video LoRA Training",
    provider: "fal",
    trainingTypes: ["video_lora"],
    strengths: ["影片 LoRA", "動作風格學習", "時序內容微調"],
    avoidWhen: ["只有單張圖片", "需要極速回應"],
    promptKeywords: ["video lora", "影片微調", "motion", "時序", "hunyuan"],
    typicalDurationMinutes: [15, 30],
  },
];

export interface FineTuneModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

export function summarizeFineTuneModelRegistry(limit = 12): string {
  const items = FINE_TUNE_MODEL_REGISTRY.slice(0, Math.max(1, limit));
  return JSON.stringify({
    total: FINE_TUNE_MODEL_REGISTRY.length,
    items,
    selectionPolicy: {
      matcher: "keyword-overlap",
      fallbackModelId: "fal-ai/flux-lora-fast-training",
      note: "When no keywords match, fallback to general-purpose LoRA training model.",
    },
  });
}

export function rankFineTuneModelsByPrompt(prompt: string): FineTuneModelMatch[] {
  const normalized = prompt.toLowerCase();
  return FINE_TUNE_MODEL_REGISTRY.map(model => {
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
  }).sort((a, b) => b.score - a.score);
}

export function pickBestFineTuneModel(prompt: string): FineTuneModelMatch {
  const [best] = rankFineTuneModelsByPrompt(prompt);
  if (best && best.score > 0) return best;
  return {
    modelId: "fal-ai/flux-lora-fast-training",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到通用 LoRA 訓練模型",
  };
}
