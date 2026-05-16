/**
 * server/services/spiritTools/musicSpecialistTools.ts
 *
 * 音音 (music-specialist) 的真實工具集 — 把音樂精靈從「prompt 寫死 suno-v4 /
 * audio-craft」的嘴砲 agent 升級成「會挑模型、會估點數、會做 model-specific
 * prompt、會掃使用者素材庫」的真實 AI agent。
 *
 * 之前的問題：
 *   - generate() 強制 modelId = "suno-v4"（音樂全押 Suno），SFX 強制 "audio-craft"
 *     但 audio-craft 不在 modelPricing catalog 內（成本對帳失敗）。
 *   - 沒有 model 選擇能力 — 使用者說「30 秒 lo-fi loop」音音照樣丟 Suno 整首歌
 *     ($0.10 vs Stable Audio $0.05，使用者被多收一倍）。
 *   - 沒有 prompt 工程能力 — Stable Audio 吃「seconds_total + 簡短風格詞」、
 *     ACE-Step 吃 lyrics、MusicGen 不接受 lyrics —— 之前一律塞同一個 prompt，
 *     ACE-Step 沒拿到 lyrics 退化成純伴奏。
 *   - 沒在 global-agent-tools.ts 註冊 → LLM 呼叫 musicSpecialist.* 通常被門擋掉。
 *
 * 本檔提供八個工具（讀為主、寫只動 generate / SFX）：
 *   - recommendEngine — 依需求（情緒/長度/有無人聲/預算）挑出引擎 + 備援鏈
 *   - buildPrompt     — 把結構化需求轉成 model-specific prompt string
 *   - estimateCost    — 估算單次音樂任務點數（共享 accountantTools.estimateCost）
 *   - listEngines     — 依能力（music / sfx / stems / isolation / merge）列引擎
 *   - getRecentAssets — 拉使用者最近的音檔素材（讓音音知道庫裡已有什麼）
 *   - getOptions      — 列出常用 genres / moods（語意對映）
 *   - getTips         — 給 prompt 撰寫提示
 *   - generate        — 真實打 fal/Suno 出音樂（接通 brain audioEngine + 自動選引擎）
 *   - generateSoundEffect — 真實打 SFX-capable 引擎（自動降級 ElevenLabs ↔ Stable）
 */

import { logger } from "../../_core/logger";
import { humanizeToolError } from "./errorHumanizer";
import {
  MODEL_PRICING_CATALOG,
  estimatePoints,
  getModelPricing,
  type ModelPricing,
  type PricingTier,
} from "../modelPricing";
import { getDigitalAssetsByUser, getHistoryByUser } from "../../db";

// ─── 引擎能力分類 ─────────────────────────────────────────────────────────────
//
// 為什麼要這個表：modelPricing catalog 只有 category="text-to-audio"，分不出
// 「能做完整歌（含 vocals）」、「能做 SFX 短音」、「只能做純伴奏」。把人類
// 知道的能力（vocals / instrumental / sfx / loop / multilingual / stems）
// 顯式列出，recommendEngine 才能對需求做精準匹配。
// ────────────────────────────────────────────────────────────────────────────

export type AudioCapability =
  | "music-vocals"      // 能產生帶人聲的完整歌曲
  | "music-instrumental"// 能產生純伴奏 / BGM
  | "music-loop"        // 適合 seamless loop（短循環 BGM）
  | "music-ambient"     // 適合環境音 / 氛圍底
  | "sfx"               // 音效（鼓擊、爆炸、雨聲）
  | "stems"             // 音軌分離
  | "isolation"         // 從噪音背景抽出人聲
  | "merge";            // 多段音訊合併

export interface AudioEngineProfile {
  modelId: string;
  capabilities: AudioCapability[];
  /** 該引擎理想的時長範圍（秒）— 超出範圍會被降級評分 */
  idealDurationSec: [number, number];
  /** 一句話描述何時用 */
  bestFor: string;
  /** 是否需要除了 FAL_API_KEY 之外的額外金鑰 */
  extraKeyEnv?: string;
}

