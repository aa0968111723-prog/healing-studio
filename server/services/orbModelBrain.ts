/**
 * orbModelBrain.ts — 光球模型智慧大腦
 *
 * 讓光球能動態查詢、比較、推薦全站 153+ 個創作模型，
 * 並根據使用者的意圖、歷史偏好和預算自動選擇最佳模型組合。
 *
 * 三大核心能力：
 * 1. model.query    — 動態查詢模型（按類別/關鍵字/tier/狀態）
 * 2. model.compare  — 多模型深度比較（能力、成本、適用場景）
 * 3. model.recommend — 智能推薦（根據意圖+偏好+預算+歷史）
 */

import {
  FAL_MODEL_CATALOG,
  FAL_CATEGORY_LABELS,
  type FalCategory,
} from "./falModels";
import type { FalModelConfig } from "./falModels";
import {
  REASONING_MODEL_CATALOG,
  GENERATION_ENGINE_CATALOG,
} from "../_core/modelRegistry";

// ─── 類型定義 ─────────────────────────────────────────────────────────────

export interface ModelQueryParams {
  /** 按類別篩選，例如 "text-to-image", "text-to-video" */
  category?: string;
  /** 按關鍵字搜尋（匹配 modelId 或 label） */
  keyword?: string;
  /** 按 tier 篩選 */
  tier?: "ultra" | "premium" | "standard" | "fast";
  /** 是否包含已停用的模型 */
  includeDisabled?: boolean;
  /** 按模態篩選（image/video/audio/voice/3d） */
  modality?: string;
}

export interface ModelCompareResult {
  models: ModelSummary[];
  comparisonTable: string;
  recommendation: string;
}

export interface ModelRecommendation {
  primary: ModelSummary;
  alternatives: ModelSummary[];
  reasoning: string;
  actions: string[];  // 建議的 ACTION 指令
}

export interface ModelSummary {
  modelId: string;
  label: string;
  category: FalCategory;
  tier: string;
  disabled: boolean;
  disabledReason?: string;
  studio: string;       // 對應的工作室路徑
  studioTab?: string;   // 對應的分頁
  strengths: string[];   // 優勢
  bestFor: string[];     // 最適合的場景
  costLevel: string;     // 成本等級描述
  inputCapabilities: string[];  // 支援的輸入
  outputCapabilities: string[]; // 支援的輸出
}

// ─── 模態到類別的映射 ─────────────────────────────────────────────────────

const MODALITY_TO_CATEGORIES: Record<string, FalCategory[]> = {
  image: ["text-to-image", "image-to-image"],
  video: ["text-to-video", "image-to-video", "video-to-video"],
  audio: ["text-to-audio", "video-to-audio"],
  voice: ["text-to-speech"],
  "3d": ["text-to-3d", "image-to-3d"],
  music: ["text-to-audio"],
  speech: ["text-to-speech"],
  training: ["training"],
};

// ─── 類別到工作室路徑的映射 ───────────────────────────────────────────────

const CATEGORY_TO_STUDIO: Record<string, { path: string; tab?: string }> = {
  "text-to-image": { path: "/image-studio", tab: "t2i" },
  "image-to-image": { path: "/image-studio", tab: "edit" },
  "image-to-json": { path: "/image-studio" },
  "text-to-video": { path: "/video-studio", tab: "t2v" },
  "image-to-video": { path: "/video-studio", tab: "i2v" },
  "video-to-video": { path: "/video-studio", tab: "v2v" },
  "video-to-audio": { path: "/pro-studio", tab: "sfx" },
  "video-to-text": { path: "/video-studio" },
  "text-to-audio": { path: "/pro-studio", tab: "music" },
  "text-to-speech": { path: "/pro-studio", tab: "tts" },
  "text-to-3d": { path: "/image-studio", tab: "3d" },
  "image-to-3d": { path: "/image-studio", tab: "3d" },
  "audio-to-text": { path: "/pro-studio" },
  training: { path: "/models" },
  json: { path: "/studio" },
  "text-to-json": { path: "/studio" },
  llm: { path: "/agent" },
};

