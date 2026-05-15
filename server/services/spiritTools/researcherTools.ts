/**
 * server/services/spiritTools/researcherTools.ts
 *
 * Tools for researcher (查查) spirit — turns 查查 from "free-form Sonar
 * search wrapper" into a real comparison agent that can pull structured
 * model comparisons directly from the site's pricing catalogue.
 *
 * 查查's role prompt promises three concrete things:
 *   1. 「先列 3 個事實欄位（差別 / 價位 / 適用情境）」
 *   2. 「再給 1-2 個你個人推薦並說為什麼」
 *   3. 「比較模型時用站內 registry」
 *
 * Before this module, item (3) was a hand-written paragraph baked into the
 * prompt — the LLM would recite "FLUX Pro 1.1 寫實 / SeeDream v4 東方插畫…"
 * from memory and the actual catalogue couldn't be queried as a tool.
 * compareModels closes that gap: it pulls live data from
 * MODEL_PRICING_CATALOG, checks API-key availability, classifies use cases
 * deterministically, and picks cheapest / best-for-quality / best-for-speed
 * representatives so 查查 can answer "FLUX vs SeeDream vs Imagen — 哪個適合
 * 商業海報？" with a real, auditable table instead of paraphrased training
 * data.
 */

import {
  MODEL_PRICING_CATALOG,
  checkModelAvailability,
  estimatePoints,
  getModelPricing,
  pointsToUsd,
  type ModelCategory,
  type ModelPricing,
  type PricingTier,
} from "../modelPricing";
import { getPrimaryNicknameForRole, type AgentRole } from "../../../shared/orb-agent-roles";
import { logger } from "../../_core/logger";

// ─── Public types ───────────────────────────────────────────────────────────

export interface CompareModelsInput {
  /** 要比的模型類別（必填）— text-to-image / text-to-video / text-to-audio / … */
  category: ModelCategory;
  /**
   * 指定要比的 modelId（選填）。沒指定時依 includeUnavailable / maxResults
   * 從 catalogue 自動挑出該類別的所有模型。
   */
  modelIds?: readonly string[];
  /**
   * 要不要把「API key 缺失的模型」也放進結果。預設 false — 查查預設
   * 只跟使用者談「現在按下去就能用」的選項，避免推薦完了發現不能跑。
   */
  includeUnavailable?: boolean;
  /** 用情境（選填）— 影響 useCaseFit 評分（draft / production / cinematic / commercial） */
  useCase?: ModelUseCase;
  /** 對應的內容長度 / 數量，給 estimatedPoints 算範例花費用 */
  estimateFor?: {
    durationSec?: number;
    charCount?: number;
    imageCount?: number;
  };
  /** 最多回幾個模型（預設 8） */
  maxResults?: number;
}

export type ModelUseCase =
  | "draft" // 快草稿 / 試 prompt
  | "production" // 一般成品
  | "cinematic" // 電影感、運鏡
  | "commercial" // 商業 / 品牌 / 廣告
  | "anatomical" // 解剖 / 醫學圖
  | "loop_friendly" // BGM 可循環
  | "vocal" // 含人聲歌曲
  | "ambient" // 環境音 / 氛圍
  | "multilingual"; // 多語言 TTS

export interface ComparedModelRow {
  modelId: string;
  label: string;
  provider: ModelPricing["provider"];
  tier: PricingTier;
  category: ModelCategory;
  /** 站內預估點數範圍（依 catalogue 的 min/max） */
  pointsRange: { min: number; max: number };
  /** 站內預估 USD（給使用者比金額直覺） */
  costUsdRange: { min: string; max: string };
  /** 依 estimateFor 算出來的「這次大概多少點」（若 estimateFor 沒帶就 null） */
  estimatedPoints: number | null;
  /** API key 是否可用 */
  available: boolean;
  /** key 缺失時的提示 */
  availabilityReason?: string;
  /** 該模型的擅長情境（人類可讀） */
  strengths: string[];
  /** 該模型不適合的情境 */
  weaknesses: string[];
  /** 對使用者目前 useCase 的匹配度（0-100），useCase 沒傳就是 50 */
  useCaseFit: number;
}

