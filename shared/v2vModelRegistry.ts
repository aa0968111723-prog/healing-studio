export interface V2VModelProfile {
  modelId: string;
  label: string;
  provider: "fal";
  tier: "standard" | "premium" | "ultra";
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
  description: string;
}

/**
 * 全站光球代理可共用的「影片轉影片（Video-to-Video）模型資料庫（SSOT）」。
 *
 * 目標：
 * 1) 讓 Orb 能依提示詞內容，先做規則式模型分流。
 * 2) 讓 planner / agent 在回答「用哪個 V2V 模型」時可引用統一資料來源。
 * 3) 涵蓋風格轉換、畫質優化、逐幀控制等 V2V 使用場景。
 */
export const V2V_MODEL_REGISTRY: readonly V2VModelProfile[] = [
  // ── 風格轉換類 ──
  {
    modelId: "fal-ai/kling-video/v2.1/standard/video-to-video",
    label: "Kling V2.1 V2V",
    provider: "fal",
    tier: "ultra",
    strengths: ["高品質風格轉換", "保持動作連貫", "精細重繪控制"],
    avoidWhen: ["快速預覽需求", "低成本場景"],
    promptKeywords: [
      "style transfer",
      "風格化",
      "藝術風格",
      "高品質",
      "精細",
      "kling",
    ],
    description: "Kling V2.1 影片風格重繪，適合高品質藝術風格轉換",
  },
  {
    modelId: "fal-ai/kling-video/v1.6/standard/video-to-video",
    label: "Kling V1.6 V2V",
    provider: "fal",
    tier: "premium",
    strengths: ["穩定風格轉換", "向後相容"],
    avoidWhen: ["需要最新功能"],
    promptKeywords: ["kling", "v1.6", "legacy", "相容"],
    description: "Kling V1.6 影片重繪（保留向後相容）",
  },
  {
    modelId: "fal-ai/wan/v2.1/video-to-video",
    label: "WAN V2V",
    provider: "fal",
    tier: "standard",
    strengths: ["快速風格遷移", "成本效益高", "適合初步測試"],
    avoidWhen: ["需要極致品質"],
    promptKeywords: [
      "wan",
      "quick",
      "fast",
      "快速",
      "風格遷移",
      "測試",
      "預覽",
    ],
    description: "WAN 影片風格遷移，支援強度控制與種子設定",
  },
  {
    modelId: "fal-ai/wan-ai/wan2.1-v2v-480p",
    label: "WAN 2.1 480p V2V",
    provider: "fal",
    tier: "standard",
    strengths: ["低解析度快速處理", "成本極低"],
    avoidWhen: ["需要高解析度", "最終交付"],
    promptKeywords: ["480p", "low res", "draft", "草稿", "快速測試"],
    description: "WAN 2.1 480p 影片風格化（適合草稿與快速測試）",
  },
  {
    modelId: "fal-ai/cogvideox-5b/video-to-video",
    label: "CogVideoX V2V",
    provider: "fal",
    tier: "standard",
    strengths: ["開源模型", "彈性控制", "社群支援"],
    avoidWhen: ["追求商業級品質"],
    promptKeywords: [
      "cogvideo",
      "open source",
      "開源",
      "編輯",
      "轉換",
      "研究",
    ],
    description: "CogVideoX 影片編輯轉換，開源靈活方案",
  },

  // ── 逐幀進階控制類 ──
  {
    modelId: "fal-ai/animatediff-v2v",
    label: "AnimateDiff V2V",
    provider: "fal",
    tier: "standard",
    strengths: [
      "ControlNet 逐幀控制",
      "支援骨架/邊緣/深度",
      "精準動作控制",
    ],
    avoidWhen: ["簡單風格轉換", "不需要姿態控制"],
    promptKeywords: [
      "controlnet",
      "pose",
      "skeleton",
      "edge",
      "depth",
      "骨架",
      "姿態",
      "邊緣",
      "深度",
      "精準控制",
      "動作",
    ],
    description:
      "AnimateDiff + ControlNet 逐幀控制：openpose（骨架）/ canny（邊緣）/ depth（深度）",
  },

  // ── 畫質優化類 ──
  {
    modelId: "fal-ai/bytedance/upscaler/video",
    label: "ByteDance 影片超解析",
    provider: "fal",
    tier: "premium",
    strengths: ["AI 超解析", "畫質提升", "細節恢復"],
    avoidWhen: ["原始影片已是高解析度", "不需要放大"],
    promptKeywords: [
      "upscale",
      "超解析",
      "放大",
      "畫質提升",
      "增強",
      "enhance",
      "4k",
      "高清",
    ],
    description: "ByteDance AI 超解析度技術，顯著提升影片畫質",
  },
  {
    modelId: "fal-ai/rife-v4.6/video",
    label: "RIFE 補幀",
    provider: "fal",
    tier: "standard",
    strengths: ["幀率提升", "流暢度優化", "成本較低"],
    avoidWhen: ["原始幀率已足夠", "不需要慢動作"],
    promptKeywords: [
      "frame interpolation",
      "補幀",
      "幀率",
      "fps",
      "流暢",
      "slow motion",
      "慢動作",
    ],
    description: "RIFE 實時補幀插值，提升影片流暢度",
  },
  {
    modelId: "fal-ai/topaz/video-enhance",
    label: "Topaz Video Enhance",
    provider: "fal",
    tier: "ultra",
    strengths: ["商業級品質", "極致增強", "專業後製"],
    avoidWhen: ["預算有限", "快速處理需求"],
    promptKeywords: [
      "topaz",
      "professional",
      "commercial",
      "專業",
      "商業級",
      "最高品質",
      "極致",
    ],
    description: "Topaz AI 專業級影片品質提升，商業製作首選",
  },
];