// 注意：這份 profile 表只列「音音實際在 routing 中會用到」的引擎；非音樂類
// （text-to-speech / video-to-audio）不收進來，由 voice-specialist / generic
// studio tools 自行管理。
const AUDIO_ENGINE_PROFILES: AudioEngineProfile[] = [
  {
    modelId: "fal-ai/stable-audio",
    capabilities: ["music-instrumental", "music-loop", "music-ambient", "sfx"],
    idealDurationSec: [5, 60],
    bestFor: "30-60 秒 instrumental loop / ambient / 短 SFX",
  },
  {
    modelId: "fal-ai/ace-step",
    capabilities: ["music-vocals", "music-instrumental"],
    idealDurationSec: [30, 240],
    bestFor: "可選 lyrics 的中長段歌曲（開源、可控）",
  },
  {
    modelId: "fal-ai/musicgen",
    capabilities: ["music-instrumental"],
    idealDurationSec: [5, 30],
    bestFor: "快速便宜的伴奏草稿（無人聲）",
  },
  {
    modelId: "fal-ai/mmaudio-v2",
    capabilities: ["sfx", "music-ambient"],
    idealDurationSec: [1, 15],
    bestFor: "影片配音效 / 短 SFX",
  },
  {
    modelId: "fal-ai/audioldm2",
    capabilities: ["sfx", "music-ambient"],
    idealDurationSec: [1, 15],
    bestFor: "（已下架，dispatcher 自動 normalize 到 mmaudio-v2）",
  },
  {
    modelId: "suno-v4",
    capabilities: ["music-vocals", "music-instrumental"],
    idealDurationSec: [60, 240],
    bestFor: "完整歌曲（含人聲段落 + 副歌結構）",
    extraKeyEnv: "SUNO_API_KEY",
  },
  {
    modelId: "suno-v3.5",
    capabilities: ["music-vocals", "music-instrumental"],
    idealDurationSec: [30, 180],
    bestFor: "完整歌曲 — Suno V4 的便宜版本",
    extraKeyEnv: "SUNO_API_KEY",
  },
  {
    modelId: "gemini/lyria-2",
    capabilities: ["music-instrumental", "music-ambient"],
    idealDurationSec: [15, 60],
    bestFor: "高品質 instrumental（電影感、情緒場景）",
    extraKeyEnv: "GEMINI_API_KEY",
  },
  {
    modelId: "elevenlabs/music",
    capabilities: ["music-vocals", "music-instrumental"],
    idealDurationSec: [15, 120],
    bestFor: "高品質歌曲 + ElevenLabs 聲線結合",
    extraKeyEnv: "ELEVENLABS_API_KEY",
  },
  {
    modelId: "elevenlabs/sound-effects",
    capabilities: ["sfx"],
    idealDurationSec: [1, 22],
    bestFor: "短音效（爆炸、開門、敲擊）— 最自然的 SFX",
    extraKeyEnv: "ELEVENLABS_API_KEY",
  },
  {
    modelId: "fal-ai/elevenlabs/sound-effects/v2",
    capabilities: ["sfx"],
    idealDurationSec: [1, 22],
    bestFor: "短音效（via fal 路徑，與 elevenlabs/sound-effects 等價）",
    extraKeyEnv: "ELEVENLABS_API_KEY",
  },
];

const PROFILE_BY_ID = new Map<string, AudioEngineProfile>(
  AUDIO_ENGINE_PROFILES.map(p => [p.modelId, p])
);

// ─── recommendEngine ──────────────────────────────────────────────────────────

export interface RecommendEngineInput {
  /** 高層能力（必填）— 決定主要候選池 */
  capability: AudioCapability;
  /** 目標長度（秒） */
  durationSec?: number;
  /** 是否需要人聲（"music-vocals" 已含，但這欄可用來在 "music-instrumental"
   *  時 explicit reject 帶人聲的引擎） */
  needsVocals?: boolean;
  /** 預算優先：true → 偏好 economy/standard；false（預設） → 平衡品質與成本 */
  prioritizeBudget?: boolean;
  /** 排除這些引擎（例如使用者已試過某個不喜歡） */
  excludeModelIds?: string[];
}

export interface EngineRecommendation {
  modelId: string;
  label: string;
  tier: PricingTier;
  totalPoints: number;
  reason: string;
  /** 缺金鑰 → notAvailable=true，會被降權但仍列出，讓 UI / LLM 提示去設定 */
  notAvailable: boolean;
  missingKeyEnv?: string;
}