export interface CompareModelsResult {
  /** 結構化比較資料；UI 可直接渲染成表格 */
  rows: ComparedModelRow[];
  /** 推薦：給三種典型決策方向各挑一名代表（找不到就回 null） */
  recommendations: {
    cheapest: ComparedModelRow | null;
    bestQuality: ComparedModelRow | null;
    bestFit: ComparedModelRow | null; // useCase 匹配度最高的
  };
  /** 給「兩相比較」用的差異句（人話） */
  highlights: string[];
  /** 建議的下一棒 — 通常是 director / accountant / 對應 specialist */
  suggestedHandoff: {
    to: AgentRole;
    nickname: string;
    reason: string;
  };
  /** 整段一句話總結（適合貼進聊天） */
  summary: string;
}

// ─── Heuristics ─────────────────────────────────────────────────────────────
// 這些 heuristic 是基於 catalogue + 實際使用觀察。每個 modelId 對應一組
// 擅長 / 不擅長標籤；查 catalogue 沒有時走 categoryDefault。LLM 拿到這個
// 結構後可以直接引用，不必再去「猜」每個模型的個性。

const STRENGTHS_BY_MODEL: Record<string, { strengths: string[]; weaknesses: string[] }> = {
  // ── text-to-image ────────────────────────────────────────────────────
  "fal-ai/flux-pro/v1.1": {
    strengths: ["寫實光影", "商業質感", "細節豐富"],
    weaknesses: ["速度比 Schnell 慢", "點數較高"],
  },
  "fal-ai/flux-pro/v1.1-ultra": {
    strengths: ["旗艦寫實", "高解析", "印刷品質"],
    weaknesses: ["最貴", "時間長"],
  },
  "fal-ai/flux/dev": {
    strengths: ["寫實底", "可加 LoRA", "社群生態豐富"],
    weaknesses: ["商業質感略遜 Pro"],
  },
  "fal-ai/flux/schnell": {
    strengths: ["極快", "便宜", "適合大量試 prompt"],
    weaknesses: ["細節較少", "光影偏簡"],
  },
  "fal-ai/bytedance/seedream/v4/text-to-image": {
    strengths: ["東方美學", "插畫感", "海報構圖"],
    weaknesses: ["寫實人像略弱"],
  },
  "fal-ai/imagen4/preview": {
    strengths: ["品牌乾淨光", "排版友善", "高一致性"],
    weaknesses: ["藝術感較拘謹"],
  },
  "fal-ai/stable-diffusion-v35-large": {
    strengths: ["可加 LoRA", "ControlNet 支援", "可重現性高"],
    weaknesses: ["上手門檻較高", "需調 seed/CFG"],
  },
  // ── text-to-video / image-to-video ──────────────────────────────────
  "fal-ai/kling-video/v2.1/pro/image-to-video": {
    strengths: ["電影級運鏡", "情緒節奏", "光影層次"],
    weaknesses: ["最貴", "10s 以上點數膨脹"],
  },
  "fal-ai/kling-video/v2.1/standard/image-to-video": {
    strengths: ["首尾幀控制", "中文語意佳", "穩定 5s"],
    weaknesses: ["長片邏輯弱"],
  },
  "fal-ai/runway-gen4-turbo/image-to-video": {
    strengths: ["商業 5-10s teaser", "品牌一致性", "後製友善"],
    weaknesses: ["點數偏高", "中文語意稍弱"],
  },
  "fal-ai/pixverse/v4.5/image-to-video": {
    strengths: ["特效", "動漫風", "誇張運鏡"],
    weaknesses: ["寫實場景較弱"],
  },
  "fal-ai/wan-i2v": {
    strengths: ["高 CP 開源", "預覽運鏡夠用", "便宜"],
    weaknesses: ["質感不及 Kling"],
  },
  "fal-ai/minimax/hailuo-02/pro/image-to-video": {
    strengths: ["首幀固定", "電影感", "穩定鏡頭"],
    weaknesses: ["創意空間較少"],
  },
  "fal-ai/ltx-video/image-to-video": {
    strengths: ["可重現流程", "seed 可控", "工作流接軌"],
    weaknesses: ["風格較中性"],
  },
  // ── text-to-audio (music) ───────────────────────────────────────────
  "fal-ai/suno-v4": {
    strengths: ["含人聲歌曲", "完整段落", "風格多元"],
    weaknesses: ["短 BGM 算貴"],
  },
  "fal-ai/stable-audio": {
    strengths: ["環境音", "BGM 底", "便宜可循環"],
    weaknesses: ["無人聲", "風格較中性"],
  },
  "fal-ai/elevenlabs/music": {
    strengths: ["配樂", "情緒準確", "高品質"],
    weaknesses: ["長段落較貴"],
  },
  // ── text-to-speech (voice) ──────────────────────────────────────────
  "elevenlabs/eleven-v3": {
    strengths: ["中文短句", "情感表現", "咬字清楚"],
    weaknesses: ["長段落較貴"],
  },
  "elevenlabs/multilingual-v2": {
    strengths: ["多語切換", "穩定", "品牌音色"],
    weaknesses: ["情感變化偏中性"],
  },
  "fal-ai/kokoro/american-english": {
    strengths: ["TTS 草稿", "極便宜", "輕量"],
    weaknesses: ["僅英文", "情感表現一般"],
  },
};

