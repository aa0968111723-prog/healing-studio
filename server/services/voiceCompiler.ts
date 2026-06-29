/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Voice Compiler — 配音編譯器
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 將「情緒積木」(S-S-L-C-M Mood Block) 轉為 SSML 對白表情指令，
 * 在劇本斷點處自動植入 <break> 換氣停頓，賦予 AI 人類換氣的遲疑感。
 *
 * 編譯管線：
 *   積木 JSON → 情緒解析 → 段落分割 → SSML 標註 → 斷點植入 → 最終 SSML
 *
 * 支援 ElevenLabs SSML 子集（prosody / emphasis / break / say-as / sub）
 */
import {
  validateCompilerInput,
  VoiceCompilerInputSchema,
} from "./compilerValidation";
import { ELEVENLABS_AVAILABLE } from "./providerHealth";
import textToSpeech from "@google-cloud/text-to-speech";
import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../_core/providerFacade";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** 情緒積木結構（來自 S-S-L-C-M 的 Mood Block） */
export interface MoodBlock {
  blockId: string;
  label: string;
  prompt: string;
  emoji?: string;
  isCustom: boolean;
  customBlockId?: number;
  /** AIDV-677: 直接指定 EMOTION_PROFILES key，優先於 blockId/label/prompt 推導 */
  emotionOverride?: string;
}

/** 情緒維度 — 控制 SSML prosody 參數 */
export interface EmotionProfile {
  /** 情緒名稱 */
  name: string;
  /** 語速 (0.5x ~ 2.0x) */
  rate: string;
  /** 音高偏移 (-20% ~ +30%) */
  pitch: string;
  /** 音量 (soft / medium / loud) */
  volume: string;
  /** 強調等級 (none / moderate / strong) */
  emphasisLevel: "none" | "moderate" | "strong" | "reduced";
  /** 句間停頓秒數 */
  sentenceBreakMs: number;
  /** 段落間停頓秒數 */
  paragraphBreakMs: number;
  /** 換氣遲疑停頓秒數（劇本斷點） */
  hesitationBreakMs: number;
  /** 語調描述（用於 ElevenLabs style 提示） */
  styleHint: string;
}

/** 劇本段落 */
export interface ScriptSegment {
  /** 段落文字 */
  text: string;
  /** 段落類型 */
  type:
    | "narration"
    | "dialogue"
    | "emphasis"
    | "whisper"
    | "exclamation"
    | "question"
    | "pause";
  /** 情緒覆寫（可選，覆蓋全域情緒） */
  emotionOverride?: string;
}

/** Voice Compiler 輸入 */
export interface VoiceCompilerInput {
  /** 劇本文字（audioScript 或自由輸入） */
  script: string;
  /** 情緒積木（來自 S-S-L-C-M 的 moodBlock） */
  moodBlock?: MoodBlock | null;
  /** Vibe Card IDs（輔助情緒判斷） */
  vibeCardIds?: string[];
  /** 語音模型 ID（ElevenLabs voice ID） */
  voiceId?: string;
  /** 語速覆寫 */
  rateOverride?: string;
  /** 是否啟用換氣遲疑 */
  enableHesitation?: boolean;
  /** 自訂斷點標記（正則或字串陣列） */
  customBreakpoints?: string[];
  /**
   * 預解析的自訂語音 preset（AIDV-216）。
   * 由呼叫端從 customBlocks 表查詢後以 parseVoiceBlockPrompt() 轉換傳入。
   * 只有在 moodBlock.isCustom === true 時才會被採用；否則忽略。
   */
  resolvedCustomProfile?: Partial<EmotionProfile>;
}

/** Voice Compiler 輸出 */
export interface VoiceCompilerOutput {
  /** 編譯後的 SSML */
  ssml: string;
  /** 純文字版本（去除 SSML 標籤） */
  plainText: string;
  /** 使用的情緒設定檔 */
  emotionProfile: EmotionProfile;
  /** 段落數 */
  segmentCount: number;
  /** 預估朗讀時長（秒） */
  estimatedDurationSec: number;
  /** 斷點數量 */
  breakCount: number;
  /** 編譯日誌 */
  compilationLog: string[];
}