// ─── 模型優勢知識庫（基於 siteKnowledge.ts 中的決策樹） ──────────────────

const MODEL_STRENGTHS: Record<string, { strengths: string[]; bestFor: string[] }> = {
  // 圖片模型
  "fal-ai/nano-banana-2": {
    strengths: ["最快速度", "低成本", "Gemini Flash 驅動"],
    bestFor: ["快速預覽", "靈感測試", "批量生成"],
  },
  "fal-ai/nano-banana-pro": {
    strengths: ["高品質", "商業級輸出", "Gemini Pro 驅動"],
    bestFor: ["商業用途", "印刷品", "精緻作品"],
  },
  "fal-ai/bytedance/seedream/v4/text-to-image": {
    strengths: ["中文理解最佳", "東方美學", "水墨風格"],
    bestFor: ["中文描述", "東方風格", "水墨畫", "國風設計"],
  },
  "fal-ai/imagen4/preview": {
    strengths: ["超寫實", "照片級品質", "Google 最新技術"],
    bestFor: ["寫實照片", "產品攝影", "人像"],
  },
  "fal-ai/flux-pro/v1.1": {
    strengths: ["文字渲染精準", "構圖穩定", "細節豐富"],
    bestFor: ["含文字的設計", "海報", "Logo"],
  },
  "fal-ai/flux/schnell": {
    strengths: ["極速", "免費開源", "穩定"],
    bestFor: ["快速測試", "草稿", "學習用途"],
  },
  "fal-ai/ideogram/v2": {
    strengths: ["文字渲染最佳", "排版精準", "設計感強"],
    bestFor: ["含大量文字的設計", "海報", "社群圖卡"],
  },
  // 影片模型
  "fal-ai/kling-video/v2.1/pro/text-to-video": {
    strengths: ["最高品質", "動態自然", "支援 10 秒"],
    bestFor: ["高品質短片", "商業廣告", "精緻動畫"],
  },
  "fal-ai/wan-t2v": {
    strengths: ["性價比高", "速度快", "開源"],
    bestFor: ["快速影片", "預算有限", "測試概念"],
  },
  "fal-ai/veo3": {
    strengths: ["Google 最新", "含原生音效", "電影感"],
    bestFor: ["有聲影片", "電影級短片", "沉浸式內容"],
  },
  "fal-ai/veo3/pro": {
    strengths: ["最高品質影片", "原生音效", "專業級"],
    bestFor: ["專業影片製作", "廣告", "影展級作品"],
  },
  "fal-ai/sora": {
    strengths: ["OpenAI 技術", "場景理解強", "物理模擬"],
    bestFor: ["複雜場景", "物理動態", "創意短片"],
  },
  "fal-ai/minimax/hailuo-02/pro/text-to-video": {
    strengths: ["人物動態自然", "表情豐富", "性價比好"],
    bestFor: ["人物動態", "對話場景", "日常短片"],
  },
  // I2V 模型
  "fal-ai/kling-video/v2.1/pro/image-to-video": {
    strengths: ["首幀控制精準", "動態自然", "最高品質 i2v"],
    bestFor: ["圖片動畫化", "角色動態", "場景延伸"],
  },
  "fal-ai/runway-gen4-turbo/image-to-video": {
    strengths: ["Runway 最新", "風格一致性強", "快速"],
    bestFor: ["風格化動畫", "藝術短片", "快速 i2v"],
  },
  // 音樂模型
  "sonauto/v2/text-to-music": {
    strengths: ["完整歌曲", "含歌詞", "品質最佳"],
    bestFor: ["完整歌曲創作", "有歌詞的音樂", "MV 配樂"],
  },
  "fal-ai/ace-step": {
    strengths: ["長音樂", "配樂專用", "支援歌詞"],
    bestFor: ["背景配樂", "長段音樂", "影片配樂"],
  },
  "fal-ai/stable-audio": {
    strengths: ["高品質音樂", "環境音", "靈活時長"],
    bestFor: ["環境音", "冥想音樂", "氛圍音效"],
  },
  "fal-ai/musicgen": {
    strengths: ["開源", "輕量快速", "Meta 技術"],
    bestFor: ["快速試聽", "簡單配樂", "學習用途"],
  },
  // 語音模型
  "fal-ai/elevenlabs/tts/turbo-v2.5": {
    strengths: ["速度快", "多語言", "自然度高"],
    bestFor: ["日常配音", "快速語音", "多語言內容"],
  },
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": {
    strengths: ["中文最佳", "免費", "情感豐富"],
    bestFor: ["中文旁白", "有聲書", "教學配音"],
  },
  "fal-ai/dia-tts/voice-clone": {
    strengths: ["多說話者", "對話式", "角色扮演"],
    bestFor: ["多人對話", "故事朗讀", "角色配音"],
  },
  "fal-ai/qwen-3-tts/clone-voice/1.7b": {
    strengths: ["一步聲音克隆", "中文友善", "快速"],
    bestFor: ["快速克隆聲音", "個人化配音", "中文克隆"],
  },
  // 3D 模型
  "fal-ai/trellis-3d — Trellis 3D": {
    strengths: ["高品質 3D", "細節豐富"],
    bestFor: ["3D 建模", "遊戲素材"],
  },
  // V2V 模型
  "fal-ai/bytedance/upscaler/video": {
    strengths: ["ByteDance 技術", "影片超解析"],
    bestFor: ["提升影片品質", "老影片修復"],
  },
};