const CATEGORY_DEFAULTS: Partial<Record<ModelCategory, { strengths: string[]; weaknesses: string[] }>> = {
  "text-to-image": { strengths: ["可生圖"], weaknesses: ["細節依模型差異大"] },
  "text-to-video": { strengths: ["可生影片"], weaknesses: ["長度受限"] },
  "image-to-video": { strengths: ["i2v"], weaknesses: ["首尾幀受起始圖影響"] },
  "text-to-audio": { strengths: ["可生音訊"], weaknesses: ["品質差異大"] },
  "text-to-speech": { strengths: ["可生語音"], weaknesses: ["語言支援度依模型"] },
};

function strengthsFor(modelId: string, category: ModelCategory): {
  strengths: string[];
  weaknesses: string[];
} {
  return (
    STRENGTHS_BY_MODEL[modelId] ??
    CATEGORY_DEFAULTS[category] ?? {
      strengths: [],
      weaknesses: [],
    }
  );
}

// useCase → 該 useCase 偏好的特徵 token；strengths 命中越多分越高。
const USE_CASE_KEYWORDS: Record<ModelUseCase, readonly string[]> = {
  draft: ["極快", "便宜", "草稿", "輕量"],
  production: ["寫實", "細節", "品質", "可重現"],
  cinematic: ["電影", "運鏡", "光影"],
  commercial: ["商業", "品牌", "乾淨"],
  anatomical: ["寫實", "ControlNet", "可加 LoRA"],
  loop_friendly: ["環境", "BGM", "循環"],
  vocal: ["人聲", "歌曲"],
  ambient: ["環境", "氛圍"],
  multilingual: ["多語", "語言"],
};

function scoreUseCaseFit(
  useCase: ModelUseCase | undefined,
  strengths: string[],
): number {
  if (!useCase) return 50;
  const tokens = USE_CASE_KEYWORDS[useCase];
  const hits = strengths.filter(s =>
    tokens.some(t => s.includes(t)),
  ).length;
  // 0 命中 = 30；每命中一個加 20，上限 100。
  return Math.min(100, 30 + hits * 20);
}

// tier → 品質分數（找 bestQuality 用）
const TIER_QUALITY_SCORE: Record<PricingTier, number> = {
  free: 1,
  economy: 2,
  standard: 3,
  premium: 4,
  ultra: 5,
};

// ─── Core: compareModels ────────────────────────────────────────────────────

