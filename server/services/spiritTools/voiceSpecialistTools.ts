/**
 * server/services/spiritTools/voiceSpecialistTools.ts
 *
 * Tools for voice-specialist (聲聲) spirit — an AI voice agent.
 *
 * 聲聲 is the team's voice expert: it understands language, gender, mood,
 * pacing, and use case, and matches the user to the right voice + TTS
 * engine. The tools below are deliberately *agentic* — they don't just
 * dispatch jobs, they reason about the input first and suggest
 * concrete next moves the orchestrator can hand off.
 *
 * Surface area (12 tools):
 *
 *   - generateSpeech     單句 / 段落 TTS（自動匹配引擎 + 真實 voice_id）
 *   - transcribe         音檔 → 文字稿（語言可選）
 *   - cloneVoice         上傳音檔克隆永久聲線
 *   - designVoice        以文字描述設計虛擬聲線
 *   - changeVoice        聲音變換（換音色保留情緒）
 *   - generateSfx        音效生成（透過 description）
 *   - getVoices          列出可用聲線（支援 gender / language / mood 過濾）
 *   - pickVoice          依用途自動推薦聲線（return: 1 best + 2 alternates）
 *   - recommendModel     依用途推薦 TTS 引擎（V3 emotional / Multilingual / Turbo / Flash）
 *   - planVoiceover      長劇本切段 + 情緒標籤 + 停頓建議（agentic）
 *   - getTips            按情境（meditation / narration / ad / podcast …）給訣竅
 *   - getEmotionTags     列出 V3 支援的情緒標籤集
 */

import { logger } from "../../_core/logger";
import { ELEVENLABS_BUILTIN_VOICES } from "../elevenLabsExtended";

// ─── Types ───────────────────────────────────────────────────────────────

export type VoiceGender = "male" | "female" | "neutral";

export interface VoiceCatalogEntry {
  /** Real ElevenLabs voice id (使用在 TTS API 的 voice_id) */
  id: string;
  /** 顯示名稱 */
  name: string;
  gender: VoiceGender;
  /** BCP-47 主要語言 */
  language: string;
  /** 口音標記，可選 */
  accent?: string;
  /** 適合的場景關鍵字（mood / use case） */
  moods: string[];
  /** 一句話描述 */
  description: string;
}

export type VoiceScenario =
  | "narration"
  | "meditation"
  | "advertisement"
  | "podcast"
  | "audiobook"
  | "dialogue"
  | "tutorial"
  | "asmr"
  | "news"
  | "trailer";

// ─── Voice Catalog ──────────────────────────────────────────────────────

/**
 * 推薦聲線目錄。先以 ElevenLabs builtin voices 為主（有真實 voice_id 可
 * 直接呼叫 ElevenLabs TTS），再加上幾組中文 Qwen TTS 內建聲線（沒有
 * ElevenLabs 中文 builtin，但 fal qwen-3-tts 提供 Vivian / Cherry /
 * Ethan 等說中文的角色）。
 *
 * 注意：原本的版本用「zh-tw-female-1」這種假 ID — 那是 placeholder，
 * 真的拿去呼叫 TTS 引擎會 404。這個 catalog 全是可直接使用的 ID。
 */