// ─── Tier 成本描述 ────────────────────────────────────────────────────────

const TIER_COST: Record<string, string> = {
  ultra: "💎 頂級（35-55 點/次）",
  premium: "⭐ 高級（3-10 點/次）",
  standard: "🔵 標準（2-5 點/次）",
  fast: "⚡ 快速（1-2 點/次）",
};

// ─── 核心函數 ─────────────────────────────────────────────────────────────

/** 取得所有 Fal 模型的摘要清單 */
function getAllModelSummaries(includeDisabled = false): ModelSummary[] {
  const summaries: ModelSummary[] = [];

  for (const [category, models] of Object.entries(FAL_MODEL_CATALOG)) {
    for (const model of models) {
      if (!includeDisabled && model.disabled) continue;

      const studioInfo = CATEGORY_TO_STUDIO[category] ?? { path: "/studio" };
      const knownStrengths = MODEL_STRENGTHS[model.modelId];
      const inputCaps: string[] = [];
      const outputCaps: string[] = [];

      // 解析輸入能力
      if (model.inputSchema.prompt) inputCaps.push("文字提示詞");
      if (model.inputSchema.imageUrl) inputCaps.push("圖片輸入");
      if (model.inputSchema.videoUrl) inputCaps.push("影片輸入");
      if (model.inputSchema.audioUrl) inputCaps.push("音訊輸入");
      if (model.inputSchema.negativePrompt) inputCaps.push("負向提示詞");
      if (model.inputSchema.loraUrl) inputCaps.push("LoRA 模型");
      if (model.inputSchema.voiceId) inputCaps.push("音色選擇");
      if (model.inputSchema.aspectRatio || model.inputSchema.imageSize) inputCaps.push("尺寸/比例");
      if (model.inputSchema.duration) inputCaps.push("時長控制");
      if (model.inputSchema.seed) inputCaps.push("種子值");
      if (model.inputSchema.guidanceScale) inputCaps.push("CFG 引導");

      // 解析輸出能力
      if (model.outputSchema.imageUrl || model.outputSchema.images) outputCaps.push("圖片");
      if (model.outputSchema.videoUrl) outputCaps.push("影片");
      if (model.outputSchema.audioUrl) outputCaps.push("音訊");
      if (model.outputSchema.modelUrl) outputCaps.push("模型檔案");
      if (model.outputSchema.objectUrl) outputCaps.push("3D 物件");
      if (model.outputSchema.text) outputCaps.push("文字");
      if (model.outputSchema.json) outputCaps.push("JSON");

      summaries.push({
        modelId: model.modelId,
        label: model.label,
        category: model.category,
        tier: model.tier,
        disabled: !!model.disabled,
        disabledReason: model.disabledReason,
        studio: studioInfo.path,
        studioTab: studioInfo.tab,
        strengths: knownStrengths?.strengths ?? [],
        bestFor: knownStrengths?.bestFor ?? [],
        costLevel: TIER_COST[model.tier] ?? "未知",
        inputCapabilities: inputCaps,
        outputCapabilities: outputCaps,
      });
    }
  }

  return summaries;
}