/**
 * 從 MODEL_PRICING_CATALOG 拉出某類別的所有模型（或指定的 modelIds）並產生
 * 結構化比較。回傳資料完全可序列化，給 UI / planner / 其它 spirit 引用都
 * 無痛。所有判斷都是 deterministic — 同樣的 input 永遠得到同樣的 rows，
 * 方便 vitest 釘規格。
 */
export function compareModels(input: CompareModelsInput): CompareModelsResult {
  const maxResults = Math.max(1, Math.min(20, input.maxResults ?? 8));
  const includeUnavailable = !!input.includeUnavailable;

  // 1. 蒐集候選 — 指定 modelIds 優先；否則從 catalogue 抓該類別。
  const candidates: ModelPricing[] = [];
  if (input.modelIds && input.modelIds.length > 0) {
    for (const id of input.modelIds) {
      const p = MODEL_PRICING_CATALOG[id];
      if (p) candidates.push(p);
    }
  } else {
    for (const p of Object.values(MODEL_PRICING_CATALOG)) {
      if (p.category === input.category) candidates.push(p);
    }
  }

  // 2. 篩可用性
  let filtered = candidates;
  if (!includeUnavailable) {
    filtered = candidates.filter(p => checkModelAvailability(p.modelId).available);
  }

  // 3. 排序：依 basePoints 升冪，方便 cheapest / fit 後續取頭。
  filtered.sort((a, b) => a.basePoints - b.basePoints);
  filtered = filtered.slice(0, maxResults);

  // 4. 組 rows
  const rows: ComparedModelRow[] = filtered.map(p => {
    const avail = checkModelAvailability(p.modelId);
    const { strengths, weaknesses } = strengthsFor(p.modelId, p.category);
    const useCaseFit = scoreUseCaseFit(input.useCase, strengths);
    const estimated = input.estimateFor
      ? estimatePoints(p.modelId, input.estimateFor).totalPoints
      : null;
    return {
      modelId: p.modelId,
      label: p.label,
      provider: p.provider,
      tier: p.tier,
      category: p.category,
      pointsRange: { min: p.minPoints, max: p.maxPoints },
      costUsdRange: {
        min: pointsToUsd(p.minPoints),
        max: pointsToUsd(p.maxPoints),
      },
      estimatedPoints: estimated,
      available: avail.available,
      availabilityReason: avail.available ? undefined : avail.reason,
      strengths,
      weaknesses,
      useCaseFit,
    };
  });

  // 5. 推薦三選一
  const cheapest = rows.length > 0 ? rows[0] : null;
  const bestQuality = rows.length > 0
    ? rows.reduce((best, r) =>
        TIER_QUALITY_SCORE[r.tier] > TIER_QUALITY_SCORE[best.tier] ? r : best,
      )
    : null;
  const bestFit = input.useCase && rows.length > 0
    ? rows.reduce((best, r) => (r.useCaseFit > best.useCaseFit ? r : best))
    : null;

  // 6. Highlights — 一句話描述「同一類別內為什麼選 A 不選 B」
  const highlights = buildHighlights(rows);

  // 7. 建議下一棒 — 查查交棒給誰，依 result 結構決定
  const handoff = pickHandoff(input.category, rows.length);

  const summary = buildSummary({
    category: input.category,
    rowCount: rows.length,
    cheapest,
    bestQuality,
    bestFit,
    useCase: input.useCase,
  });

  logger.debug("researcher_compareModels", {
    category: input.category,
    rowCount: rows.length,
    requestedModelIds: input.modelIds?.length ?? 0,
    useCase: input.useCase,
    includeUnavailable,
  });

  return {
    rows,
    recommendations: { cheapest, bestQuality, bestFit },
    highlights,
    suggestedHandoff: handoff,
    summary,
  };
}