export interface RecommendEngineResult {
  primary: EngineRecommendation | null;
  /** 同等級的備援，依分數遞減（不含 primary） */
  alternates: EngineRecommendation[];
  /** 完整的候選總數（filter 前） */
  poolSize: number;
}

/**
 * 推薦引擎評分規則（高 → 低）：
 *   1. capability 命中（不命中 → 直接排除）
 *   2. durationSec 落在 idealDurationSec 內 → +2 分
 *   3. needsVocals=false 且引擎只有 instrumental → +1 分（純伴奏目的下偏好專一引擎）
 *   4. prioritizeBudget=true → tier 越低分數越高（economy=+3, standard=+1, premium=0, ultra=-1）
 *      prioritizeBudget=false → 平衡：premium=+1, standard=+1, economy=0, ultra=-2
 *   5. 缺 key → -5 分（不直接過濾，讓 LLM 能提醒「沒設這個 key」）
 *
 * 排序後最高分為 primary，第 2-3 名為 alternates。
 */
export function recommendEngine(input: RecommendEngineInput): RecommendEngineResult {
  const exclude = new Set(input.excludeModelIds ?? []);
  const candidates = AUDIO_ENGINE_PROFILES.filter(p => {
    if (exclude.has(p.modelId)) return false;
    if (!p.capabilities.includes(input.capability)) return false;
    // 要求純伴奏 → 排除「只能出帶人聲」的引擎（保留 both-capable 的）
    if (
      input.needsVocals === false &&
      p.capabilities.includes("music-vocals") &&
      !p.capabilities.includes("music-instrumental")
    ) {
      return false;
    }
    // 要求人聲 → 必須有 music-vocals
    if (input.needsVocals === true && !p.capabilities.includes("music-vocals")) {
      return false;
    }
    return true;
  });

  const tierScore = input.prioritizeBudget
    ? { free: 4, economy: 3, standard: 1, premium: 0, ultra: -1 }
    : { free: 0, economy: 0, standard: 1, premium: 1, ultra: -2 };

  const scored = candidates.map(profile => {
    const pricing = getModelPricing(profile.modelId);
    let score = 0;
    const reasons: string[] = [];

    // duration 適配
    if (input.durationSec !== undefined) {
      const [lo, hi] = profile.idealDurationSec;
      if (input.durationSec >= lo && input.durationSec <= hi) {
        score += 2;
        reasons.push(`時長 ${input.durationSec}s 在 ${lo}-${hi}s 甜蜜區`);
      } else {
        const distance = input.durationSec < lo ? lo - input.durationSec : input.durationSec - hi;
        score -= Math.min(2, distance / 30);
        reasons.push(
          `時長 ${input.durationSec}s 偏離 ${lo}-${hi}s 區間（${distance.toFixed(0)}s）`
        );
      }
    }

    // 純伴奏目的 + 引擎只做 instrumental → 偏好
    if (
      input.needsVocals === false &&
      profile.capabilities.includes("music-instrumental") &&
      !profile.capabilities.includes("music-vocals")
    ) {
      score += 1;
      reasons.push("純伴奏專一引擎");
    }

    // tier 評分
    if (pricing) {
      const ts = tierScore[pricing.tier] ?? 0;
      score += ts;
      if (input.prioritizeBudget && ts > 0) {
        reasons.push(`${pricing.tier} tier 省點`);
      } else if (!input.prioritizeBudget && ts > 0) {
        reasons.push(`${pricing.tier} tier 品質佳`);
      }
    }

    // 缺 key → 降權
    const missingKey =
      profile.extraKeyEnv && !process.env[profile.extraKeyEnv]
        ? profile.extraKeyEnv
        : undefined;
    if (missingKey) {
      score -= 5;
      reasons.push(`需要 ${missingKey}（未設定）`);
    }

    const est = estimatePoints(profile.modelId, {
      durationSec: input.durationSec,
    });

    return {
      profile,
      pricing,
      score,
      reasons,
      totalPoints: est.totalPoints,
      missingKey,
    };
  });

  // tie-break：分數相同時 budget 模式取點數少；品質模式取點數多但不超 30
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (input.prioritizeBudget) return a.totalPoints - b.totalPoints;
    return Math.min(b.totalPoints, 30) - Math.min(a.totalPoints, 30);
  });

  const toRec = (s: typeof scored[number]): EngineRecommendation => ({
    modelId: s.profile.modelId,
    label: s.pricing?.label ?? s.profile.modelId,
    tier: s.pricing?.tier ?? "standard",
    totalPoints: s.totalPoints,
    reason: s.reasons.join("、") || s.profile.bestFor,
    notAvailable: !!s.missingKey,
    ...(s.missingKey ? { missingKeyEnv: s.missingKey } : {}),
  });

  return {
    primary: scored[0] ? toRec(scored[0]) : null,
    alternates: scored.slice(1, 4).map(toRec),
    poolSize: candidates.length,
  };
}