/** 1. 查詢模型 */
export function queryModels(params: ModelQueryParams): ModelSummary[] {
  let models = getAllModelSummaries(params.includeDisabled);

  if (params.category) {
    models = models.filter(m => m.category === params.category);
  }

  if (params.modality) {
    const categories = MODALITY_TO_CATEGORIES[params.modality.toLowerCase()];
    if (categories) {
      models = models.filter(m => categories.includes(m.category));
    }
  }

  if (params.tier) {
    models = models.filter(m => m.tier === params.tier);
  }

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    models = models.filter(
      m =>
        m.modelId.toLowerCase().includes(kw) ||
        m.label.toLowerCase().includes(kw) ||
        m.strengths.some(s => s.toLowerCase().includes(kw)) ||
        m.bestFor.some(b => b.toLowerCase().includes(kw))
    );
  }

  return models;
}

/** 2. 比較模型 */
export function compareModels(modelIds: string[]): ModelCompareResult {
  const allModels = getAllModelSummaries(true);
  const selected = modelIds
    .map(id => allModels.find(m => m.modelId === id))
    .filter((m): m is ModelSummary => !!m);

  if (selected.length === 0) {
    return {
      models: [],
      comparisonTable: "找不到指定的模型。",
      recommendation: "請提供有效的模型 ID。",
    };
  }

  // 建構比較表
  const headers = ["特性", ...selected.map(m => m.label)];
  const rows: string[][] = [
    ["類別", ...selected.map(m => m.category)],
    ["成本等級", ...selected.map(m => m.costLevel)],
    ["狀態", ...selected.map(m => (m.disabled ? "❌ 已停用" : "✅ 可用"))],
    ["工作室", ...selected.map(m => m.studio)],
    ["優勢", ...selected.map(m => m.strengths.join("、") || "—")],
    ["最適場景", ...selected.map(m => m.bestFor.join("、") || "—")],
    ["輸入能力", ...selected.map(m => m.inputCapabilities.join("、") || "—")],
    ["輸出能力", ...selected.map(m => m.outputCapabilities.join("、") || "—")],
  ];

  const table = [headers, ...rows]
    .map(row => `| ${row.join(" | ")} |`)
    .join("\n");

  // 生成推薦
  const available = selected.filter(m => !m.disabled);
  let recommendation = "";
  if (available.length === 0) {
    recommendation = "所有選定的模型目前都已停用，建議選擇其他替代模型。";
  } else if (available.length === 1) {
    recommendation = `推薦使用 ${available[0].label}（${available[0].costLevel}）。`;
  } else {
    const cheapest = available.reduce((a, b) =>
      tierRank(a.tier) < tierRank(b.tier) ? a : b
    );
    const best = available.reduce((a, b) =>
      tierRank(a.tier) > tierRank(b.tier) ? a : b
    );
    recommendation =
      cheapest.modelId === best.modelId
        ? `推薦使用 ${best.label}，兼具品質與成本效益。`
        : `追求品質 → ${best.label}；控制預算 → ${cheapest.label}。`;
  }

  return { models: selected, comparisonTable: table, recommendation };
}

