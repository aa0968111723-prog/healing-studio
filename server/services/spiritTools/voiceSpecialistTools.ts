/**
 * server/services/spiritTools/voiceSpecialistTools.ts
 *
 * 聲聲 (voice-specialist) 的 AI agent 工具集。
 *
 * 設計目標：把聲聲從「只會跑兩個 dispatch」升級成真正的 voice agent：
 *   - recommendModel  → 依語言 / 速度 / 情緒 / 預算挑最適合的 TTS 引擎
 *   - listVoices      → 列出真實的 provider 預設音色（不是假的 zh-tw-female-1）
 *   - checkCloneSample→ 在啟動 clone 之前驗證樣本是否符合 30s / 單一說話者
 *   - estimateCost    → 配音任務的點數估算（內含 fal modelId 對照）
 *   - generateSpeech  → 真實 TTS（讀 brain context；不再硬編碼 qwen-tts）
 *   - cloneVoice      → 直接呼叫光球 studio.cloneVoice 管線
 *   - designVoice     → 直接呼叫光球 studio.designVoice 管線
 *   - changeVoice     → 直接呼叫光球 studio.changeVoice 管線
 *   - transcribe      → 維持原本 STT
 *   - detectLanguage  → 給定文本，回推應該配多語版還是中文版引擎
 *
 * 所有 generation tools 都會 dispatch 真實的 fal 任務（fal-ai/elevenlabs/tts/*、
 * fal-ai/qwen-3-tts/*、fal-ai/f5-tts 等），並走站內統一的 dispatchGenerationJob /
 * fal dispatcher，跟 /pro-studio 走同一條路徑 — 不再有「聲聲用一條路、編編用另
 * 一條路」的雙軌情況。
 */

import { logger } from "../../_core/logger";
import {
  VOICE_MODEL_REGISTRY,
  rankVoiceModelsByPrompt,
  type VoiceModelProfile,
} from "../../../shared/voiceModelRegistry";

// ─── 引擎 ID 對照表 ──────────────────────────────────────────────────────
//
// VOICE_MODEL_REGISTRY 用的是「短代號」（elevenlabs/eleven-v3、fal/kokoro …），
// 但實際 dispatch 到 fal 用的是「完整 fal 路徑」（fal-ai/elevenlabs/tts/eleven-v3）。
// 集中在這裡轉換，避免每次寫死。
//
// 沒進這張表的短代號 = 不在 fal 上 dispatch（例如 gemini/tts-flash 走 Gemini 直連），
// recommendModel 仍會推薦它，但 generateSpeech 會回 unsupported 並建議改 elevenlabs。

const SHORT_TO_FAL_MODEL_ID: Record<string, string> = {
  "elevenlabs/eleven-v3": "fal-ai/elevenlabs/tts/eleven-v3",
  "elevenlabs/multilingual-v2": "fal-ai/elevenlabs/tts/multilingual-v2",
  "elevenlabs/turbo-v2.5": "fal-ai/elevenlabs/tts/turbo-v2.5",
  "elevenlabs/flash-v2.5": "fal-ai/elevenlabs/tts/flash-v2.5",
  "fal/playai-tts": "fal-ai/playai-tts",
  "fal/kokoro": "fal-ai/kokoro",
  "fal/orpheus-tts": "fal-ai/orpheus-tts",
  "fal/dia-tts": "fal-ai/dia-tts",
};

function resolveFalModelId(shortOrFalId: string): string | null {
  if (!shortOrFalId) return null;
  // 已經是完整 fal 路徑（包含 "fal-ai/"）→ 原樣返回
  if (shortOrFalId.startsWith("fal-ai/")) return shortOrFalId;
  return SHORT_TO_FAL_MODEL_ID[shortOrFalId] ?? null;
}

// ─── 真實 voice catalog ─────────────────────────────────────────────────
//
// 取代之前的 zh-tw-female-1 / zh-tw-male-1 假 ID — 那些 ID 在 fal / ElevenLabs /
// Qwen 都查不到，光球叫起來必爆 404。這裡列的都是 provider 真實預設音色：
//   - ElevenLabs：用平台公開的 voice slug
//   - Qwen-3-TTS：用 fal 文件列出的 speaker name (Vivian / Andy …)
//
// LLM 看到這份 catalog 就能直接給使用者「我推 Vivian 念中文，要嗎？」這種具體建議。