function buildVoiceCatalog(): VoiceCatalogEntry[] {
  const moodMap: Record<string, string[]> = {
    Rachel: ["narration", "audiobook", "calm"],
    Domi: ["advertisement", "trailer", "confident"],
    Bella: ["meditation", "asmr", "warm"],
    Antoni: ["dialogue", "podcast", "warm"],
    Elli: ["dialogue", "youthful", "emotional"],
    Josh: ["news", "documentary", "deep"],
    Arnold: ["trailer", "documentary", "serious"],
    Adam: ["documentary", "narration", "deep"],
    Sam: ["tutorial", "calm", "podcast"],
    Ethan: ["advertisement", "youthful", "energetic"],
    Freya: ["narration", "elegant", "audiobook"],
    Grace: ["meditation", "warm", "elegant"],
    Glinda: ["dialogue", "playful", "magical"],
    Nicole: ["asmr", "whisper", "intimate"],
    Daniel: ["news", "documentary", "british"],
  };

  const elevenLabs: VoiceCatalogEntry[] = ELEVENLABS_BUILTIN_VOICES.map(v => ({
    id: v.voiceId,
    name: v.name,
    gender: v.gender as VoiceGender,
    language: v.accent === "British" ? "en-GB" : "en-US",
    accent: v.accent,
    moods: moodMap[v.name] ?? ["general"],
    description: v.description,
  }));

  // Qwen TTS 內建中文 / 多語聲線 — voice 名稱即是 fal qwen TTS 的 voice 欄位值
  const qwen: VoiceCatalogEntry[] = [
    {
      id: "Vivian",
      name: "Vivian",
      gender: "female",
      language: "zh-TW",
      moods: ["narration", "meditation", "warm"],
      description: "溫暖中文女聲，敘事 / 引導皆宜",
    },
    {
      id: "Cherry",
      name: "Cherry",
      gender: "female",
      language: "zh-CN",
      moods: ["advertisement", "youthful", "energetic"],
      description: "明亮活潑女聲，廣告 / 短影片",
    },
    {
      id: "Ethan",
      name: "Ethan (Qwen)",
      gender: "male",
      language: "zh-CN",
      moods: ["narration", "tutorial", "stable"],
      description: "穩重大氣男聲，教程 / 紀錄片",
    },
    {
      id: "Serena",
      name: "Serena",
      gender: "female",
      language: "zh-CN",
      moods: ["meditation", "asmr", "calm"],
      description: "柔和耳語女聲，冥想 / ASMR",
    },
    {
      id: "Chelsea",
      name: "Chelsea",
      gender: "female",
      language: "ja-JP",
      moods: ["dialogue", "youthful"],
      description: "日文女聲，對話 / 動畫感",
    },
  ];

  return [...elevenLabs, ...qwen];
}

const VOICE_CATALOG = buildVoiceCatalog();

// ─── Generation Tools ───────────────────────────────────────────────────

interface GenerateSpeechInput {
  userId: number;
  text: string;
  voiceId?: string;
  /** BCP-47 e.g. zh-TW / en-US / ja-JP；用來自動挑引擎 */
  language?: string;
  /** 0.5 ~ 2.0 */
  speed?: number;
  /** V3 emotion tags（例：["[whispers]", "[excited]"]）會接在 text 前 */
  emotionTags?: string[];
  /** ElevenLabs voice_settings */
  stability?: number;
  similarityBoost?: number;
  style?: number;
  /** 指定引擎；不指定則依 language 自動挑：
   *  - zh / ja → qwen-tts
   *  - en + 有 emotionTags → eleven-v3
   *  - 其他英語 → eleven-multilingual-v2
   */
  modelId?: string;
}

interface GenerateSpeechResult {
  success: boolean;
  jobId?: string;
  modelId?: string;
  voiceId?: string;
  message: string;
}

/** 依語言 + 是否需要情緒標籤，挑選 TTS 引擎 */
export function pickTtsEngine(input: {
  language?: string;
  hasEmotionTags?: boolean;
  needsLowLatency?: boolean;
}): string {
  const lang = (input.language ?? "").toLowerCase();
  const isChineseOrJapanese =
    lang.startsWith("zh") || lang.startsWith("ja") || lang.startsWith("ko");
  if (isChineseOrJapanese) {
    return "fal-ai/qwen-3-tts/text-to-speech/1.7b";
  }
  if (input.hasEmotionTags) {
    return "fal-ai/elevenlabs/tts/eleven-v3";
  }
  if (input.needsLowLatency) {
    return "fal-ai/elevenlabs/tts/flash-v2-5";
  }
  return "fal-ai/elevenlabs/tts/multilingual-v2";
}