export interface VoiceSynthesisResult {
  ok: boolean;
  audioBuffer?: Buffer;
  mimeType?: string;
  provider?: "elevenlabs" | "google-tts";
  fallbackUsed: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 情緒 → SSML Prosody 映射表
// ═══════════════════════════════════════════════════════════════════════════

const EMOTION_PROFILES: Record<string, EmotionProfile> = {
  // ─── 基礎情緒 ─────────────────────────────────────────────
  serene: {
    name: "寧靜",
    rate: "90%",
    pitch: "-5%",
    volume: "soft",
    emphasisLevel: "reduced",
    sentenceBreakMs: 600,
    paragraphBreakMs: 1500,
    hesitationBreakMs: 1500,
    styleHint: "calm, gentle, meditative",
  },
  warm: {
    name: "溫暖",
    rate: "95%",
    pitch: "+3%",
    volume: "medium",
    emphasisLevel: "moderate",
    sentenceBreakMs: 500,
    paragraphBreakMs: 1200,
    hesitationBreakMs: 1200,
    styleHint: "warm, caring, comforting",
  },
  dreamy: {
    name: "夢幻",
    rate: "85%",
    pitch: "+8%",
    volume: "soft",
    emphasisLevel: "reduced",
    sentenceBreakMs: 700,
    paragraphBreakMs: 1800,
    hesitationBreakMs: 1800,
    styleHint: "ethereal, floaty, whimsical",
  },
  joyful: {
    name: "歡愉",
    rate: "110%",
    pitch: "+12%",
    volume: "loud",
    emphasisLevel: "strong",
    sentenceBreakMs: 350,
    paragraphBreakMs: 900,
    hesitationBreakMs: 800,
    styleHint: "energetic, cheerful, upbeat",
  },
  mystical: {
    name: "神秘",
    rate: "80%",
    pitch: "-8%",
    volume: "soft",
    emphasisLevel: "moderate",
    sentenceBreakMs: 800,
    paragraphBreakMs: 2000,
    hesitationBreakMs: 2000,
    styleHint: "mysterious, deep, enigmatic",
  },
  nature: {
    name: "自然",
    rate: "92%",
    pitch: "0%",
    volume: "medium",
    emphasisLevel: "none",
    sentenceBreakMs: 550,
    paragraphBreakMs: 1300,
    hesitationBreakMs: 1300,
    styleHint: "natural, grounded, organic",
  },
  vintage: {
    name: "復古",
    rate: "88%",
    pitch: "-3%",
    volume: "medium",
    emphasisLevel: "moderate",
    sentenceBreakMs: 600,
    paragraphBreakMs: 1400,
    hesitationBreakMs: 1400,
    styleHint: "nostalgic, classic, refined",
  },
  minimal: {
    name: "極簡",
    rate: "95%",
    pitch: "0%",
    volume: "medium",
    emphasisLevel: "none",
    sentenceBreakMs: 500,
    paragraphBreakMs: 1100,
    hesitationBreakMs: 1000,
    styleHint: "clean, precise, understated",
  },

  // ─── 進階情緒（從積木 prompt 推導） ──────────────────────
  melancholy: {
    name: "憂鬱",
    rate: "82%",
    pitch: "-10%",
    volume: "soft",
    emphasisLevel: "reduced",
    sentenceBreakMs: 800,
    paragraphBreakMs: 2000,
    hesitationBreakMs: 2200,
    styleHint: "sad, reflective, somber",
  },
  dramatic: {
    name: "戲劇",
    rate: "100%",
    pitch: "+5%",
    volume: "loud",
    emphasisLevel: "strong",
    sentenceBreakMs: 450,
    paragraphBreakMs: 1200,
    hesitationBreakMs: 1500,
    styleHint: "theatrical, intense, powerful",
  },
  tender: {
    name: "柔情",
    rate: "88%",
    pitch: "+5%",
    volume: "soft",
    emphasisLevel: "moderate",
    sentenceBreakMs: 600,
    paragraphBreakMs: 1500,
    hesitationBreakMs: 1600,
    styleHint: "tender, intimate, loving",
  },
  anxious: {
    name: "焦慮",
    rate: "115%",
    pitch: "+10%",
    volume: "medium",
    emphasisLevel: "strong",
    sentenceBreakMs: 300,
    paragraphBreakMs: 800,
    hesitationBreakMs: 600,
    styleHint: "nervous, tense, hurried",
  },
  contemplative: {
    name: "沉思",
    rate: "85%",
    pitch: "-3%",
    volume: "soft",
    emphasisLevel: "none",
    sentenceBreakMs: 700,
    paragraphBreakMs: 1800,
    hesitationBreakMs: 2000,
    styleHint: "thoughtful, philosophical, introspective",
  },
  hopeful: {
    name: "希望",
    rate: "100%",
    pitch: "+8%",
    volume: "medium",
    emphasisLevel: "moderate",
    sentenceBreakMs: 450,
    paragraphBreakMs: 1100,
    hesitationBreakMs: 1000,
    styleHint: "optimistic, uplifting, bright",
  },
};

/** 預設情緒（當無法匹配時） */
const DEFAULT_EMOTION: EmotionProfile = {
  name: "中性",
  rate: "100%",
  pitch: "0%",
  volume: "medium",
  emphasisLevel: "none",
  sentenceBreakMs: 500,
  paragraphBreakMs: 1200,
  hesitationBreakMs: 1500,
  styleHint: "neutral, clear, professional",
};

// ═══════════════════════════════════════════════════════════════════════════
// 自訂語音 preset 工具函式（AIDV-216）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 從 customBlocks.prompt 欄位解析語音設定。
 * prompt 預期為 JSON 字串；解析失敗時回傳空物件（退回內建 profiles）。
 *
 * 前端建立 voice customBlock 時應將 EmotionProfile 欄位序列化為 JSON 存入
 * prompt（最多 512 字元）：
 *   { rate, pitch, volume, emphasisLevel, sentenceBreakMs,
 *     paragraphBreakMs, hesitationBreakMs, styleHint, name }
 */
export function parseVoiceBlockPrompt(prompt: string): Partial<EmotionProfile> {
  try {
    const raw = JSON.parse(prompt);
    if (typeof raw !== "object" || raw === null) return {};
    const result: Partial<EmotionProfile> = {};
    if (typeof raw.rate === "string") result.rate = raw.rate;
    if (typeof raw.pitch === "string") result.pitch = raw.pitch;
    if (typeof raw.volume === "string") result.volume = raw.volume;
    if (["none", "moderate", "strong", "reduced"].includes(raw.emphasisLevel))
      result.emphasisLevel = raw.emphasisLevel as EmotionProfile["emphasisLevel"];
    if (typeof raw.sentenceBreakMs === "number") result.sentenceBreakMs = raw.sentenceBreakMs;
    if (typeof raw.paragraphBreakMs === "number") result.paragraphBreakMs = raw.paragraphBreakMs;
    if (typeof raw.hesitationBreakMs === "number") result.hesitationBreakMs = raw.hesitationBreakMs;
    if (typeof raw.styleHint === "string") result.styleHint = raw.styleHint;
    if (typeof raw.name === "string") result.name = raw.name;
    return result;
  } catch {
    return {};
  }
}

/** 將 Partial<EmotionProfile> 覆蓋到 base 上，只複寫有值的欄位 */
function mergeEmotionProfile(
  base: EmotionProfile,
  overrides: Partial<EmotionProfile>
): EmotionProfile {
  const merged = { ...base };
  for (const key of Object.keys(overrides) as (keyof EmotionProfile)[]) {
    const val = overrides[key];
    if (val !== undefined && val !== null) {
      (merged as any)[key] = val;
    }
  }
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// Vibe Card → 情緒映射
// ═══════════════════════════════════════════════════════════════════════════

const VIBE_TO_EMOTION: Record<string, string> = {
  serene: "serene",
  warm: "warm",
  dreamy: "dreamy",
  nature: "nature",
  vintage: "vintage",
  minimal: "minimal",
  joyful: "joyful",
  mystical: "mystical",
};

// ═══════════════════════════════════════════════════════════════════════════
// 情緒推導引擎
// ═══════════════════════════════════════════════════════════════════════════

/** 從積木 prompt 中推導情緒 */
const EMOTION_KEYWORDS: Record<string, string[]> = {
  serene: ["平靜", "寧靜", "安詳", "calm", "serene", "peaceful", "tranquil"],
  warm: ["溫暖", "溫馨", "舒適", "warm", "cozy", "comfort"],
  dreamy: ["夢幻", "夢境", "如夢", "dreamy", "fantasy", "ethereal"],
  joyful: [
    "歡樂",
    "快樂",
    "喜悅",
    "活力",
    "joy",
    "happy",
    "cheerful",
    "energetic",
  ],
  mystical: ["神秘", "深邃", "奧秘", "mysterious", "enigmatic", "dark"],
  melancholy: ["憂鬱", "悲傷", "哀愁", "sad", "melancholy", "sorrow", "grief"],
  dramatic: ["戲劇", "震撼", "壯闘", "dramatic", "intense", "powerful", "epic"],
  tender: ["柔情", "溫柔", "親密", "tender", "gentle", "intimate", "soft"],
  anxious: ["焦慮", "緊張", "不安", "anxious", "nervous", "tense", "urgent"],
  contemplative: [
    "沉思",
    "思考",
    "冥想",
    "thoughtful",
    "contemplative",
    "meditative",
  ],
  hopeful: [
    "希望",
    "光明",
    "期待",
    "hopeful",
    "optimistic",
    "bright",
    "promising",
  ],
  nature: ["自然", "森林", "海洋", "nature", "forest", "ocean", "earth"],
  vintage: ["復古", "懷舊", "經典", "vintage", "retro", "classic", "nostalgic"],
  minimal: ["極簡", "簡約", "純粹", "minimal", "simple", "clean", "pure"],
};

function inferEmotionFromPrompt(prompt: string): string {
  const lower = prompt.toLowerCase();
  let bestMatch = "";
  let bestScore = 0;

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = emotion;
    }
  }