// ─── buildPrompt ──────────────────────────────────────────────────────────────

export interface BuildPromptInput {
  /** 目標引擎；不同引擎吃不同欄位（Suno 吃 lyrics 段落 / Stable Audio 不吃 lyrics） */
  modelId: string;
  /** 情緒：療癒 / 振奮 / 緊張 / 憂鬱 / ... */
  mood?: string;
  /** 風格：lo-fi / cinematic / jazz / ambient / electronic / ... */
  genre?: string;
  /** 樂器：piano / guitar / synth / strings / drums / ... */
  instruments?: string[];
  /** BPM（節拍）— Suno / Sonauto 有效；MusicGen / Stable Audio 用 prompt 提示 */
  bpm?: number;
  /** 是否要 seamless loop */
  seamlessLoop?: boolean;
  /** 自由補充：「片頭使用」「鋼琴主導」之類 */
  references?: string;
  /** Suno / ACE-Step 才會用到的 lyrics 文字（換行分段） */
  lyrics?: string;
  /** 期望時長（秒） — 加進 prompt 提示，dispatcher 也會用 */
  durationSec?: number;
}

export interface BuildPromptResult {
  modelId: string;
  /** 主 prompt（給 fal input.prompt） */
  prompt: string;
  /** 可選 lyrics（給 fal input.lyrics 或 input.lyrics_prompt） */
  lyrics?: string;
  /** Sonauto tags（chip 風格分類，逗號分隔） */
  tags?: string;
  /** 給 LLM / 使用者看的提示，說明這 prompt 為什麼這樣寫 */
  rationale: string;
}

/**
 * 把結構化欄位轉成 model-specific prompt。不打 API、不存 DB，純文字組合。
 *
 * 規則：
 *   - Suno（含 v3.5/v4） → mood + genre + instruments + bpm 加進 prompt，
 *     lyrics 直接帶出
 *   - ACE-Step → 純 prompt 風格詞 + lyrics（若提供）
 *   - Stable Audio → 短而精的「genre + mood + key instruments」+ seamless loop hint
 *   - MusicGen → 純風格短句，不帶 lyrics（會被丟棄）
 *   - Sonauto → prompt + tags（逗號分隔 chip）
 *   - SFX 引擎（mmaudio / elevenlabs/sound-effects） → 用 references + 短描述
 */