export interface VoicePreset {
  /** 給 dispatch 用的 voice_id（ElevenLabs slug 或 Qwen speaker name） */
  voiceId: string;
  /** 顯示給使用者的中文名 */
  displayName: string;
  /** 配合哪一個引擎使用 — recommendModel 會依此挑配對 */
  recommendedEngine: string;
  language: string;
  gender: "male" | "female" | "neutral";
  description: string;
}

const VOICE_PRESETS: ReadonlyArray<VoicePreset> = [
  // ── Qwen-3-TTS（fal-ai/qwen-3-tts/text-to-speech）：中文 + 多語 ──
  {
    voiceId: "Vivian",
    displayName: "Vivian（女・溫暖中文）",
    recommendedEngine: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    language: "zh-TW",
    gender: "female",
    description: "溫暖親切的台灣女聲，療癒系內容預設首選",
  },
  {
    voiceId: "Andy",
    displayName: "Andy（男・穩重中文）",
    recommendedEngine: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    language: "zh-TW",
    gender: "male",
    description: "穩重大氣的台灣男聲，旁白 / 教學內容適用",
  },
  {
    voiceId: "Ethan",
    displayName: "Ethan（男・年輕活力）",
    recommendedEngine: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    language: "zh-CN",
    gender: "male",
    description: "年輕活力的普通話男聲，短影音 / Vlog 適用",
  },
  // ── ElevenLabs 預設 voice slugs（fal-ai/elevenlabs/tts/*） ──
  {
    voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
    displayName: "Rachel（女・標準英語）",
    recommendedEngine: "fal-ai/elevenlabs/tts/multilingual-v2",
    language: "en-US",
    gender: "female",
    description: "ElevenLabs 經典女聲 Rachel，多語版型可講中文",
  },
  {
    voiceId: "AZnzlk1XvdvUeBnXmlld", // Domi
    displayName: "Domi（女・強烈情感）",
    recommendedEngine: "fal-ai/elevenlabs/tts/eleven-v3",
    language: "en-US",
    gender: "female",
    description: "情感豐富的 ElevenLabs Domi，適合戲劇 / 廣告",
  },
  {
    voiceId: "TxGEqnHWrfWFTfGW9XjX", // Josh
    displayName: "Josh（男・自然英語）",
    recommendedEngine: "fal-ai/elevenlabs/tts/multilingual-v2",
    language: "en-US",
    gender: "male",
    description: "自然中性的 ElevenLabs Josh，敘事旁白首選",
  },
];

// ─── recommendModel — 依語意推薦最適合的 TTS 引擎 ────────────────────────

export interface RecommendModelInput {
  /** 使用者描述需求的一段話（語言 / 情緒 / 長度 / 預算暗示都讀） */
  prompt?: string;
  /** 已知語言（zh-TW / zh-CN / en-US / multi…）— 沒給時會從 prompt 猜 */
  language?: string;
  /** 預期語氣（calm / warm / energetic / dramatic …） */
  tone?: string;
  /** 偏好：speed（快） / quality（品質） / cheap（省） */
  priority?: "speed" | "quality" | "cheap";
}

export interface RecommendModelResult {
  /** 短代號（registry 用） */
  shortModelId: string;
  /** dispatch 用的完整 fal 路徑（沒 fal 支援時 null） */
  falModelId: string | null;
  label: string;
  category: VoiceModelProfile["category"];
  rationale: string;
  matchedKeywords: string[];
  /** 與這個引擎搭配的 voice presets（讓 LLM 一句話「Vivian + Qwen 來念」） */
  voicePresets: VoicePreset[];
  /** 第 2、3 名候選（依分數遞減，給使用者比較） */
  alternatives: Array<{ shortModelId: string; label: string; rationale: string }>;
}