  return bestMatch || "";
}

// ═══════════════════════════════════════════════════════════════════════════
// 段落分割器
// ═══════════════════════════════════════════════════════════════════════════

/** 劇本斷點模式 — 偵測自然停頓位置 */
const BREAKPOINT_PATTERNS = [
  // 段落分隔
  /\n\s*\n/g,
  // 省略號（思考/遲疑）
  /[…⋯\.]{3,}/g,
  // 破折號（轉折/插入語）
  /[—–]{1,2}/g,
  // 冒號（引述前）
  /：|:/g,
  // 分號（並列句）
  /；|;/g,
];

/** 句末標點 */
const SENTENCE_ENDINGS = /([。！？!?]+)/g;

/** 強調標記（引號內容） */
const EMPHASIS_PATTERN = /[「『"](.*?)[」』"]/g;

/** 感嘆句 */
const EXCLAMATION_PATTERN = /[！!]+/;

/** 疑問句 */
const QUESTION_PATTERN = /[？?]+/;

function splitIntoSegments(
  text: string,
  customBreakpoints?: string[]
): ScriptSegment[] {
  const segments: ScriptSegment[] = [];

  // Step 1: 按段落分割
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  for (const paragraph of paragraphs) {
    // Step 2: 先保護引號內容不被拆分
    const quoteProtected: Array<{ placeholder: string; original: string }> = [];
    let protectedText = paragraph.replace(/[「『"](.*?)[」』"]/g, match => {
      const placeholder = `__QUOTE_${quoteProtected.length}__`;
      quoteProtected.push({ placeholder, original: match });
      return placeholder;
    });

    // Step 3: 按句子分割（在保護後的文字上）
    const rawSentences = protectedText
      .split(SENTENCE_ENDINGS)
      .reduce<string[]>((acc, part, i, arr) => {
        // 將標點與前一句合併
        if (i % 2 === 1 && acc.length > 0) {
          acc[acc.length - 1] += part;
        } else if (part.trim()) {
          acc.push(part);
        }
        return acc;
      }, []);

    // Step 4: 還原引號內容
    const sentences = rawSentences.map(s => {
      let restored = s;
      for (const { placeholder, original } of quoteProtected) {
        restored = restored.replace(placeholder, original);
      }
      return restored;
    });

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      // 判斷段落類型
      let type: ScriptSegment["type"] = "narration";

      if (EXCLAMATION_PATTERN.test(trimmed)) {
        type = "exclamation";
      } else if (QUESTION_PATTERN.test(trimmed)) {
        type = "question";
      } else if (EMPHASIS_PATTERN.test(trimmed)) {
        type = "emphasis";
      }

      // 檢查自訂斷點
      if (customBreakpoints?.some(bp => trimmed.includes(bp))) {
        // 在自訂斷點處插入 pause 段落
        const parts = trimmed.split(
          new RegExp(`(${customBreakpoints.map(escapeRegex).join("|")})`)
        );
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i].trim();
          if (!part) continue;
          if (customBreakpoints.includes(part)) {
            segments.push({ text: "", type: "pause" });
          } else {
            segments.push({ text: part, type });
          }
        }
      } else {
        segments.push({ text: trimmed, type });
      }
    }

    // 段落間插入停頓
    segments.push({ text: "", type: "pause" });
  }

  // 移除末尾多餘的 pause
  while (
    segments.length > 0 &&
    segments[segments.length - 1].type === "pause"
  ) {
    segments.pop();
  }

  return segments;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════════════════════════════════════════════════════════════════