export function buildPrompt(input: BuildPromptInput): BuildPromptResult {
  const parts: string[] = [];
  if (input.mood) parts.push(input.mood);
  if (input.genre) parts.push(input.genre);
  if (input.instruments && input.instruments.length > 0) {
    parts.push(`featuring ${input.instruments.join(", ")}`);
  }
  if (input.bpm) parts.push(`${input.bpm} BPM`);
  if (input.references) parts.push(input.references);
  if (input.seamlessLoop) parts.push("seamless loop, no fade out");
  if (input.durationSec) parts.push(`~${input.durationSec}s`);

  const promptBase = parts.filter(Boolean).join(", ").trim();
  const modelId = input.modelId;
  const id = modelId.toLowerCase();

  // Suno：吃 prompt + 段落式 lyrics，可放 [Verse]/[Chorus] tag
  if (id.startsWith("suno")) {
    return {
      modelId,
      prompt: promptBase || (input.lyrics ? "" : "instrumental"),
      ...(input.lyrics ? { lyrics: input.lyrics } : {}),
      rationale:
        "Suno 接 prompt（風格 + 樂器）+ 段落式 lyrics（用 [Verse] / [Chorus] 分段最有效）。沒給 lyrics 會自動生成。",
    };
  }

  // ACE-Step：lyrics + duration 走 dispatcher
  if (id === "fal-ai/ace-step") {
    return {
      modelId,
      prompt: promptBase || "instrumental track",
      ...(input.lyrics ? { lyrics: input.lyrics } : {}),
      rationale:
        "ACE-Step 接純風格 prompt + 可選 lyrics。風格詞越具體越穩，BPM / 樂器寫進 prompt。",
    };
  }

  // Sonauto：tags + prompt + lyrics_prompt
  if (id === "sonauto/v2/text-to-music") {
    const tagParts: string[] = [];
    if (input.genre) tagParts.push(input.genre);
    if (input.mood) tagParts.push(input.mood);
    if (input.instruments) tagParts.push(...input.instruments);
    return {
      modelId,
      prompt: promptBase || (input.genre ?? "instrumental"),
      ...(input.lyrics ? { lyrics: input.lyrics } : {}),
      ...(tagParts.length ? { tags: tagParts.join(", ") } : {}),
      rationale:
        "Sonauto v2 用 tags（chip 風格分類）+ prompt（自由描述）+ lyrics_prompt。BPM 走獨立欄位（dispatcher 處理）。",
    };
  }

  // MusicGen：純短句風格，不吃 lyrics（會被 dispatcher 丟）
  if (id === "fal-ai/musicgen") {
    return {
      modelId,
      prompt: promptBase || "instrumental music",
      rationale:
        "MusicGen 純伴奏 — lyrics 會被忽略；prompt 寫風格 / 樂器 / 節奏關鍵詞，越短越穩。",
    };
  }

  // Stable Audio：seamless loop 是常用 hint；seconds_total 由 dispatcher 處理
  if (id === "fal-ai/stable-audio") {
    return {
      modelId,
      prompt: promptBase || "ambient music",
      rationale:
        "Stable Audio 偏好簡短風格詞（30 秒以內最穩）。要做 BGM loop 在 prompt 加「seamless loop, no fade out」。",
    };
  }

  // mmaudio / audioldm2 / elevenlabs SFX：純描述（短）
  if (id.includes("mmaudio") || id.includes("audioldm") || id.includes("sound-effects")) {
    return {
      modelId,
      prompt: promptBase || "ambient sound effect",
      rationale:
        "SFX 引擎吃「事件本身的聲音描述」（例如 thunder, footsteps on gravel, door creak），越具體越像。",
    };
  }

  // 預設：把所有欄位拼起來，讓 dispatcher 決定怎麼用
  return {
    modelId,
    prompt: promptBase || "instrumental music",
    ...(input.lyrics ? { lyrics: input.lyrics } : {}),
    rationale: "未識別引擎 — 採通用 prompt（風格 + 樂器 + 節奏）+ 可選 lyrics。",
  };
}

// ─── estimateCost ─────────────────────────────────────────────────────────────

export interface EstimateMusicCostInput {
  modelId: string;
  durationSec?: number;
}

export interface EstimateMusicCostResult {
  modelId: string;
  label: string | null;
  tier: PricingTier | null;
  totalPoints: number;
  basePoints: number;
  breakdown: string;
  isUnknownModel: boolean;
}

/**
 * 估算一首音樂的點數。對齊 accountantTools.estimateCost，但只回音樂相關欄位。
 */
export function estimateMusicCost(input: EstimateMusicCostInput): EstimateMusicCostResult {
  const pricing = getModelPricing(input.modelId);
  const est = estimatePoints(input.modelId, { durationSec: input.durationSec });
  return {
    modelId: input.modelId,
    label: pricing?.label ?? null,
    tier: pricing?.tier ?? null,
    totalPoints: est.totalPoints,
    basePoints: est.basePoints,
    breakdown: est.breakdown,
    isUnknownModel: !pricing,
  };
}

// ─── listEngines ──────────────────────────────────────────────────────────────

export interface ListEnginesInput {
  /** 過濾條件；不給 → 列所有 audio 引擎 */
  capability?: AudioCapability;
}

