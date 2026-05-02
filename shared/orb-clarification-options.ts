/*
 * shared/orb-clarification-options.ts
 *
 * Context-aware clarification quick-pick generator.
 *
 * The orb's clarification card needs 2-4 options tailored to what the user
 * actually said — generic fillers like "請再說明一下" or "我先看流程再決定"
 * don't help users commit to a direction. This module mines the user's text
 * for topic + modality + length cues and assembles options that:
 *   1. Echo the user's own topic (so the user feels heard)
 *   2. Cover the most likely concrete choices for that modality
 *   3. Always include an "other / open input" escape hatch
 *
 * Pure functions — usable from both server (planner fallback) and client
 * (legacy reply parsing + heuristic clarification trigger).
 */

export type ClarificationModality =
  | "video"
  | "image"
  | "music"
  | "voice"
  | "script"
  | "lora"
  | "unknown";

export type ClarificationDimension =
  | "format"
  | "duration"
  | "style"
  | "audience"
  | "subject"
  | "platform"
  | "open";

export interface ClarificationOptionContext {
  /** Raw user message text (Chinese or English). */
  userText: string;
  /** Optional pre-detected modality. When omitted, inferred from userText. */
  modality?: ClarificationModality;
  /** Which dimension to ask about. Defaults to "format" — start of the wizard. */
  dimension?: ClarificationDimension;
}

const VIDEO_KEYWORDS = ["影片", "短片", "video", "reel", "vlog", "運鏡", "鏡頭", "片長", "剪輯"];
const IMAGE_KEYWORDS = ["圖片", "插畫", "海報", "封面", "image", "picture", "illustration"];
const MUSIC_KEYWORDS = ["音樂", "配樂", "bgm", "music", "歌曲", "節奏"];
const SFX_KEYWORDS = ["音效", "sfx", "環境音", "ambient sound"];
const VOICE_KEYWORDS = ["配音", "旁白", "voice", "tts", "口白", "聲音"];
const SCRIPT_KEYWORDS = ["腳本", "劇本", "文案", "script"];
const LORA_KEYWORDS = ["lora", "訓練", "model training", "訓練模型", "fine.?tune", "客製化模型"];

/**
 * Infer the user's modality from their text. Used both as a default for the
 * options builder and as a quick check before spinning up the wizard.
 */
export function inferModalityFromText(text: string): ClarificationModality {
  const lowered = text.toLowerCase();
  if (LORA_KEYWORDS.some(k => lowered.includes(k))) return "lora";
  if (VIDEO_KEYWORDS.some(k => lowered.includes(k))) return "video";
  if (IMAGE_KEYWORDS.some(k => lowered.includes(k))) return "image";
  if (VOICE_KEYWORDS.some(k => lowered.includes(k))) return "voice";
  if (MUSIC_KEYWORDS.some(k => lowered.includes(k))) return "music";
  if (SFX_KEYWORDS.some(k => lowered.includes(k))) return "music";
  if (SCRIPT_KEYWORDS.some(k => lowered.includes(k))) return "script";
  return "unknown";
}

/**
 * Return the user's most distinctive topic noun (Chinese-first, falls back
 * to a short English phrase). Used to echo their own wording back into the
 * generated options. Never longer than 6 chars to fit a chip label.
 *
 * Strategy: strip modality nouns + auxiliary verbs / particles, then return
 * the longest contiguous CJK run that's left. Single-char topics are kept
 * (Chinese topics like 茶 / 雨 / 光 are commonly 1 char), capped at 6 chars.
 */
export function extractTopicWord(text: string): string | null {
  if (!text) return null;
  let stripped = text;
  const stripPatterns: RegExp[] = [
    /影片|短片|reel|vlog|video/giu,
    /圖片|插畫|海報|封面|image|picture|illustration/giu,
    /音樂|配樂|bgm|music|歌曲|聲音/giu,
    /音效|sfx|環境音/giu,
    /配音|旁白|tts|voice|口白/giu,
    /腳本|劇本|文案|script/giu,
    /lora|訓練/giu,
    /幫我|請|我想|我要|可以|希望|需要|建議/g,
    /做一支|做一段|做一首|做一張|做一個|生成|製作|設計|產生|畫一張/g,
    /一支|一段|一首|一張|一個/g,
    /\b(?:make|create|generate|design|build|i\s+want|please)\b/giu,
    /[\s\p{P}]+/gu,
  ];
  for (const pat of stripPatterns) stripped = stripped.replace(pat, " ");
  stripped = stripped.replace(/\s+/g, " ").trim();
  if (!stripped) return null;

  // Pick the longest contiguous CJK run that survives stripping.
  const cjkRuns = stripped.match(/[一-鿿]+/gu);
  if (cjkRuns && cjkRuns.length > 0) {
    const sorted = [...cjkRuns].sort((a, b) => b.length - a.length);
    return sorted[0].slice(0, 6);
  }
  const enMatch = stripped.match(/[a-zA-Z][a-zA-Z\-]{1,15}/);
  return enMatch ? enMatch[0] : null;
}