function buildHighlights(rows: ComparedModelRow[]): string[] {
  if (rows.length === 0) return [];
  const out: string[] = [];
  // 點數差距 — 找出最大跟最小的點數差
  const minPts = rows[0].pointsRange.min;
  const maxPts = rows.reduce((m, r) => Math.max(m, r.pointsRange.max), 0);
  if (maxPts > minPts * 2) {
    out.push(
      `價差顯著：最便宜 ${minPts} pts 起、最貴上看 ${maxPts} pts／次（建議讓財財算一輪`,
    );
  }
  // 不同 tier
  const tiers = new Set(rows.map(r => r.tier));
  if (tiers.size >= 2) {
    out.push(`涵蓋 ${[...tiers].join(" / ")} 多個 tier，建議用情境二選一`);
  }
  // available 不全
  const unavailable = rows.filter(r => !r.available);
  if (unavailable.length > 0) {
    out.push(
      `${unavailable.length} 個模型目前缺 API key：${unavailable.map(r => r.label).join(", ")}`,
    );
  }
  return out;
}

function pickHandoff(
  category: ModelCategory,
  rowCount: number,
): CompareModelsResult["suggestedHandoff"] {
  // 沒比到東西時 → 交給 companion
  if (rowCount === 0) {
    return {
      to: "companion",
      nickname: getPrimaryNicknameForRole("companion"),
      reason: "目錄裡沒找到符合的模型，建議讓暖暖陪聊釐清需求",
    };
  }
  // 依 category 對應的 specialist
  const map: Partial<Record<ModelCategory, AgentRole>> = {
    "text-to-image": "image-specialist",
    "image-to-image": "image-specialist",
    "image-to-3d": "image-specialist",
    "text-to-3d": "image-specialist",
    "image-to-json": "image-specialist",
    "text-to-video": "video-specialist",
    "image-to-video": "video-specialist",
    "video-to-video": "video-specialist",
    "video-to-text": "video-specialist",
    "video-to-audio": "video-specialist",
    "text-to-audio": "music-specialist",
    "text-to-speech": "voice-specialist",
    "audio-to-text": "voice-specialist",
    training: "training-specialist",
  };
  const target: AgentRole = map[category] ?? "director";
  return {
    to: target,
    nickname: getPrimaryNicknameForRole(target),
    reason:
      target === "director"
        ? "查完讓導導排成可執行步驟"
        : `挑定模型後讓 @${getPrimaryNicknameForRole(target)} 接手實作`,
  };
}

function buildSummary(input: {
  category: ModelCategory;
  rowCount: number;
  cheapest: ComparedModelRow | null;
  bestQuality: ComparedModelRow | null;
  bestFit: ComparedModelRow | null;
  useCase?: ModelUseCase;
}): string {
  if (input.rowCount === 0) {
    return `${input.category} 類別內沒找到符合條件的模型`;
  }
  const parts: string[] = [`比了 ${input.rowCount} 個 ${input.category} 模型`];
  if (input.cheapest) {
    parts.push(`最便宜：${input.cheapest.label}（${input.cheapest.pointsRange.min} pts 起）`);
  }
  if (input.bestQuality && input.bestQuality.modelId !== input.cheapest?.modelId) {
    parts.push(`旗艦：${input.bestQuality.label}（${input.bestQuality.tier} tier）`);
  }
  if (input.useCase && input.bestFit) {
    parts.push(
      `最貼 ${input.useCase}：${input.bestFit.label}（fit ${input.bestFit.useCaseFit}）`,
    );
  }
  return parts.join("；");
}

// ─── Helper: list available categories ──────────────────────────────────────

export function getCategoriesInCatalog(): ModelCategory[] {
  const set = new Set<ModelCategory>();
  for (const p of Object.values(MODEL_PRICING_CATALOG)) {
    set.add(p.category);
  }
  return [...set].sort();
}

// 預留：未來要擴 summarizeSources / factCheck / saveFindings 時，新函式
// 加在同檔案下面、保持單一研究 spirit 的工具集中。getModelPricing 是 re-
// export，方便 dispatchResearcherTool 在沒拿到匹配 modelId 時做基線 fallback。
export { getModelPricing };