export interface ListEnginesRow {
  modelId: string;
  label: string;
  tier: PricingTier;
  capabilities: AudioCapability[];
  idealDurationSec: [number, number];
  bestFor: string;
  basePoints: number;
  /** 預估 30 秒任務的點數，讓 LLM 一句話講得出來「便宜還是貴」 */
  estimated30sPoints: number;
  notAvailable: boolean;
  missingKeyEnv?: string;
}

export interface ListEnginesResult {
  capability: AudioCapability | "all";
  count: number;
  rows: ListEnginesRow[];
}

export function listEngines(input: ListEnginesInput = {}): ListEnginesResult {
  const filtered = AUDIO_ENGINE_PROFILES.filter(p =>
    input.capability ? p.capabilities.includes(input.capability) : true
  );

  const rows = filtered.map(profile => {
    const pricing = getModelPricing(profile.modelId);
    const est = estimatePoints(profile.modelId, { durationSec: 30 });
    const missingKey =
      profile.extraKeyEnv && !process.env[profile.extraKeyEnv]
        ? profile.extraKeyEnv
        : undefined;
    return {
      modelId: profile.modelId,
      label: pricing?.label ?? profile.modelId,
      tier: pricing?.tier ?? ("standard" as PricingTier),
      capabilities: profile.capabilities,
      idealDurationSec: profile.idealDurationSec,
      bestFor: profile.bestFor,
      basePoints: pricing?.basePoints ?? 0,
      estimated30sPoints: est.totalPoints,
      notAvailable: !!missingKey,
      ...(missingKey ? { missingKeyEnv: missingKey } : {}),
    };
  });

  rows.sort((a, b) => a.estimated30sPoints - b.estimated30sPoints);

  return {
    capability: input.capability ?? "all",
    count: rows.length,
    rows,
  };
}

// ─── getRecentAssets ──────────────────────────────────────────────────────────

export interface RecentAudioAsset {
  source: "asset" | "history";
  id: number;
  title: string;
  url: string | null;
  modelId: string | null;
  createdAt: string | null;
  /** 給 LLM 一句話介紹 — asset 用 description、history 用 prompt */
  note: string | null;
}

export interface GetRecentAssetsResult {
  assetCount: number;
  historyCount: number;
  items: RecentAudioAsset[];
}

/**
 * 拉使用者最近的音檔資產 + 音樂生成歷史，限定 audio 類型，預設回最近 10 筆。
 * 用途：使用者說「再來一個跟上次那首一樣風格的」時，音音可以先掃這個拿到
 * 之前的 prompt / modelId 直接重組，不用瞎猜。
 */