/**
 * 依使用者輸入挑最適合的 TTS 引擎。先吃 prompt 關鍵字（rankVoiceModelsByPrompt），
 * 再依 priority 微調：
 *   - priority="speed"  → 偏好 tts-fast 類別（turbo / flash / kokoro）
 *   - priority="quality"→ 偏好 tts-premium 類別（eleven-v3 / playai）
 *   - priority="cheap"  → 偏好 fal/* 而非 elevenlabs/*（後者需要 ELEVENLABS_API_KEY）
 */
export function recommendModel(input: RecommendModelInput): RecommendModelResult {
  const promptParts = [
    input.prompt ?? "",
    input.language ?? "",
    input.tone ?? "",
    input.priority === "speed"
      ? "快速 fast"
      : input.priority === "quality"
        ? "高品質 premium"
        : input.priority === "cheap"
          ? "便宜"
          : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ranked = rankVoiceModelsByPrompt(promptParts || "natural voice");

  // priority 微調：把優先類別往前提
  const preferredCategory: VoiceModelProfile["category"] | null =
    input.priority === "speed"
      ? "tts-fast"
      : input.priority === "quality"
        ? "tts-premium"
        : null;

  let adjusted = ranked.map(r => {
    const profile = VOICE_MODEL_REGISTRY.find(m => m.modelId === r.modelId);
    let score = r.score;
    if (preferredCategory && profile?.category === preferredCategory) {
      score += 2;
    }
    if (input.priority === "cheap" && profile?.provider === "fal") {
      score += 1;
    }
    if (input.priority === "cheap" && profile?.provider === "elevenlabs") {
      score -= 1;
    }
    return { ...r, score, profile };
  });
  adjusted.sort((a, b) => b.score - a.score);

  const top = adjusted[0];
  const topProfile = top?.profile ?? VOICE_MODEL_REGISTRY[0];
  const falModelId = resolveFalModelId(topProfile.modelId);

  // 配對 voice presets（依 recommendedEngine 比對 falModelId）
  const presets = falModelId
    ? VOICE_PRESETS.filter(p => p.recommendedEngine === falModelId)
    : [];

  return {
    shortModelId: topProfile.modelId,
    falModelId,
    label: topProfile.label,
    category: topProfile.category,
    rationale: top?.rationale ?? "預設選擇：全能型 ElevenLabs V3",
    matchedKeywords: top?.matchedKeywords ?? [],
    voicePresets: presets,
    alternatives: adjusted.slice(1, 4).map(r => ({
      shortModelId: r.modelId,
      label: r.profile?.label ?? r.modelId,
      rationale: r.rationale,
    })),
  };
}

// ─── listVoices — 提供真實 provider 預設音色 ────────────────────────────

export function listVoices(filter?: {
  language?: string;
  gender?: "male" | "female" | "neutral";
}): {
  success: true;
  voices: VoicePreset[];
} {
  let voices = VOICE_PRESETS.slice();
  if (filter?.language) {
    const lang = filter.language.toLowerCase();
    voices = voices.filter(v => v.language.toLowerCase().includes(lang));
  }
  if (filter?.gender) {
    voices = voices.filter(v => v.gender === filter.gender);
  }
  return { success: true, voices };
}

// ─── checkCloneSample — 啟動 clone 前驗證樣本是否合格 ────────────────────

export interface CheckCloneSampleInput {
  /** 樣本長度（秒）— 必填，UI 上傳完就量得到 */
  durationSec: number;
  /** Mime / 副檔名（例 audio/wav, audio/mpeg） */
  mimeType?: string;
  /** 樣本檔案大小（MB），可選；> 25 MB fal 會拒收 */
  sizeMb?: number;
  /** 預計用哪一家 clone 引擎，影響規則嚴格度 */
  engine?: "elevenlabs" | "qwen" | "auto";
}

export interface CheckCloneSampleResult {
  ok: boolean;
  engine: "elevenlabs" | "qwen";
  /** 規則檢查結果：list of "pass" / "warn" / "fail" with reason */
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    reason: string;
  }>;
  /** 一句話總結，可直接貼給使用者 */
  summary: string;
}