/** 3. 智能推薦模型 */
export function recommendModel(params: {
  intent: string;
  modality?: string;
  budget?: "low" | "medium" | "high" | "unlimited";
  style?: string;
  language?: string;
}): ModelRecommendation {
  const { intent, modality, budget = "medium", style, language } = params;
  const intentLower = intent.toLowerCase();

  // 決定模態
  let targetModality = modality?.toLowerCase() ?? detectModality(intentLower);

  // 取得候選模型
  const candidates = queryModels({
    modality: targetModality,
    includeDisabled: false,
  });

  if (candidates.length === 0) {
    return {
      primary: {
        modelId: "unknown",
        label: "未找到匹配模型",
        category: "text-to-image",
        tier: "standard",
        disabled: false,
        studio: "/studio",
        strengths: [],
        bestFor: [],
        costLevel: "未知",
        inputCapabilities: [],
        outputCapabilities: [],
      },
      alternatives: [],
      reasoning: `找不到適合「${intent}」的模型。請嘗試更具體的描述。`,
      actions: ['[ACTION:navigate:/studio]'],
    };
  }

  // 根據意圖和預算評分
  const scored = candidates.map(m => ({
    model: m,
    score: scoreModel(m, intentLower, budget, style, language),
  }));

  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0].model;
  const alternatives = scored.slice(1, 4).map(s => s.model);

  // 生成 ACTION 指令
  const actions: string[] = [];
  actions.push(`[ACTION:navigate:${primary.studio}]`);
  if (primary.studioTab) {
    actions.push(`[ACTION:setTab:${primary.studioTab}]`);
  }
  // 從 modelId 提取簡短 ID 用於 setModel
  const shortModelId = extractShortModelId(primary.modelId, primary.category);
  actions.push(`[ACTION:setModel:${shortModelId}]`);

  const reasoning = buildRecommendationReasoning(primary, alternatives, intent, budget);

  return { primary, alternatives, reasoning, actions };
}