export async function getRecentAudioAssets(
  userId: number,
  limit = 10
): Promise<GetRecentAssetsResult> {
  const cap = Math.max(1, Math.min(30, Math.trunc(limit)));
  try {
    const [assetsRaw, historyRaw] = await Promise.all([
      getDigitalAssetsByUser(userId).catch(() => []),
      getHistoryByUser(userId, 60).catch(() => []),
    ]);

    // assetType 只在「audio」/「voice」時收進來 — voice 是音音的相鄰領域，
    // 經常會被音音查（例如「上次的旁白音檔抓進來壓 BGM」）。
    const audioAssetTypes = new Set(["audio", "voice", "music"]);
    const assetItems: RecentAudioAsset[] = (assetsRaw as Array<Record<string, unknown>>)
      .filter(row => audioAssetTypes.has(String(row.assetType ?? "")))
      .slice(0, cap)
      .map(row => ({
        source: "asset" as const,
        id: Number(row.id ?? 0),
        title: String(row.title ?? `素材 #${row.id}`),
        url: typeof row.fileUrl === "string" ? row.fileUrl : null,
        modelId: typeof row.modelUsed === "string" ? row.modelUsed : null,
        createdAt: row.createdAt ? String(row.createdAt) : null,
        note: typeof row.description === "string" ? row.description : null,
      }));

    // history.modality 過 audio + voice — 同上原因
    const audioHistoryMods = new Set(["audio", "voice", "music"]);
    const historyItems: RecentAudioAsset[] = (historyRaw as Array<Record<string, unknown>>)
      .filter(row => audioHistoryMods.has(String(row.modality ?? "")))
      .slice(0, cap)
      .map(row => ({
        source: "history" as const,
        id: Number(row.id ?? 0),
        title: typeof row.prompt === "string" ? row.prompt.slice(0, 80) : `生成 #${row.id}`,
        url: typeof row.resultUrl === "string" ? row.resultUrl : null,
        modelId: typeof row.modelId === "string" ? row.modelId : null,
        createdAt: row.createdAt ? String(row.createdAt) : null,
        note: typeof row.prompt === "string" ? row.prompt.slice(0, 200) : null,
      }));

    // 合併並依 createdAt 倒序 — null 留到尾巴
    const merged = [...assetItems, ...historyItems];
    merged.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return {
      assetCount: assetItems.length,
      historyCount: historyItems.length,
      items: merged.slice(0, cap),
    };
  } catch (err) {
    logger.warn("[MusicSpecialistTools] getRecentAudioAssets failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { assetCount: 0, historyCount: 0, items: [] };
  }
}

// ─── getOptions / getTips ────────────────────────────────────────────────────

export function getMusicOptions(): {
  success: boolean;
  genres: string[];
  moods: string[];
  capabilities: AudioCapability[];
} {
  return {
    success: true,
    genres: [
      "pop", "rock", "jazz", "classical", "electronic",
      "hip-hop", "country", "folk", "ambient", "cinematic",
      "lo-fi", "indie", "metal", "r&b", "latin",
      "synthwave", "orchestral", "acoustic", "edm", "trap",
    ],
    moods: [
      "happy", "sad", "energetic", "calm", "mysterious",
      "epic", "romantic", "dark", "uplifting", "nostalgic",
      "tense", "playful", "melancholic", "powerful", "dreamy",
      "healing", "meditative", "anxious", "triumphant", "introspective",
    ],
    capabilities: [
      "music-vocals",
      "music-instrumental",
      "music-loop",
      "music-ambient",
      "sfx",
      "stems",
      "isolation",
      "merge",
    ],
  };
}

export function getMusicGenerationTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "描述風格 + 節奏：「快節奏 lo-fi 電子，90 BPM」、「慢板鋼琴抒情，60 BPM」",
      "加入情緒和氛圍：「振奮人心」、「療癒沉思」、「緊張懸疑」",
      "提及樂器：「鋼琴主導」、「弦樂編制」、「合成器音色」",
      "指定用途：「IG Reels 配樂」、「片頭」、「片尾」、「BGM」",
      "純伴奏 → 用 needsVocals=false 且引擎挑 stable-audio / musicgen，避免 Suno 給你帶人聲",
      "Loop / 短 BGM → 在 prompt 加「seamless loop, no fade out」（Stable Audio 最會這個）",
      "30 秒以內 BGM → Stable Audio 最便宜；要 vocals → Suno V4；環境音 → mmaudio-v2",
      "對嘴 / 旁白底 → 先請聲聲做旁白，再請我用 Stable Audio 壓 BGM 底",
    ],
  };
}

// ─── generate / generateSoundEffect ──────────────────────────────────────────
//
// 真實打 fal.ai / Suno 的生成入口。重點變更（vs. 舊版）：
//   - modelId 預設改為「使用者大腦 audioEngine」，沒設才 fallback；不再硬寫
//     "suno-v4"（之前所有音音請求都被導去 Suno）
//   - capability 缺金鑰時自動降級（缺 SUNO_API_KEY 退回 ACE-Step）
//   - SFX 直接走 fal-ai/stable-audio / mmaudio-v2 / elevenlabs/sound-effects/v2，
//     不再硬寫不存在 catalog 的 "audio-craft"
// ────────────────────────────────────────────────────────────────────────────

export interface GenerateMusicInput {
  userId: number;
  prompt: string;
  modelId?: string;
  duration?: number;
  genre?: string;
  mood?: string;
  /** 預設 false（會生 vocals）；要純伴奏設 true */
  instrumental?: boolean;
  /** Suno / ACE-Step 才會用 */
  lyrics?: string;
  /** Sonauto 才會用 */
  tags?: string;
  bpm?: number;
}

export interface GenerateMusicResult {
  success: boolean;
  jobId?: string;
  modelIdUsed?: string;
  message: string;
}