export async function generateSpeech(
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const modelId =
      input.modelId ??
      pickTtsEngine({
        language: input.language,
        hasEmotionTags: !!input.emotionTags?.length,
      });

    // 預設聲線：根據語言挑 catalog 第一個對應項，避免「default」這種無效 ID
    const voiceId =
      input.voiceId ??
      pickVoice({
        language: input.language,
      }).primary?.id ??
      "Vivian";

    const params: Record<string, unknown> = {
      voice_id: voiceId,
    };
    if (input.language) params.language_code = input.language;
    if (typeof input.speed === "number") params.speed = input.speed;
    if (typeof input.stability === "number") params.stability = input.stability;
    if (typeof input.similarityBoost === "number") {
      params.similarity_boost = input.similarityBoost;
    }
    if (typeof input.style === "number") params.style = input.style;

    const text = input.emotionTags?.length
      ? `${input.emotionTags.join(" ")} ${input.text}`.trim()
      : input.text;

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: text,
      modelId,
      params,
    });

    logger.info("speech_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
      voiceId,
      textLength: input.text.length,
      emotionTags: input.emotionTags?.length ?? 0,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId,
      voiceId,
      message: `語音合成已啟動，作業 ID：${result.jobId}（聲線：${voiceId}）`,
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

export async function transcribeAudio(input: {
  userId: number;
  audioUrl: string;
  language?: string;
}): Promise<{
  success: boolean;
  transcript?: string;
  words?: Array<{ text: string; start: number; end: number; speaker?: string }>;
  message: string;
}> {
  try {
    const { transcribeMedia } = await import("../mediaTranscriber");

    const result = await transcribeMedia({
      userId: input.userId,
      mediaUrl: input.audioUrl,
      language: input.language,
    });

    logger.info("audio_transcription_complete", {
      userId: input.userId,
      transcriptLength: result.transcript?.length ?? 0,
      wordCount: result.words?.length ?? 0,
    });

    return {
      success: true,
      transcript: result.transcript,
      words: result.words,
      message: "轉寫完成",
    };
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

export async function cloneVoice(input: {
  userId: number;
  audioUrl: string;
  name?: string;
  description?: string;
  /** 預設使用 ElevenLabs（永久 voice_id）；缺 key 自動退回 Qwen zero-shot */
  modelId?: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  modelId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const modelId =
      input.modelId ??
      (process.env.ELEVENLABS_API_KEY
        ? "fal-ai/elevenlabs/voice-cloning"
        : "fal-ai/qwen-3-tts/clone-voice/1.7b");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.description ?? "voice clone",
      modelId,
      params: {
        audio_url: input.audioUrl,
        name: input.name,
        description: input.description,
      },
    });

    logger.info("voice_clone_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId,
      message: `聲音克隆已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("voice_clone_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `克隆失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function designVoice(input: {
  userId: number;
  description: string;
  previewText?: string;
  modelId?: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  modelId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const modelId = input.modelId ?? "fal-ai/qwen-3-tts/voice-design/1.7b";

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.previewText ?? "你好，我是你設計的聲音。",
      modelId,
      params: {
        voice_description: input.description,
      },
    });

    logger.info("voice_design_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId,
    });

    return {
      success: true,
      jobId: result.jobId,
      modelId,
      message: `聲音設計已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("voice_design_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `設計失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function changeVoice(input: {
  userId: number;
  audioUrl: string;
  voiceId: string;
  removeBackgroundNoise?: boolean;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  if (!process.env.ELEVENLABS_API_KEY) {
    return {
      success: false,
      message:
        "voice-changer 需要 ELEVENLABS_API_KEY（無等價替代品）— 請先到 /settings/api-keys 設定",
    };
  }
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: "voice change",
      modelId: "fal-ai/elevenlabs/voice-changer",
      params: {
        audio_url: input.audioUrl,
        voice_id: input.voiceId,
        remove_background_noise: input.removeBackgroundNoise,
      },
    });
    return {
      success: true,
      jobId: result.jobId,
      message: `聲音變換已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("voice_change_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `變聲失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function generateSfx(input: {
  userId: number;
  description: string;
  durationSeconds?: number;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");
    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "audio",
      prompt: input.description,
      modelId: process.env.ELEVENLABS_API_KEY
        ? "fal-ai/elevenlabs/sound-effects"
        : "audio-craft",
      params: {
        duration: Math.max(0.5, Math.min(22, input.durationSeconds ?? 5)),
        type: "sfx",
      },
    });
    return {
      success: true,
      jobId: result.jobId,
      message: `音效生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("sfx_generation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `音效失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── Catalog / Recommendation Tools ─────────────────────────────────────

export interface VoiceFilter {
  gender?: VoiceGender;
  /** 簡單比對：以 "zh" 開頭過濾全部 zh-* 聲線等 */
  language?: string;
  /** 任一 mood 字串符合即匹配（不分大小寫） */
  mood?: string;
  /** 只回前 N 個 */
  limit?: number;
}

export function getAvailableVoices(filter?: VoiceFilter): {
  success: boolean;
  total: number;
  voices: VoiceCatalogEntry[];
} {
  const f = filter ?? {};
  const moodNeedle = f.mood?.toLowerCase();
  const langNeedle = f.language?.toLowerCase();
  const all = VOICE_CATALOG.filter(v => {
    if (f.gender && v.gender !== f.gender) return false;
    if (langNeedle && !v.language.toLowerCase().startsWith(langNeedle)) {
      return false;
    }
    if (moodNeedle && !v.moods.some(m => m.toLowerCase().includes(moodNeedle))) {
      return false;
    }
    return true;
  });
  const voices = typeof f.limit === "number" ? all.slice(0, f.limit) : all;
  return { success: true, total: all.length, voices };
}

export interface PickVoiceInput {
  language?: string;
  gender?: VoiceGender;
  scenario?: VoiceScenario | string;
  /** 自由文字 mood 描述（會比對 catalog moods + name + description） */
  mood?: string;
}

export interface PickVoiceResult {
  success: boolean;
  primary: VoiceCatalogEntry | null;
  alternates: VoiceCatalogEntry[];
  reasoning: string;
}

/**
 * 依使用情境推薦最合適的聲線。回傳 1 個首選 + 最多 2 個替代。
 * 沒有完美匹配時退到 language → gender → 任意 catalog 第一名。
 */
export function pickVoice(input: PickVoiceInput): PickVoiceResult {
  const scenario = input.scenario?.toString().toLowerCase();
  const mood = input.mood?.toLowerCase();
  const langNeedle = input.language?.toLowerCase();

  function score(v: VoiceCatalogEntry): number {
    let s = 0;
    if (langNeedle && v.language.toLowerCase().startsWith(langNeedle)) s += 4;
    if (input.gender && v.gender === input.gender) s += 3;
    if (scenario && v.moods.some(m => m.toLowerCase() === scenario)) s += 3;
    if (mood) {
      const hay = `${v.moods.join(" ")} ${v.description} ${v.name}`.toLowerCase();
      if (hay.includes(mood)) s += 2;
    }
    return s;
  }

  const ranked = [...VOICE_CATALOG]
    .map(v => ({ v, s: score(v) }))
    .sort((a, b) => b.s - a.s);

  // 完全沒有任何條件匹配時（top score 0）退回語言/性別過濾
  const top = ranked[0];
  const hasMatch = top && top.s > 0;
  const candidates = hasMatch
    ? ranked.filter(r => r.s > 0).map(r => r.v)
    : VOICE_CATALOG.filter(v => {
        if (langNeedle && !v.language.toLowerCase().startsWith(langNeedle)) {
          return false;
        }
        if (input.gender && v.gender !== input.gender) return false;
        return true;
      });

  const primary = candidates[0] ?? VOICE_CATALOG[0] ?? null;
  const alternates = candidates.slice(1, 3);

  const bits: string[] = [];
  if (input.language) bits.push(`語言=${input.language}`);
  if (input.gender) bits.push(`性別=${input.gender}`);
  if (scenario) bits.push(`情境=${scenario}`);
  if (mood) bits.push(`mood=${mood}`);
  const reasoning = primary
    ? `${primary.name}（${primary.description}）${
        bits.length ? "， 因為 " + bits.join("、") + " 最匹配" : ""
      }`
    : "沒有匹配的聲線";

  return { success: true, primary, alternates, reasoning };
}

export interface RecommendModelResult {
  success: boolean;
  modelId: string;
  modelName: string;
  reasoning: string;
  /** 同等級替代引擎，使用者可自由切換 */
  alternates: Array<{ modelId: string; modelName: string; reason: string }>;
}

/**
 * 推薦 TTS 引擎：依語言 + 情緒需求 + 延遲要求挑最合適者。
 */
export function recommendModel(input: {
  language?: string;
  scenario?: VoiceScenario | string;
  needsEmotion?: boolean;
  needsLowLatency?: boolean;
  needsMultiSpeaker?: boolean;
}): RecommendModelResult {
  const lang = (input.language ?? "").toLowerCase();
  const scenario = input.scenario?.toString().toLowerCase();
  const isCJK =
    lang.startsWith("zh") || lang.startsWith("ja") || lang.startsWith("ko");
  const emotional =
    input.needsEmotion === true ||
    scenario === "advertisement" ||
    scenario === "dialogue" ||
    scenario === "trailer";

  // 多角色對話必走 V3（含 [S1]/[S2] 標記支援），語言再優先順序之上 —
  // Qwen TTS 沒有多角色機制，硬塞會把所有對話念成同一聲線。
  if (input.needsMultiSpeaker || scenario === "dialogue") {
    return {
      success: true,
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      modelName: "ElevenLabs V3",
      reasoning: "V3 支援多角色對話與 [S1]/[S2] 切換，且情感標籤最完整。",
      alternates: [
        {
          modelId: "fal-ai/dia-tts/voice-clone",
          modelName: "Dia TTS",
          reason: "更輕量的多角色對話引擎；只接受 [S1]/[S2] 標記",
        },
      ],
    };
  }

  if (isCJK) {
    return {
      success: true,
      modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      modelName: "Qwen 3 TTS",
      reasoning: `${input.language ?? "中/日/韓"} 語言下 Qwen 3 TTS 比 ElevenLabs Multilingual 自然度更高（內建 zh/ja/ko 訓練語料較多）。`,
      alternates: [
        {
          modelId: "fal-ai/elevenlabs/tts/multilingual-v2",
          modelName: "ElevenLabs Multilingual v2",
          reason: "需要跨語言切換時備援；中文腔調較偏台灣 / 大陸通用",
        },
      ],
    };
  }

  if (emotional) {
    return {
      success: true,
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      modelName: "ElevenLabs V3",
      reasoning:
        "ElevenLabs V3 支援 [excited] / [whispers] / [laughs] 等情感標籤，情感場景表現最自然。",
      alternates: [
        {
          modelId: "fal-ai/elevenlabs/tts/multilingual-v2",
          modelName: "ElevenLabs Multilingual v2",
          reason: "穩定性更高、跨語言通用，但情感層次較平",
        },
      ],
    };
  }

  if (input.needsLowLatency) {
    return {
      success: true,
      modelId: "fal-ai/elevenlabs/tts/flash-v2-5",
      modelName: "ElevenLabs Flash v2.5",
      reasoning: "Flash 為超低延遲串流最佳化，適合即時互動 / 語音 agent。",
      alternates: [
        {
          modelId: "fal-ai/elevenlabs/tts/turbo-v2-5",
          modelName: "ElevenLabs Turbo v2.5",
          reason: "速度同級，品質略高，但成本稍高",
        },
      ],
    };
  }

  return {
    success: true,
    modelId: "fal-ai/elevenlabs/tts/multilingual-v2",
    modelName: "ElevenLabs Multilingual v2",
    reasoning: "29 種語言、穩定且通用，敘事 / 教程 / 旁白的全能首選。",
    alternates: [
      {
        modelId: "fal-ai/elevenlabs/tts/turbo-v2-5",
        modelName: "ElevenLabs Turbo v2.5",
        reason: "速度更快，但僅 32 種主要語言",
      },
      {
        modelId: "fal-ai/f5-tts",
        modelName: "F5 TTS",
        reason: "開源、不需 ELEVENLABS_API_KEY 的降級選項",
      },
    ],
  };
}

// ─── Voice-Over Planner (agentic) ───────────────────────────────────────

export interface VoiceoverSegment {
  index: number;
  text: string;
  /** 段落性質 */
  kind: "narration" | "dialogue" | "emphasis" | "whisper" | "question" | "exclamation";
  /** V3 emotion 建議（會被植入 text 前） */
  emotionTag?: string;
  /** 段落後預設停頓（毫秒） */
  pauseAfterMs: number;
  /** 對話多人時的說話者標記（V3 / Dia） */
  speaker?: "S1" | "S2";
}

export interface PlanVoiceoverInput {
  script: string;
  /** 預設情緒（feeds into emotionTag heuristic） */
  baseEmotion?: "neutral" | "calm" | "warm" | "excited" | "serious" | "playful";
  /** 是否要把 dialogue 段切成 S1 / S2 */
  multiSpeaker?: boolean;
  /** 預估語速（字 / 秒），中文預設 4.5 字/秒，英文 2.5 字/秒 */
  charsPerSecond?: number;
}

export interface PlanVoiceoverResult {
  success: boolean;
  segments: VoiceoverSegment[];
  /** 段落數 */
  segmentCount: number;
  /** 預估總時長（秒） */
  estimatedDurationSec: number;
  /** 推薦引擎（沿用 recommendModel） */
  recommendedModelId: string;
  /** 為什麼這樣切 */
  reasoning: string;
}

const EMOTION_TAG_BY_BASE: Record<string, string> = {
  calm: "[calm]",
  warm: "[warm]",
  excited: "[excited]",
  serious: "[serious]",
  playful: "[playful]",
  neutral: "",
};

/**
 * 把長劇本切成可送給 TTS 的多個段落，自動：
 *   - 在標點 / 換行斷句
 *   - 標出感嘆 / 問句 / 對話 / 強調
 *   - 為每段建議停頓毫秒數
 *   - 給多角色對話加 S1 / S2 標記
 *   - 估算總時長
 *
 * 這是 agentic 工具：不會直接呼叫 TTS，而是把規劃好的 segments 還給上層，
 * 讓 orchestrator 一段一段呼叫 generateSpeech，便於插入背景音樂 / 字幕 /
 * 對嘴等下游步驟。
 */
export function planVoiceover(input: PlanVoiceoverInput): PlanVoiceoverResult {
  const script = (input.script ?? "").trim();
  const baseEmotion = input.baseEmotion ?? "neutral";
  const charsPerSecond = input.charsPerSecond ?? 4.5;

  if (!script) {
    return {
      success: false,
      segments: [],
      segmentCount: 0,
      estimatedDurationSec: 0,
      recommendedModelId: "",
      reasoning: "script is empty",
    };
  }

  // 1) 先用換行 / 標點切段。保留結尾符號用以判斷句型。
  const rawSegments = script
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[。！？!?])\s*/))
    .map(s => s.trim())
    .filter(Boolean);

  // 2) 對每段判斷 kind + emotion tag + pause
  const segments: VoiceoverSegment[] = rawSegments.map((text, i) => {
    let kind: VoiceoverSegment["kind"] = "narration";
    if (/[！!]$/.test(text)) kind = "exclamation";
    else if (/[？?]$/.test(text)) kind = "question";
    else if (/[「『"]/.test(text)) kind = "dialogue";
    else if (text.length < 12 && /[…—]/.test(text)) kind = "emphasis";
    else if (/^[（(].*[）)]$/.test(text)) kind = "whisper";

    let emotionTag: string | undefined;
    if (kind === "exclamation") emotionTag = "[excited]";
    else if (kind === "question") emotionTag = "[curious]";
    else if (kind === "whisper") emotionTag = "[whispers]";
    else if (kind === "emphasis") emotionTag = "[emphatic]";
    else emotionTag = EMOTION_TAG_BY_BASE[baseEmotion] || undefined;

    let pauseAfterMs = 350;
    if (kind === "exclamation" || kind === "question") pauseAfterMs = 700;
    else if (kind === "emphasis" || kind === "whisper") pauseAfterMs = 900;
    else if (i === rawSegments.length - 1) pauseAfterMs = 0;

    const speaker: VoiceoverSegment["speaker"] | undefined = input.multiSpeaker
      ? i % 2 === 0
        ? "S1"
        : "S2"
      : undefined;

    return {
      index: i,
      text,
      kind,
      emotionTag,
      pauseAfterMs,
      speaker,
    };
  });

  // 3) 估算時長（字數 / 速度 + 停頓加總）
  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  const speechSec = totalChars / Math.max(0.1, charsPerSecond);
  const pauseSec =
    segments.reduce((sum, s) => sum + s.pauseAfterMs, 0) / 1000;
  const estimatedDurationSec = Math.round((speechSec + pauseSec) * 10) / 10;

  // 4) 推薦引擎：有情緒標籤 → V3；多角色 → V3；否則 multilingual / qwen
  const hasEmotion = segments.some(s => !!s.emotionTag);
  const isCJK = /[一-鿿぀-ヿ가-힯]/.test(script);
  const rec = recommendModel({
    language: isCJK ? "zh-TW" : "en-US",
    needsEmotion: hasEmotion,
    needsMultiSpeaker: !!input.multiSpeaker,
  });

  const reasoning = [
    `共 ${segments.length} 段，預估 ${estimatedDurationSec}s。`,
    hasEmotion ? "含情緒標籤，建議走 V3。" : "純敘事，可用 Multilingual / Qwen。",
    input.multiSpeaker ? "多角色已標 S1 / S2。" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    success: true,
    segments,
    segmentCount: segments.length,
    estimatedDurationSec,
    recommendedModelId: rec.modelId,
    reasoning,
  };
}

// ─── Tips & Reference ───────────────────────────────────────────────────

/** ElevenLabs V3 支援的情感 / 動作標籤集（agent 可直接告知使用者） */
export function getEmotionTags(): {
  success: boolean;
  groups: Array<{
    category: string;
    tags: string[];
  }>;
} {
  return {
    success: true,
    groups: [
      {
        category: "情緒",
        tags: [
          "[excited]",
          "[calm]",
          "[warm]",
          "[serious]",
          "[playful]",
          "[curious]",
          "[melancholy]",
          "[confident]",
        ],
      },
      {
        category: "語氣 / 表演",
        tags: [
          "[whispers]",
          "[shouts]",
          "[laughs]",
          "[sighs]",
          "[gasps]",
          "[crying]",
          "[emphatic]",
        ],
      },
      {
        category: "節奏 / 停頓",
        tags: ["[pause]", "[long pause]", "[short pause]"],
      },
    ],
  };
}

const SCENARIO_TIPS: Record<string, string[]> = {
  narration: [
    "語速 0.95-1.05，旁白偏穩定（stability 0.6-0.7）",
    "段落間用 [short pause]，章節之間 [pause]",
    "中文用 Vivian / Ethan(Qwen)，英文用 Rachel / Adam",
  ],
  meditation: [
    "語速 0.8-0.85，stability 0.7+，similarityBoost 0.6",
    "句尾用 [long pause]，引導氣息",
    "聲線挑 Bella / Grace / Serena 等耳語溫暖系",
  ],
  advertisement: [
    "語速 1.1-1.3，情感標籤 [excited] / [confident]",
    "結尾鉤子可加 [emphatic] 強調 CTA",
    "選 Domi / Ethan(Qwen) / Cherry 等明亮聲線",
  ],
  podcast: [
    "對話用多角色：S1 主持 + S2 來賓，挑兩個音色差別明顯的 voice",
    "情緒 [warm] / [curious] 增加自然感",
    "single take 不要超過 90 秒，太長 TTS 容易語氣漂移",
  ],
  audiobook: [
    "選 Multilingual v2 或 V3，stability 0.7 +，similarityBoost 0.7",
    "對白用 [S1] / [S2] 切換，旁白回 narration 預設",
    "全段控制在 4500 字元內，超過分批送",
  ],
  dialogue: [
    "務必用 V3 + [S1]/[S2] 標記說話者",
    "每個段落都帶情緒標籤效果最好",
    "兩位 voice 性別 / 口音差異越大越自然",
  ],
  tutorial: [
    "語速 1.0，stability 0.6（中等）讓語氣不僵硬",
    "重點處可放 [emphatic] 或 [short pause]，給聽者反應時間",
    "用 Sam / Antoni / Ethan(Qwen) 等穩重清晰的男聲",
  ],
  asmr: [
    "語速 0.7-0.8，全程 [whispers]",
    "Nicole / Serena 是 ASMR 最佳預設",
    "片段建議 15-30 秒，連續念太久 TTS 會喘",
  ],
  news: [
    "中性語調，stability 0.7+，speed 1.05",
    "選 Daniel / Adam / Ethan(Qwen) 等紀錄片感聲線",
    "避免情感標籤；新聞要的是專業距離",
  ],
  trailer: [
    "短句 + [excited]，速度 1.1-1.2，但語氣可拉到 1.3",
    "結尾標題 [emphatic] + [long pause]",
    "Arnold / Domi / Adam 等深沉有份量的聲線",
  ],
};

const GENERAL_TIPS = [
  "使用標點符號控制停頓和語氣：句號、逗號、問號、驚嘆號",
  "避免單句超過 200 字元，過長會壓低自然度",
  "數字和專有名詞用中文表達較準確（中文 TTS）",
  "可在文字前加入情緒標記（V3）：[excited]、[whispers]、[laughs]",
  "語速建議範圍：0.8-1.2，1.0 為正常速度",
  "注意同音字，必要時用描述代替以避免誤讀",
];

export function getVoiceGenerationTips(scenario?: string): {
  success: boolean;
  tips: string[];
} {
  const key = scenario?.toLowerCase().trim();
  if (key && SCENARIO_TIPS[key]) {
    return {
      success: true,
      tips: [...SCENARIO_TIPS[key], ...GENERAL_TIPS.slice(0, 2)],
    };
  }
  return { success: true, tips: GENERAL_TIPS };
}