/** 4. 取得工作室的完整模型清單（供系統提示詞使用） */
export function getStudioModelKnowledge(studioPath: string): string {
  const allModels = getAllModelSummaries(false);
  const studioModels = allModels.filter(m => m.studio === studioPath);

  if (studioModels.length === 0) return "";

  const grouped = new Map<string, ModelSummary[]>();
  for (const m of studioModels) {
    const key = m.category;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  const lines: string[] = [];
  for (const [category, models] of Array.from(grouped.entries())) {
    const catLabel = (FAL_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
    lines.push(`\n■ ${catLabel} (${category}):`);
    for (const m of models) {
      const status = m.disabled ? " [停用]" : "";
      const strengths = m.strengths.length > 0 ? ` — ${m.strengths.join("、")}` : "";
      lines.push(`  [${m.tier}] ${m.modelId} — ${m.label}${status}${strengths}`);
    }
  }

  return lines.join("\n");
}

/** 5. 取得推理大腦和生成引擎的知識 */
export function getReasoningAndEngineKnowledge(): string {
  const lines: string[] = [];

  lines.push("═══ 推理大腦（5 槽位） ═══");
  for (const [slot, config] of Object.entries(REASONING_MODEL_CATALOG)) {
    lines.push(`■ ${slot}（${config.label}）— ${config.description}`);
    for (const opt of config.options) {
      lines.push(`  [${opt.tier}] ${opt.value} — ${opt.label}`);
    }
  }

  lines.push("\n═══ 生成引擎（4 槽位） ═══");
  for (const [slot, config] of Object.entries(GENERATION_ENGINE_CATALOG)) {
    lines.push(`■ ${slot}（${config.label}）— ${config.description}`);
    for (const opt of config.options) {
      lines.push(`  [${opt.tier}] ${opt.value} — ${opt.label}`);
    }
  }

  return lines.join("\n");
}

// ─── 輔助函數 ─────────────────────────────────────────────────────────────

function tierRank(tier: string): number {
  switch (tier) {
    case "ultra": return 4;
    case "premium": return 3;
    case "standard": return 2;
    case "fast": return 1;
    default: return 0;
  }
}

function detectModality(intent: string): string {
  if (/圖片|圖像|照片|插畫|海報|封面|頭像|桌布|設計|畫|image|photo|poster|illustration/i.test(intent)) return "image";
  if (/影片|視頻|動畫|短片|reels|抖音|video|film|animation|mv/i.test(intent)) return "video";
  if (/音樂|配樂|歌曲|曲子|旋律|bgm|music|song|melody/i.test(intent)) return "music";
  if (/語音|配音|旁白|朗讀|tts|voice|speech|narration/i.test(intent)) return "voice";
  if (/音效|sfx|sound effect/i.test(intent)) return "audio";
  if (/3d|三維|模型|建模|3d model/i.test(intent)) return "3d";
  if (/訓練|lora|finetune|微調/i.test(intent)) return "training";
  return "image"; // 預設
}

function scoreModel(
  model: ModelSummary,
  intent: string,
  budget: string,
  style?: string,
  language?: string
): number {
  let score = 0;

  // 基礎分：tier 與 budget 的匹配
  const tierR = tierRank(model.tier);
  switch (budget) {
    case "low":
      score += tierR === 1 ? 30 : tierR === 2 ? 20 : tierR === 3 ? 5 : 0;
      break;
    case "medium":
      score += tierR === 2 ? 30 : tierR === 3 ? 25 : tierR === 1 ? 15 : 10;
      break;
    case "high":
      score += tierR === 3 ? 30 : tierR === 4 ? 25 : tierR === 2 ? 15 : 5;
      break;
    case "unlimited":
      score += tierR * 10;
      break;
  }

  // 意圖匹配分
  for (const bf of model.bestFor) {
    if (intent.includes(bf.toLowerCase())) score += 20;
  }
  for (const s of model.strengths) {
    if (intent.includes(s.toLowerCase())) score += 15;
  }

  // 關鍵字匹配
  if (/快速|快|速度|preview|test|試/.test(intent) && model.tier === "fast") score += 25;
  if (/高品質|精緻|商業|professional|印刷/.test(intent) && (model.tier === "premium" || model.tier === "ultra")) score += 25;
  if (/便宜|省錢|低成本|budget|cheap/.test(intent) && (model.tier === "fast" || model.tier === "standard")) score += 25;
  if (/寫實|照片|逼真|realistic|photo/.test(intent) && model.modelId.includes("imagen")) score += 30;
  if (/中文|東方|水墨|國風/.test(intent) && model.modelId.includes("seedream")) score += 30;
  if (/文字|logo|海報|排版/.test(intent) && (model.modelId.includes("ideogram") || model.modelId.includes("flux-pro"))) score += 25;
  if (/有聲|音效|含聲音/.test(intent) && model.modelId.includes("veo3")) score += 30;
  if (/歌詞|歌曲|唱/.test(intent) && model.modelId.includes("sonauto")) score += 30;
  if (/冥想|環境|ambient|放鬆/.test(intent) && model.modelId.includes("stable-audio")) score += 25;
  if (/克隆|複製聲音|clone/.test(intent) && model.modelId.includes("clone")) score += 30;

  // 語言偏好
  if (language === "zh" || language === "中文") {
    if (model.modelId.includes("seedream")) score += 15;
    if (model.modelId.includes("qwen")) score += 15;
  }

  // 風格匹配
  if (style) {
    const styleLower = style.toLowerCase();
    if (/anime|動漫|二次元/.test(styleLower) && model.modelId.includes("flux")) score += 10;
    if (/cinematic|電影|film/.test(styleLower) && model.tier === "premium") score += 10;
  }

  return score;
}

function extractShortModelId(fullId: string, category: FalCategory): string {
  // 嘗試從 siteKnowledge 中的短名稱映射
  const shortNames: Record<string, string> = {
    "fal-ai/nano-banana-2": "nanoBanana2",
    "fal-ai/nano-banana-pro": "nanoBananaPro",
    "fal-ai/bytedance/seedream/v4/text-to-image": "seedreamV4",
    "fal-ai/imagen4/preview": "imagen4",
    "fal-ai/flux-pro/v1.1": "fluxPro",
    "fal-ai/flux/schnell": "fluxSchnell",
    "fal-ai/ideogram/v2": "ideogramV2",
    "fal-ai/kling-video/v2.1/pro/text-to-video": "kling-t2v",
    "fal-ai/wan-t2v": "wan-t2v",
    "fal-ai/veo3": "veo3-t2v",
    "fal-ai/minimax/hailuo-02/pro/text-to-video": "minimax-t2v",
    "fal-ai/kling-video/v2.1/pro/image-to-video": "kling-i2v",
    "fal-ai/runway-gen4-turbo/image-to-video": "runway-gen4-turbo",
    "sonauto/v2/text-to-music": "sonauto",
    "fal-ai/ace-step": "ace-step",
    "fal-ai/stable-audio": "stable-audio",
    "fal-ai/musicgen": "musicgen",
    "fal-ai/elevenlabs/tts/turbo-v2.5": "eleven-turbo-v2.5",
    "fal-ai/qwen-3-tts/text-to-speech/1.7b": "qwen3-tts",
  };

  return shortNames[fullId] ?? fullId;
}

function buildRecommendationReasoning(
  primary: ModelSummary,
  alternatives: ModelSummary[],
  intent: string,
  budget: string
): string {
  const parts: string[] = [];

  parts.push(`根據你的需求「${intent}」，我推薦使用 **${primary.label}**。`);

  if (primary.strengths.length > 0) {
    parts.push(`它的優勢是：${primary.strengths.join("、")}。`);
  }

  if (primary.bestFor.length > 0) {
    parts.push(`最適合：${primary.bestFor.join("、")}。`);
  }

  parts.push(`成本：${primary.costLevel}。`);

  if (alternatives.length > 0) {
    const altNames = alternatives.map(a => a.label).join("、");
    parts.push(`\n其他選擇：${altNames}。`);
  }

  return parts.join(" ");
}

/** 6. 格式化模型查詢結果為光球可讀的文字 */
export function formatModelQueryForOrb(models: ModelSummary[]): string {
  if (models.length === 0) return "找不到符合條件的模型。";

  const lines: string[] = [`找到 ${models.length} 個模型：\n`];

  for (const m of models.slice(0, 10)) {
    const status = m.disabled ? " ❌停用" : " ✅可用";
    lines.push(`**${m.label}**${status}`);
    lines.push(`  模型 ID: ${m.modelId}`);
    lines.push(`  成本: ${m.costLevel}`);
    lines.push(`  工作室: ${m.studio}${m.studioTab ? ` → ${m.studioTab}` : ""}`);
    if (m.strengths.length > 0) lines.push(`  優勢: ${m.strengths.join("、")}`);
    if (m.bestFor.length > 0) lines.push(`  最適: ${m.bestFor.join("、")}`);
    lines.push("");
  }

  if (models.length > 10) {
    lines.push(`...還有 ${models.length - 10} 個模型未顯示。`);
  }

  return lines.join("\n");
}

/** 7. 格式化推薦結果為光球可讀的文字 */
export function formatRecommendationForOrb(rec: ModelRecommendation): string {
  const lines: string[] = [];

  lines.push(rec.reasoning);
  lines.push("");
  lines.push("建議操作：");
  for (const action of rec.actions) {
    lines.push(`  ${action}`);
  }

  if (rec.alternatives.length > 0) {
    lines.push("\n替代方案：");
    for (const alt of rec.alternatives) {
      lines.push(`  - ${alt.label}（${alt.costLevel}）${alt.strengths.length > 0 ? "— " + alt.strengths.join("、") : ""}`);
    }
  }

  return lines.join("\n");
}