async function pickAudioEngineWithBrainFallback(
  userId: number,
  explicit?: string
): Promise<string> {
  if (explicit) return explicit;
  try {
    const { buildBrainContext } = await import("../../middleware/brainContext");
    const brain = await buildBrainContext(userId);
    return brain.generation.audioEngine.engine || "fal-ai/ace-step";
  } catch {
    return "fal-ai/ace-step";
  }
}

export async function generateMusic(input: GenerateMusicInput): Promise<GenerateMusicResult> {
  let modelIdUsed = await pickAudioEngineWithBrainFallback(input.userId, input.modelId);

  // 缺金鑰自動降級：Suno → ACE-Step、ElevenLabs → Stable Audio
  if (modelIdUsed.toLowerCase().startsWith("suno") && !process.env.SUNO_API_KEY) {
    modelIdUsed = "fal-ai/ace-step";
  }
  if (modelIdUsed.startsWith("elevenlabs/") && !process.env.ELEVENLABS_API_KEY) {
    modelIdUsed = "fal-ai/stable-audio";
  }
  if (modelIdUsed.startsWith("gemini/") && !process.env.GEMINI_API_KEY) {
    modelIdUsed = "fal-ai/stable-audio";
  }

  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const params: Record<string, unknown> = {
      duration: input.duration ?? 30,
    };
    if (input.genre) params.genre = input.genre;
    if (input.mood) params.mood = input.mood;
    if (input.instrumental !== undefined) params.instrumental = input.instrumental;
    if (input.lyrics) params.lyrics = input.lyrics;
    if (input.tags) params.tags = input.tags;
    if (input.bpm) params.bpm = input.bpm;

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "audio",
      prompt: input.prompt,
      modelId: modelIdUsed,
      params,
    });

    logger.info("music_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId: modelIdUsed,
      duration: input.duration,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelIdUsed,
      message: `音樂生成已啟動（${modelIdUsed}），作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("music_generation_failed", {
      userId: input.userId,
      modelId: modelIdUsed,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      modelIdUsed,
      message: `生成失敗:${humanizeToolError(error, { context: "musicSpecialist.generateMusic" })}`,
    };
  }
}

export interface GenerateSfxInput {
  userId: number;
  description: string;
  modelId?: string;
  duration?: number;
}

export async function generateSoundEffect(
  input: GenerateSfxInput
): Promise<GenerateMusicResult> {
  // 預設 SFX 引擎挑選：有 ELEVENLABS_API_KEY → elevenlabs/sound-effects；
  // 否則 → mmaudio-v2（fal）；最後降級 stable-audio。
  let modelIdUsed = input.modelId ?? "";
  if (!modelIdUsed) {
    if (process.env.ELEVENLABS_API_KEY) {
      modelIdUsed = "fal-ai/elevenlabs/sound-effects/v2";
    } else {
      modelIdUsed = "fal-ai/mmaudio-v2";
    }
  }
  // 顯式指定 ElevenLabs 但缺 key → 降級
  if (modelIdUsed.includes("elevenlabs/sound-effects") && !process.env.ELEVENLABS_API_KEY) {
    modelIdUsed = "fal-ai/stable-audio";
  }

  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "audio",
      prompt: input.description,
      modelId: modelIdUsed,
      params: {
        duration: input.duration ?? 5,
        type: "sfx",
      },
    });

    logger.info("sound_effect_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId: modelIdUsed,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelIdUsed,
      message: `音效生成已啟動（${modelIdUsed}），作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("sound_effect_failed", {
      userId: input.userId,
      modelId: modelIdUsed,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      modelIdUsed,
      message: `生成失敗:${humanizeToolError(error, { context: "musicSpecialist.generateSoundEffect" })}`,
    };
  }
}

// ─── exports for tests ───────────────────────────────────────────────────────

export const __testing__ = {
  AUDIO_ENGINE_PROFILES,
  PROFILE_BY_ID,
};

// Backwards-compat: older callers import these names — keep them aliased so
// any straggling import in agentToolExecutor or routers compiles unchanged.
export { estimateMusicCost as estimateCost };
export const getOptions = getMusicOptions;
export const getTips = getMusicGenerationTips;