/**
 * 啟動 voice clone 前的「樣本健檢」：
 *   - elevenlabs IVC：建議 60s+ 高品質單一說話者；最低 30s
 *   - qwen-3-tts clone：最低 10s，背景安靜即可
 *   - 共通檢查：mime 是否為 audio、size 是否 < 25 MB
 *
 * 任何 fail 都會把 ok 設成 false；warn 只標警告，不阻擋。
 */
export function checkCloneSample(input: CheckCloneSampleInput): CheckCloneSampleResult {
  const engine: "elevenlabs" | "qwen" =
    input.engine === "elevenlabs" || input.engine === "qwen"
      ? input.engine
      : "qwen"; // 預設 qwen（不需 API key、門檻較低）

  const checks: CheckCloneSampleResult["checks"] = [];

  // ── 時長檢查 ──
  const minSec = engine === "elevenlabs" ? 30 : 10;
  const recommendedSec = engine === "elevenlabs" ? 60 : 20;
  if (input.durationSec < minSec) {
    checks.push({
      name: "duration",
      status: "fail",
      reason: `樣本只有 ${input.durationSec.toFixed(1)}s，${engine === "elevenlabs" ? "ElevenLabs IVC" : "Qwen clone"} 最低需 ${minSec}s`,
    });
  } else if (input.durationSec < recommendedSec) {
    checks.push({
      name: "duration",
      status: "warn",
      reason: `${input.durationSec.toFixed(1)}s 過關但建議 ${recommendedSec}s 以上效果更穩`,
    });
  } else {
    checks.push({
      name: "duration",
      status: "pass",
      reason: `${input.durationSec.toFixed(1)}s 達標`,
    });
  }

  // ── MIME 檢查 ──
  if (input.mimeType) {
    const mime = input.mimeType.toLowerCase();
    if (!mime.startsWith("audio/")) {
      checks.push({
        name: "mimeType",
        status: "fail",
        reason: `mime="${input.mimeType}" 不是音檔，預期 audio/*（wav / mp3 / m4a）`,
      });
    } else if (mime.includes("opus") || mime.includes("webm")) {
      checks.push({
        name: "mimeType",
        status: "warn",
        reason: `${input.mimeType} 部分平台支援度不一致，建議轉成 wav / mp3`,
      });
    } else {
      checks.push({
        name: "mimeType",
        status: "pass",
        reason: input.mimeType,
      });
    }
  }

  // ── 檔案大小檢查（fal 上限 25 MB）──
  if (typeof input.sizeMb === "number") {
    if (input.sizeMb > 25) {
      checks.push({
        name: "size",
        status: "fail",
        reason: `${input.sizeMb.toFixed(1)} MB 超過 fal 25 MB 上限，需先壓縮`,
      });
    } else if (input.sizeMb > 15) {
      checks.push({
        name: "size",
        status: "warn",
        reason: `${input.sizeMb.toFixed(1)} MB 接近 25 MB 上限，上傳可能較慢`,
      });
    } else {
      checks.push({
        name: "size",
        status: "pass",
        reason: `${input.sizeMb.toFixed(1)} MB`,
      });
    }
  }

  const ok = checks.every(c => c.status !== "fail");
  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warn").length;
  const summary = ok
    ? warnCount > 0
      ? `樣本可以送出 clone，但有 ${warnCount} 個警告建議先處理`
      : "樣本通過全部檢查，可以送出 clone"
    : `${failCount} 個必修問題需先修正才能 clone（見 checks）`;

  return { ok, engine, checks, summary };
}

// ─── estimateCost — 配音任務點數估算 ────────────────────────────────────

export interface EstimateVoiceCostInput {
  /** 短代號（VOICE_MODEL_REGISTRY 用）或完整 fal 路徑都收 */
  modelId: string;
  /** 字符數（影響 TTS 計費的主要參數） */
  charCount?: number;
  /** 對某些 fal 模型也用秒數計（例 voice-changer 的素材長度） */
  durationSec?: number;
}