const OPEN_INPUT_OPTION = "我自己描述一下";

/**
 * De-duplicate and cap to N entries while preserving order. The N cap is
 * configurable so callers can leave room for an open-input escape hatch
 * after the topic-aware choices.
 */
function uniqueOptions(opts: string[], cap = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const opt of opts) {
    const trimmed = opt.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Build clarification quick-pick options tuned to the user's modality +
 * topic. Always returns 3-4 options, with the last being an open-input
 * escape hatch so the user can always type their own answer.
 */
export function buildContextualClarificationOptions(
  ctx: ClarificationOptionContext
): { options: string[]; modality: ClarificationModality; dimension: ClarificationDimension } {
  const modality = ctx.modality ?? inferModalityFromText(ctx.userText);
  const dimension: ClarificationDimension = ctx.dimension ?? "format";
  const topic = extractTopicWord(ctx.userText);
  const t = topic ?? "你的主題";

  const lib: Record<ClarificationModality, Record<ClarificationDimension, string[]>> = {
    video: {
      format: [
        `${t} 社群短片（15–30 秒）`,
        `${t} 紀錄／教學（1–3 分鐘）`,
        `${t} 廣告或宣傳片（30–60 秒）`,
        `${t} 微電影／長片（>3 分鐘）`,
      ],
      duration: [
        "15 秒之內（社群快剪）",
        "30 秒（廣告／預告）",
        "1 分鐘（紀錄／敘事）",
        "3 分鐘以上（微電影）",
      ],
      style: [
        `${t} 紀錄寫實`,
        `${t} 電影感運鏡`,
        `${t} 動態插畫／動畫`,
        `${t} 極簡 MV 風`,
      ],
      audience: [
        "IG / TikTok 短影音",
        "YouTube 內容頻道",
        "品牌官網／廣告投放",
        "個人收藏／回憶",
      ],
      subject: [
        `特寫${t} 細節`,
        `用人物帶出${t}`,
        `用空鏡呈現${t} 氛圍`,
        `用故事包裝${t}`,
      ],
      platform: [
        "IG Reel（9:16）",
        "TikTok（9:16）",
        "YouTube Shorts（9:16）",
        "YouTube 橫式（16:9）",
      ],
      open: [],
    },
    image: {
      format: [
        `${t} 主視覺海報`,
        `${t} 社群封面圖`,
        `${t} 系列插畫（4 張）`,
        `${t} 寫實照片風格`,
      ],
      duration: [],
      style: [
        `${t} 寫實風格`,
        `${t} 日系插畫`,
        `${t} 油畫／藝術感`,
        `${t} 極簡平面風`,
      ],
      audience: [
        "個人桌布／珍藏",
        "社群貼文／IG",
        "品牌行銷素材",
        "印刷成品（高解析）",
      ],
      subject: [
        `主角是${t} 本身`,
        `用環境襯托${t}`,
        `用人物搭配${t}`,
        `抽象呈現${t}`,
      ],
      platform: [
        "1:1 方形（IG）",
        "9:16 直式（限動）",
        "16:9 橫式（YouTube／桌面）",
        "3:2 印刷比例",
      ],
      open: [],
    },
    music: {
      format: [
        `${t} 主題 BGM（純音樂）`,
        `${t} 歌詞歌曲`,
        `${t} 場景環境音`,
        `${t} 廣告短旋律（5–15 秒）`,
      ],
      duration: [
        "10–15 秒（短廣告）",
        "30–60 秒（社群影片）",
        "2–3 分鐘（完整曲目）",
        "5 分鐘以上（長 BGM）",
      ],
      style: [
        `${t} 療癒慢板`,
        `${t} 節奏輕快`,
        `${t} 電影氛圍交響`,
        `${t} 民謠／東方韻味`,
      ],
      audience: [
        "影片配樂",
        "店面／空間 BGM",
        "個人聆聽放鬆",
        "播客／節目片頭",
      ],
      subject: [],
      platform: [],
      open: [],
    },
    voice: {
      format: [
        `${t} 中文旁白`,
        `${t} 廣告口白`,
        `${t} 角色配音`,
        `${t} 多語言版本`,
      ],
      duration: [
        "30 秒以內（短廣告）",
        "1–2 分鐘（敘事旁白）",
        "5 分鐘以上（podcast）",
      ],
      style: [
        "溫柔療癒女聲",
        "穩重專業男聲",
        "活潑年輕語氣",
        "故事說書人語氣",
      ],
      audience: [],
      subject: [],
      platform: [],
      open: [],
    },
    script: {
      format: [
        `${t} 短影音腳本（15–30 秒）`,
        `${t} 紀錄／教學腳本（1–3 分鐘）`,
        `${t} 廣告腳本（30–60 秒）`,
        `${t} 文案／貼文文字`,
      ],
      duration: [
        "100 字以內（社群貼文）",
        "300 字（短廣告腳本）",
        "800 字（教學長腳本）",
      ],
      style: [
        `${t} 親切口語`,
        `${t} 嚴肅紀實`,
        `${t} 幽默搞笑`,
        `${t} 專業說明`,
      ],
      audience: [
        "IG / TikTok",
        "YouTube",
        "品牌官網／部落格",
        "公司內部簡報",
      ],
      subject: [],
      platform: [],
      open: [],
    },
    lora: {
      format: [
        "人臉／肖像 LoRA",
        "風格 LoRA（畫風 / 氛圍）",
        "場景 LoRA（地點 / 質感）",
        "影片動作 LoRA",
      ],
      duration: [],
      style: [],
      audience: [],
      subject: [],
      platform: [],
      open: [],
    },
    unknown: {
      format: [
        `做${t} 影片`,
        `做${t} 圖片／海報`,
        `做${t} 配樂／旁白`,
        `先寫${t} 腳本`,
      ],
      duration: [],
      style: [],
      audience: [],
      subject: [],
      platform: [],
      open: [],
    },
  };

  const dims = lib[modality];
  let raw: string[] = dims?.[dimension] ?? [];
  if (raw.length === 0) {
    // Fallback to format if the requested dimension has no entries for this modality.
    raw = dims?.format ?? [];
  }
  if (raw.length === 0) raw = lib.unknown.format;

  // Reserve the last slot for the open-input escape hatch so users are
  // never trapped in 4 pre-baked choices that don't fit their idea.
  const trimmed = uniqueOptions(raw, 3);
  const options = uniqueOptions([...trimmed, OPEN_INPUT_OPTION], 4);
  return { options, modality, dimension };
}

/**
 * Detect the "phantom plan" anti-pattern: the LLM described numbered steps
 * in chat (步驟 1 / 步驟 2 / 1./ 2.) AND ended with a "從哪一步開始 / 想從哪
 * 開始 / 比較想 X" question, without committing to decision.mode='clarification'.
 *
 * Returns true when the reply text matches BOTH the steps list and the trailing
 * question. The router uses this to reclassify legacy fallback replies as
 * clarifications so the user gets a quick-pick card instead of a wall of text.
 */
export function isPhantomPlanReply(reply: string): boolean {
  if (!reply || reply.length < 20) return false;
  // Numbered-step heuristic: at least 2 numbered markers.
  const numberedSteps =
    (reply.match(/(?:^|\n)\s*\*?\*?\s*步驟\s*\d/gu) ?? []).length +
    (reply.match(/(?:^|\n)\s*\d[.)]\s+/gu) ?? []).length +
    (reply.match(/(?:^|\n)\s*Step\s+\d/giu) ?? []).length;
  if (numberedSteps < 2) return false;

  // Question-tail heuristic: the reply asks the user to pick / decide.
  const tail = reply.slice(-220);
  const askMarkers = [
    /從哪[個一]?[步階]/u,
    /想從哪[個一]?[步階]/u,
    /比較想[從要]/u,
    /有其他想法/u,
    /要我從哪/u,
    /you want to start with/i,
    /which step/i,
    /which one/i,
  ];
  const hasQuestionMark = /[?？]/u.test(tail);
  const hasAskMarker = askMarkers.some(re => re.test(tail));
  return hasQuestionMark && hasAskMarker;
}

/**
 * Pull the trailing question sentence from a phantom-plan reply. Falls back
 * to the entire last line when no clean sentence boundary is found. Always
 * trimmed to ≤ 160 chars so it fits the clarification card.
 */
export function extractPhantomPlanQuestion(reply: string): string | null {
  if (!reply) return null;
  const lines = reply.split(/\n+/).map(l => l.trim()).filter(Boolean);
  // Walk from the bottom; first line that contains a ?/？ is the question.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/[?？]/u.test(lines[i])) {
      return lines[i].replace(/^\*+|\*+$/g, "").slice(0, 160);
    }
  }
  // No question mark found — pick the last sentence-like line.
  const last = lines[lines.length - 1];
  return last ? last.slice(0, 160) : null;
}