// SSML 編譯器
// ═══════════════════════════════════════════════════════════════════════════

/** 轉義 SSML 特殊字元 */
function escapeSSML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 將引號內容包裹為 emphasis */
function wrapEmphasis(
  text: string,
  level: EmotionProfile["emphasisLevel"]
): string {
  if (level === "none") return escapeSSML(text);

  return text.replace(EMPHASIS_PATTERN, (_, content) => {
    return `<emphasis level="${level}">${escapeSSML(content)}</emphasis>`;
  });
}

/** 偵測省略號/破折號位置並植入微停頓 */
function injectMicroBreaks(text: string, hesitationMs: number): string {
  let result = text;

  // 省略號 → 換氣遲疑
  result = result.replace(/[…⋯]/g, `<break time="${hesitationMs}ms"/>`);
  result = result.replace(/\.{3,}/g, `<break time="${hesitationMs}ms"/>`);

  // 破折號 → 短停頓（轉折感）
  const dashBreakMs = Math.round(hesitationMs * 0.6);
  result = result.replace(/[—–]{1,2}/g, `<break time="${dashBreakMs}ms"/>`);

  // 逗號後微停頓（自然呼吸）
  const commaBreakMs = Math.round(hesitationMs * 0.25);
  result = result.replace(/[，,]\s*/g, `，<break time="${commaBreakMs}ms"/>`);

  return result;
}