/**
 * 給聲聲自家用的成本估算 — 直接呼 modelPricing.estimatePoints。
 * 接受短代號（自動轉成完整 fal 路徑）或完整 fal 路徑。
 */
export async function estimateVoiceCost(input: EstimateVoiceCostInput): Promise<{
  modelId: string;
  resolvedModelId: string;
  totalPoints: number;
  basePoints: number;
  breakdown: string;
  isUnknownModel: boolean;
}> {
  const { estimatePoints, getModelPricing } = await import("../modelPricing");
  const resolvedModelId = resolveFalModelId(input.modelId) ?? input.modelId;
  const pricing = getModelPricing(resolvedModelId);
  const est = estimatePoints(resolvedModelId, {
    charCount: input.charCount,
    durationSec: input.durationSec,
  });
  return {
    modelId: input.modelId,
    resolvedModelId,
    totalPoints: est.totalPoints,
    basePoints: est.basePoints,
    breakdown: est.breakdown,
    isUnknownModel: !pricing,
  };
}

// ─── detectLanguage — 給文本，回推應走多語版還是中文版 ──────────────────

export interface DetectLanguageResult {
  language: "zh" | "en" | "ja" | "ko" | "mixed" | "other";
  cjkCharCount: number;
  asciiCharCount: number;
  /** 推薦的引擎短代號 */
  recommendedShortModelId: string;
  recommendedFalModelId: string | null;
  rationale: string;
}

/**
 * 給定一段文本（可能含中英混雜），判斷該用：
 *   - 全中文 → fal-ai/qwen-3-tts/text-to-speech（Qwen 中文情緒最自然）
 *   - 全英文 → fal-ai/elevenlabs/tts/multilingual-v2（多語版相容性最好）
 *   - 中英混雜 (mixed) → fal-ai/elevenlabs/tts/multilingual-v2
 *   - 日 / 韓 → fal-ai/elevenlabs/tts/multilingual-v2
 */
export function detectLanguage(text: string): DetectLanguageResult {
  if (!text) {
    return {
      language: "other",
      cjkCharCount: 0,
      asciiCharCount: 0,
      recommendedShortModelId: "elevenlabs/eleven-v3",
      recommendedFalModelId: resolveFalModelId("elevenlabs/eleven-v3"),
      rationale: "輸入為空 — 回退到全能預設 ElevenLabs V3",
    };
  }
  let cjk = 0;
  let ascii = 0;
  let hiragana = 0;
  let katakana = 0;
  let hangul = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified Ideographs (一-鿿) + CJK Extension A (㐀-䶿)
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      cjk++;
    } else if (code >= 0x3040 && code <= 0x309f) {
      hiragana++;
    } else if (code >= 0x30a0 && code <= 0x30ff) {
      katakana++;
    } else if (code >= 0xac00 && code <= 0xd7af) {
      hangul++;
    } else if (code >= 0x21 && code <= 0x7e) {
      ascii++;
    }
  }

  let language: DetectLanguageResult["language"];
  let shortModelId: string;
  let rationale: string;
  if (hiragana + katakana > 0) {
    language = "ja";
    shortModelId = "elevenlabs/multilingual-v2";
    rationale = "偵測到日文假名 — 走多語版";
  } else if (hangul > 0) {
    language = "ko";
    shortModelId = "elevenlabs/multilingual-v2";
    rationale = "偵測到韓文 — 走多語版";
  } else if (cjk > 0 && ascii > 0 && ascii > cjk * 0.3) {
    language = "mixed";
    shortModelId = "elevenlabs/multilingual-v2";
    rationale = `中英混雜（中文 ${cjk}、ASCII ${ascii}）— 多語版相容性最佳`;
  } else if (cjk > ascii) {
    language = "zh";
    shortModelId = "elevenlabs/multilingual-v2";
    rationale = `中文為主（${cjk} 字）— 走 ElevenLabs 多語版以支援中文聲道`;
  } else if (ascii > 0) {
    language = "en";
    shortModelId = "elevenlabs/eleven-v3";
    rationale = `英文為主（${ascii} 字符）— ElevenLabs V3 情感最自然`;
  } else {
    language = "other";
    shortModelId = "elevenlabs/multilingual-v2";
    rationale = "未識別主要語言 — 走多語版";
  }

  return {
    language,
    cjkCharCount: cjk,
    asciiCharCount: ascii,
    recommendedShortModelId: shortModelId,
    recommendedFalModelId: resolveFalModelId(shortModelId),
    rationale,
  };
}

