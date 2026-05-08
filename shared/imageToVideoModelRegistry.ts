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
    modelId: "fal-ai/kling-video/v2.1/standard/image-to-video",
    label: "Kling 2.1 Standard I2V",
    provider: "fal",
    strengths: ["首尾幀控制", "運鏡自然", "中文語意"],
    avoidWhen: ["需要極致細節 → 升 Pro"],
    promptKeywords: ["首尾幀", "head and tail", "smooth", "natural"],
  },
  {
    modelId: "fal-ai/runway-gen4-turbo/image-to-video",
    label: "Runway Gen4 Turbo I2V",
    provider: "fal",
    strengths: ["商業視覺感", "5/10s 可選", "比例控制精準"],
    avoidWhen: ["長鏡頭一致性", "預算敏感"],
    promptKeywords: [
      "fast",
      "social",
      "quick",
      "teaser",
      "promo",
      "advertisement",
      "commercial",
    ],
  },
  {
    modelId: "fal-ai/wan-i2v",
    label: "Wan 2.1 I2V",
    provider: "fal",
    strengths: ["開源高 CP", "720p", "可調幀數"],
    avoidWhen: ["需要 Pro 級畫質"],
    promptKeywords: ["draft", "preview", "iterate", "wan", "open source", "預覽", "草稿"],
  },
  {
    modelId: "fal-ai/pixverse/v4.5/image-to-video",
    label: "PixVerse v4.5 I2V",
    provider: "fal",
    strengths: ["特效模板強", "風格選項多", "1080p"],
    avoidWhen: ["寫實電影感"],
    promptKeywords: [
      "anime",
      "comic",
      "cyberpunk",
      "stylized",
      "clay",
      "3d animation",
      "social",
      "短片",
    ],
  },
  {
    modelId: "fal-ai/minimax/hailuo-02/pro/image-to-video",
    label: "MiniMax Hailuo 02 Pro I2V",
    provider: "fal",
    strengths: ["首幀固定佳", "電影級動態", "1080p"],
    avoidWhen: ["極短時長預覽"],
    promptKeywords: [
      "cinematic",
      "first frame",
      "movie",
      "dramatic",
      "首幀",
      "電影",
    ],
  },
  {
    modelId: "fal-ai/ltx-video/image-to-video",
    label: "LTX Video I2V",
    provider: "fal",
    strengths: ["可重現流程", "guidance 細控", "開源"],
    avoidWhen: ["短時間社群片"],
    promptKeywords: [
      "ltx",
      "open source",
      "reproducible",
      "keyframe",
      "關鍵幀",
    ],
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