export interface V2VModelMatch {
  modelId: string;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

/**
 * 根據使用者提示詞，對 V2V 模型進行評分排序。
 * @param prompt 使用者的提示詞或需求描述
 * @returns 排序後的模型匹配結果（分數由高到低）
 */
export function rankV2VModelsByPrompt(prompt: string): V2VModelMatch[] {
  const normalized = prompt.toLowerCase();

  return V2V_MODEL_REGISTRY.map((model) => {
    const matchedKeywords = model.promptKeywords.filter((keyword) =>
      normalized.includes(keyword.toLowerCase())
    );
    const score = matchedKeywords.length;
    return {
      modelId: model.modelId,
      score,
      matchedKeywords,
      rationale:
        score > 0
          ? `命中關鍵詞: ${matchedKeywords.join(", ")}`
          : "無直接關鍵詞命中，保留為備選",
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 選擇最適合的 V2V 模型。
 * 如果沒有關鍵詞命中，回退到通用預設 WAN V2V（平衡速度與品質）。
 * @param prompt 使用者的提示詞或需求描述
 * @returns 最佳匹配的模型
 */
export function pickBestV2VModel(prompt: string): V2VModelMatch {
  const [best] = rankV2VModelsByPrompt(prompt);
  if (best && best.score > 0) return best;

  // 回退策略：選擇通用的 WAN V2V 作為預設
  return {
    modelId: "fal-ai/wan/v2.1/video-to-video",
    score: 0,
    matchedKeywords: [],
    rationale: "未命中任何關鍵詞，回退到通用預設 WAN V2V",
  };
}

/**
 * 根據使用場景類型，推薦適合的 V2V 模型類別。
 * @param useCase 使用場景：style-transfer（風格轉換）| quality-enhance（畫質優化）| advanced-control（進階控制）
 * @returns 該場景下推薦的模型列表
 */
export function getV2VModelsByUseCase(
  useCase: "style-transfer" | "quality-enhance" | "advanced-control"
): V2VModelProfile[] {
  const useCaseMap: Record<string, string[]> = {
    "style-transfer": [
      "fal-ai/kling-video/v2.1/standard/video-to-video",
      "fal-ai/wan/v2.1/video-to-video",
      "fal-ai/cogvideox-5b/video-to-video",
    ],
    "quality-enhance": [
      "fal-ai/bytedance/upscaler/video",
      "fal-ai/rife-v4.6/video",
      "fal-ai/topaz/video-enhance",
    ],
    "advanced-control": ["fal-ai/animatediff-v2v"],
  };

  const targetIds = useCaseMap[useCase] || [];
  return V2V_MODEL_REGISTRY.filter((model) =>
    targetIds.includes(model.modelId)
  );
}