// ─── generateSpeech — 真實 TTS dispatch ─────────────────────────────────

export interface GenerateSpeechInput {
  userId: number;
  text: string;
  /** 引擎短代號（registry）或完整 fal 路徑都收；沒給時讀 brain context 預設 */
  modelId?: string;
  voiceId?: string;
  language?: string;
  /** ElevenLabs voice_settings */
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

export interface GenerateSpeechResult {
  success: boolean;
  jobId?: string;
  resolvedModelId?: string;
  message: string;
}

/**
 * 真實 TTS dispatch — 走站內統一的 generationJobDispatcher（會 charge 點數、
 * 寫 apiUsageLogs、產出可在 /pro-studio 看的 history row）。
 *
 * BUG-FIX：之前硬編碼 modelId="qwen-tts"（一個不存在的 fal 短代號），意思是
 * 聲聲的所有 TTS dispatch 從第一天起就跑錯模型 ID。現在改成：
 *   1) args.modelId（短代號自動轉 fal 路徑）
 *   2) 讀 brain.generation.voiceEngine.engine（使用者大腦設定）
 *   3) fallback fal-ai/elevenlabs/tts/turbo-v2.5（與 agentToolExecutor 一致）
 */
export async function generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    let resolvedModelId = input.modelId ? resolveFalModelId(input.modelId) ?? input.modelId : "";
    if (!resolvedModelId) {
      try {
        const { buildBrainContext } = await import("../../middleware/brainContext");
        const brain = await buildBrainContext(input.userId);
        resolvedModelId =
          brain.generation.voiceEngine.engine || "fal-ai/elevenlabs/tts/turbo-v2.5";
      } catch {
        resolvedModelId = "fal-ai/elevenlabs/tts/turbo-v2.5";
      }
    }