/** 編譯單一段落為 SSML */
function compileSegment(
  segment: ScriptSegment,
  profile: EmotionProfile,
  enableHesitation: boolean
): string {
  if (segment.type === "pause") {
    return `<break time="${profile.paragraphBreakMs}ms"/>`;
  }

  let content = segment.text;

  // Step 1: 處理引號強調
  content = wrapEmphasis(content, profile.emphasisLevel);

  // Step 2: 植入微停頓（省略號/破折號/逗號）
  if (enableHesitation) {
    content = injectMicroBreaks(content, profile.hesitationBreakMs);
  }

  // Step 3: 根據段落類型調整 prosody
  switch (segment.type) {
    case "exclamation":
      // 感嘆句：提高音量和音高
      return (
        `<prosody rate="${profile.rate}" pitch="+15%" volume="loud">${content}</prosody>` +
        `<break time="${profile.sentenceBreakMs}ms"/>`
      );

    case "question":
      // 疑問句：句末升調
      return (
        `<prosody rate="${profile.rate}" pitch="+10%" volume="${profile.volume}">${content}</prosody>` +
        `<break time="${Math.round(profile.sentenceBreakMs * 1.2)}ms"/>`
      );

    case "whisper":
      // 耳語：降低音量和語速
      return (
        `<prosody rate="80%" pitch="-15%" volume="x-soft">${content}</prosody>` +
        `<break time="${profile.sentenceBreakMs}ms"/>`
      );

    case "emphasis":
      // 強調段：使用 emphasis 標籤已在 wrapEmphasis 處理
      return (
        `<prosody rate="${profile.rate}" pitch="${profile.pitch}" volume="${profile.volume}">${content}</prosody>` +
        `<break time="${profile.sentenceBreakMs}ms"/>`
      );

    case "dialogue":
      // 對白：稍微加速，更自然
      return (
        `<prosody rate="105%" pitch="+3%" volume="${profile.volume}">${content}</prosody>` +
        `<break time="${Math.round(profile.sentenceBreakMs * 0.8)}ms"/>`
      );

    default:
      // 旁白/敘述：使用全域情緒設定
      return (
        `<prosody rate="${profile.rate}" pitch="${profile.pitch}" volume="${profile.volume}">${content}</prosody>` +
        `<break time="${profile.sentenceBreakMs}ms"/>`
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Voice Compiler 主類別
// ═══════════════════════════════════════════════════════════════════════════

export class VoiceCompiler {
  private async synthesizeWithElevenLabs(
    text: string,
    voiceId: string
  ): Promise<VoiceSynthesisResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
    if (!apiKey) throw new Error("ElevenLabs API key missing");
    // base URL 走統一門面（CF AI Gateway 啟用時自動換軌）。
    const baseUrl = resolveProviderBaseUrl("elevenlabs");
    const response = await fetch(`${baseUrl}/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        ...providerGatewayHeaders("elevenlabs"),
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    });
    if (!response.ok) {
      const err = new Error(`ElevenLabs TTS failed: ${response.status}`);
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return { ok: true, audioBuffer, mimeType: "audio/mpeg", provider: "elevenlabs", fallbackUsed: false };
  }

  private async synthesizeWithGoogleTTS(text: string): Promise<VoiceSynthesisResult> {
    const credentialJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialJson && !credentialPath) {
      return { ok: false, error: "voice-provider-unavailable", fallbackUsed: false };
    }
    try {
      const client = credentialJson
        ? new textToSpeech.TextToSpeechClient({
            credentials: JSON.parse(credentialJson) as {
              client_email: string;
              private_key: string;
            },
          })
        : new textToSpeech.TextToSpeechClient();
      const [response] = await client.synthesizeSpeech({
        input: { text },
        voice: { languageCode: "zh-TW", ssmlGender: "FEMALE" },
        audioConfig: { audioEncoding: "MP3" },
      });
      if (!response.audioContent) {
        return { ok: false, error: "voice-provider-unavailable", fallbackUsed: false };
      }
      return {
        ok: true,
        audioBuffer: Buffer.from(response.audioContent as Uint8Array),
        mimeType: "audio/mpeg",
        provider: "google-tts",
        fallbackUsed: true,
      };
    } catch {
      return { ok: false, error: "voice-provider-unavailable", fallbackUsed: false };
    }
  }

  async synthesizeSpeech(input: VoiceCompilerInput): Promise<VoiceSynthesisResult> {
    const compiled = this.compile(input);
    const plainText = compiled.plainText;
    const voiceId = input.voiceId ?? "EXAVITQu4vr4xnSDxMaL";

    if (!ELEVENLABS_AVAILABLE) {
      return this.synthesizeWithGoogleTTS(plainText);
    }

    try {
      return await this.synthesizeWithElevenLabs(plainText, voiceId);
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) {
        const fallback = await this.synthesizeWithGoogleTTS(plainText);
        if (!fallback.ok) {
          return { ok: false, error: "voice-provider-unavailable", fallbackUsed: false };
        }
        return fallback;
      }
      throw error;
    }
  }

  /**
   * 解析情緒設定檔
   * 優先順序：customBlock preset → moodBlock.emotionOverride → moodBlock.blockId → moodBlock.prompt 推導 → vibeCardIds → 預設
   */
  resolveEmotion(input: VoiceCompilerInput): {
    profile: EmotionProfile;
    source: string;
  } {
    const log: string[] = [];

    // 0. 自訂語音 preset（AIDV-216）
    // resolvedCustomProfile 由呼叫端從 customBlocks 表查詢後傳入；
    // 只有 moodBlock.isCustom === true 時採用，避免誤套非語音積木的資料。
    if (input.moodBlock?.isCustom && input.resolvedCustomProfile) {
      const merged = mergeEmotionProfile(DEFAULT_EMOTION, input.resolvedCustomProfile);
      return {
        profile: merged,
        source: `customBlock:${input.moodBlock.customBlockId ?? "unknown"} (${input.moodBlock.label})`,
      };
    }

    // AIDV-677: 0.5 emotionOverride 直接指定 profile key（優先於 blockId 推導）
    if (input.moodBlock?.emotionOverride && EMOTION_PROFILES[input.moodBlock.emotionOverride]) {
      return {
        profile: EMOTION_PROFILES[input.moodBlock.emotionOverride],
        source: `moodBlock.emotionOverride: ${input.moodBlock.emotionOverride}`,
      };
    }

    // 1. 從 moodBlock.blockId 直接匹配
    if (input.moodBlock?.blockId) {
      const profile = EMOTION_PROFILES[input.moodBlock.blockId];
      if (profile) {
        return {
          profile,
          source: `moodBlock.blockId: ${input.moodBlock.blockId}`,
        };
      }
    }

    // 2. 從 moodBlock.label 匹配
    if (input.moodBlock?.label) {
      const labelLower = input.moodBlock.label.toLowerCase();
      for (const [key, profile] of Object.entries(EMOTION_PROFILES)) {
        if (labelLower.includes(key) || labelLower.includes(profile.name)) {
          return {
            profile,
            source: `moodBlock.label: ${input.moodBlock.label} → ${key}`,
          };
        }
      }
    }

    // 3. 從 moodBlock.prompt 推導
    if (input.moodBlock?.prompt) {
      const inferred = inferEmotionFromPrompt(input.moodBlock.prompt);
      if (inferred && EMOTION_PROFILES[inferred]) {
        return {
          profile: EMOTION_PROFILES[inferred],
          source: `moodBlock.prompt inferred: ${inferred}`,
        };
      }
    }

    // 4. 從 vibeCardIds 推導
    if (input.vibeCardIds?.length) {
      for (const vibeId of input.vibeCardIds) {
        const emotionKey = VIBE_TO_EMOTION[vibeId];
        if (emotionKey && EMOTION_PROFILES[emotionKey]) {
          return {
            profile: EMOTION_PROFILES[emotionKey],
            source: `vibeCard: ${vibeId} → ${emotionKey}`,
          };
        }
      }
    }

    // 5. 從劇本文字推導
    if (input.script) {
      const inferred = inferEmotionFromPrompt(input.script);
      if (inferred && EMOTION_PROFILES[inferred]) {
        return {
          profile: EMOTION_PROFILES[inferred],
          source: `script content inferred: ${inferred}`,
        };
      }
    }

    // 6. 預設
    return { profile: DEFAULT_EMOTION, source: "default (neutral)" };
  }

  /**
   * 編譯劇本為 SSML
   */
  compile(input: VoiceCompilerInput): VoiceCompilerOutput {
    validateCompilerInput("voice", input, VoiceCompilerInputSchema);
    const compilationLog: string[] = [];
    const enableHesitation = input.enableHesitation !== false; // 預設啟用

    compilationLog.push("[VoiceCompiler] 🎙️ 開始編譯配音劇本...");

    // Step 1: 解析情緒
    const { profile, source } = this.resolveEmotion(input);
    compilationLog.push(
      `[VoiceCompiler] 🎭 情緒解析: ${profile.name} (${source})`
    );

    // Step 2: 應用語速覆寫
    const effectiveProfile = { ...profile };
    if (input.rateOverride) {
      effectiveProfile.rate = input.rateOverride;
      compilationLog.push(`[VoiceCompiler] ⏩ 語速覆寫: ${input.rateOverride}`);
    }

    // Step 3: 分割段落
    const segments = splitIntoSegments(input.script, input.customBreakpoints);
    compilationLog.push(`[VoiceCompiler] 📝 段落分割: ${segments.length} 段`);

    // Step 4: 編譯各段落為 SSML
    const ssmlParts: string[] = [];
    let breakCount = 0;

    for (const segment of segments) {
      const compiled = compileSegment(
        segment,
        effectiveProfile,
        enableHesitation
      );
      ssmlParts.push(compiled);

      // 計算 break 數量
      const breaks = (compiled.match(/<break /g) || []).length;
      breakCount += breaks;
    }

    // Step 5: 組裝最終 SSML
    const innerSSML = ssmlParts.join("\n");
    const ssml = `<speak>\n${innerSSML}\n</speak>`;

    compilationLog.push(
      `[VoiceCompiler] 🔧 SSML 編譯完成: ${breakCount} 個停頓點`
    );

    // Step 6: 計算純文字和預估時長
    const plainText = input.script;
    const charCount = plainText.replace(/\s/g, "").length;
    // 中文朗讀速度約 200-250 字/分鐘，根據語速調整
    const rateMultiplier = parseFloat(effectiveProfile.rate) / 100 || 1;
    const charsPerSecond = (220 / 60) * rateMultiplier;
    // 加上所有停頓時間
    const totalBreakMs = segments.reduce((sum, seg) => {
      if (seg.type === "pause") return sum + effectiveProfile.paragraphBreakMs;
      return sum + effectiveProfile.sentenceBreakMs;
    }, 0);
    const estimatedDurationSec = Math.round(
      charCount / charsPerSecond + totalBreakMs / 1000
    );

    compilationLog.push(
      `[VoiceCompiler] ⏱️ 預估時長: ${estimatedDurationSec}s (${charCount} 字, ${rateMultiplier}x 語速)`
    );
    compilationLog.push(`[VoiceCompiler] ✅ 編譯完成`);

    return {
      ssml,
      plainText,
      emotionProfile: effectiveProfile,
      segmentCount: segments.filter(s => s.type !== "pause").length,
      estimatedDurationSec,
      breakCount,
      compilationLog,
    };
  }

  /**
   * 快速編譯 — 僅產生 SSML 字串
   */
  compileToSSML(script: string, emotion?: string): string {
    const moodBlock: MoodBlock | undefined = emotion
      ? { blockId: emotion, label: emotion, prompt: "", isCustom: false }
      : undefined;

    const result = this.compile({
      script,
      moodBlock,
      enableHesitation: true,
    });

    return result.ssml;
  }

  /**
   * 取得所有可用情緒設定檔
   */
  getAvailableEmotions(): Array<{
    id: string;
    name: string;
    styleHint: string;
  }> {
    return Object.entries(EMOTION_PROFILES).map(([id, profile]) => ({
      id,
      name: profile.name,
      styleHint: profile.styleHint,
    }));
  }

  /**
   * 預覽情緒效果（不編譯完整 SSML，僅回傳 prosody 參數）
   */
  previewEmotion(emotionId: string): EmotionProfile | null {
    return EMOTION_PROFILES[emotionId] || null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

let _compiler: VoiceCompiler | null = null;

export function getVoiceCompiler(): VoiceCompiler {
  if (!_compiler) {
    _compiler = new VoiceCompiler();
  }
  return _compiler;
}