    const params: Record<string, unknown> = {};
    if (input.voiceId) params.voice_id = input.voiceId;
    if (input.language) params.language_code = input.language;
    if (typeof input.stability === "number") params.stability = input.stability;
    if (typeof input.similarityBoost === "number")
      params.similarity_boost = input.similarityBoost;
    if (typeof input.style === "number") params.style = input.style;

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.text,
      modelId: resolvedModelId,
      params,
    });

    logger.info("speech_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId: resolvedModelId,
      textLength: input.text.length,
    });

    return {
      success: true,
      jobId: result.jobId,
      resolvedModelId,
      message: `語音合成已啟動，使用 ${resolvedModelId}，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("speech_generation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `合成失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── transcribeAudio — STT（保留原有，但補日誌） ────────────────────────

export async function transcribeAudio(input: {
  userId: number;
  audioUrl: string;
  language?: string;
}): Promise<{ success: boolean; transcript?: string; message: string }> {
  try {
    const { transcribeMedia } = await import("../mediaTranscriber");
    const result = await transcribeMedia({
      userId: input.userId,
      mediaUrl: input.audioUrl,
      language: input.language,
    });
    logger.info("audio_transcription_complete", {
      userId: input.userId,
      transcriptLength: result.transcript?.length,
    });
    return { success: true, transcript: result.transcript, message: "轉寫完成" };
  } catch (error) {
    logger.error("audio_transcription_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `轉寫失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── cloneVoice / designVoice / changeVoice — 共用 dispatcher ────────────
//
// 這三個 generation tools 本來在 agentToolExecutor.ts 的 studio.cloneVoice /
// studio.designVoice / studio.changeVoice case 內各自處理；聲聲若想直接走自家
// namespace（voiceSpecialist.*）以前沒辦法，只能下 studio.* 給 composer。現在
// 把它們橋接到同一條 generation dispatch — 聲聲可以直接命令，使用者不用聽到
// 「我交給編編」這種 friction。

export interface CloneVoiceInput {
  userId: number;
  audioUrl: string;
  /** elevenlabs（IVC，永久 voice_id）或 qwen（speaker embedding） */
  engine?: "elevenlabs" | "qwen";
  /** ElevenLabs IVC 需要的暱稱（不給就用時間戳） */
  voiceName?: string;
}

export async function cloneVoiceJob(
  input: CloneVoiceInput
): Promise<{ success: boolean; jobId?: string; modelId?: string; message: string }> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const modelId =
      input.engine === "elevenlabs"
        ? "fal-ai/elevenlabs/voice-cloning"
        : "fal-ai/qwen-3-tts/clone-voice/1.7b";
    const params: Record<string, unknown> = {
      audio_url: input.audioUrl,
    };
    if (input.engine === "elevenlabs") {
      params.name =
        input.voiceName?.trim() ||
        `Cloned Voice ${new Date().toISOString().slice(0, 19)}`;
    }
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.audioUrl,
      modelId,
      params,
    });
    return {
      success: true,
      jobId: result.jobId,
      modelId,
      message: `Voice cloning 已啟動（${input.engine ?? "qwen"}），作業 ID：${result.jobId}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Clone 失敗：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface DesignVoiceInput {
  userId: number;
  voiceDescription: string;
  previewText?: string;
}

export async function designVoiceJob(
  input: DesignVoiceInput
): Promise<{ success: boolean; jobId?: string; modelId?: string; message: string }> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const modelId = "fal-ai/qwen-3-tts/voice-design/1.7b";
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.voiceDescription,
      modelId,
      params: input.previewText ? { preview_text: input.previewText } : {},
    });
    return {
      success: true,
      jobId: result.jobId,
      modelId,
      message: `Voice design 已啟動，作業 ID：${result.jobId}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Voice design 失敗：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface ChangeVoiceInput {
  userId: number;
  audioUrl: string;
  voiceId: string;
}

export async function changeVoiceJob(
  input: ChangeVoiceInput
): Promise<{ success: boolean; jobId?: string; modelId?: string; message: string }> {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return {
        success: false,
        message: "Voice changer 需要 ELEVENLABS_API_KEY；此工具無等價替代品",
      };
    }
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const modelId = "fal-ai/elevenlabs/voice-changer";
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.audioUrl,
      modelId,
      params: { audio_url: input.audioUrl, voice_id: input.voiceId },
    });
    return {
      success: true,
      jobId: result.jobId,
      modelId,
      message: `Voice changer 已啟動，作業 ID：${result.jobId}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Voice changer 失敗：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── 既有：getAvailableVoices / getVoiceGenerationTips（保留 backward compat） ──

/**
 * @deprecated 改用 listVoices() — 回傳真實 provider preset；本函式仍存在於
 * agentToolExecutor 的 voiceSpecialist.getVoices 路徑下，但內部已委派給 listVoices。
 */
export function getAvailableVoices(): {
  success: true;
  voices: VoicePreset[];
} {
  return listVoices();
}

export function getVoiceGenerationTips(): {
  success: true;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "使用標點符號控制停頓和語氣：句號、逗號、問號、驚嘆號",
      "避免過長的句子，適當斷句可提升自然度",
      "數字和專有名詞用中文表達較準確",
      "可在文字中加入情緒標記：（開心）、（嚴肅）、（疑惑），ElevenLabs V3 支援度最佳",
      "語速建議範圍：0.8-1.2，1.0 為正常速度",
      "注意同音字，必要時用描述代替以避免誤讀",
      "ElevenLabs voice_settings：stability=0.5（平衡）、similarity_boost=0.75（保真度）、style=0（中性）",
      "中文配音首選 Qwen-3-TTS（Vivian / Andy）；多語切換用 ElevenLabs Multilingual V2",
      "Clone 前用 voiceSpecialist.checkCloneSample 驗證樣本長度與格式；ElevenLabs IVC 最低 30s，Qwen 最低 10s",
    ],
  };
}
