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
  | "research"
  | "unknown";

export type ClarificationDimension =
  | "format"
  | "duration"
  | "style"
  | "audience"
  | "subject"
  | "platform"
  | "usecase"
  | "purpose"
  | "modalityBundle"
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
const RESEARCH_KEYWORDS = ["perplexity", "深度搜尋", "深度研究", "research", "調研", "查資料", "最新資訊", "趨勢"];

/**
 * Infer the user's modality from their text. Used both as a default for the
 * options builder and as a quick check before spinning up the wizard.
 */
export function inferModalityFromText(text: string): ClarificationModality {
  const lowered = text.toLowerCase();
  if (LORA_KEYWORDS.some(k => lowered.includes(k))) return "lora";
  if (RESEARCH_KEYWORDS.some(k => lowered.includes(k))) return "research";
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
    /影片|短片|reel|vlog|video/gi,
    /圖片|插畫|海報|封面|image|picture|illustration/gi,
    /音樂|配樂|bgm|music|歌曲|聲音/gi,
    /音效|sfx|環境音/gi,
    /配音|旁白|tts|voice|口白/gi,
    /腳本|劇本|文案|script/gi,
    /lora|訓練/gi,
    /幫我|請|我想|我要|可以|希望|需要|建議/g,
    /做一支|做一段|做一首|做一張|做一個|生成|製作|設計|產生|畫一張/g,
    /一支|一段|一首|一張|一個/g,
    /\b(?:make|create|generate|design|build|i\s+want|please)\b/gi,
    /[\s.,!?;:()"'\-_/\[\]{}，。！？；：、（）「」『』《》【】]+/g,
  ];
  for (const pat of stripPatterns) stripped = stripped.replace(pat, " ");
  stripped = stripped.replace(/\s+/g, " ").trim();
  if (!stripped) return null;

  // Pick the longest contiguous CJK run that survives stripping.
  const cjkRuns = stripped.match(/[一-鿿]+/g);
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
  // When the caller didn't pin a dimension and the user already named a
  // concrete modality (影片 / 圖片 / 音樂…), skip the generic "format"
  // bucket — those questions ("社群短片？廣告片？") feel redundant after
  // the user explicitly said 影片. Walk the wizard order instead and ask
  // the next dimension that's actually missing. Fallback to "format" only
  // when modality really is unknown.
  const dimension: ClarificationDimension =
    ctx.dimension ??
    (modality !== "unknown"
      ? nextMissingDimension(ctx.userText, modality) ?? "subject"
      : "format");
  const topic = extractTopicWord(ctx.userText);
  // When the topic can't be inferred we drop it from the option label entirely
  // instead of substituting "你的主題" — the placeholder used to leak into the
  // chip text (e.g. "你的主題 社群短片（15–30 秒）"), which made the orb feel
  // generic and unaware of the user's request. Neutral options force the user
  // (or a follow-up round) to commit to a real topic.
  const t = topic ?? "";
  const tPrefix = topic ? `${topic} ` : "";
  const tSuffix = topic ? ` ${topic}` : "";

  const PURPOSE_GENERIC = [
    "個人收藏／興趣",
    "社群曝光／追蹤成長",
    "品牌行銷／業績轉換",
    "教學分享／知識傳遞",
  ];

  const lib: Record<ClarificationModality, Partial<Record<ClarificationDimension, string[]>>> = {
    video: {
      format: [
        `${tPrefix}社群短片（15–30 秒）`,
        `${tPrefix}紀錄／教學（1–3 分鐘）`,
        `${tPrefix}廣告或宣傳片（30–60 秒）`,
        `${tPrefix}微電影／長片（>3 分鐘）`,
      ],
      purpose: PURPOSE_GENERIC,
      modalityBundle: [
        "只要影片",
        "影片＋海報",
        "影片＋海報＋配樂",
        "影片＋配音",
      ],
      duration: [
        "15 秒之內（社群快剪）",
        "30 秒（廣告／預告）",
        "1 分鐘（紀錄／敘事）",
        "3 分鐘以上（微電影）",
      ],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [
        `${tPrefix}紀錄寫實`,
        `${tPrefix}電影感運鏡`,
        `${tPrefix}動態插畫／動畫`,
        `${tPrefix}極簡 MV 風`,
      ],
      audience: [
        "IG / TikTok 短影音",
        "YouTube 內容頻道",
        "品牌官網／廣告投放",
        "個人收藏／回憶",
      ],
      subject: topic
        ? [
            `特寫${t}細節`,
            `用人物帶出${t}`,
            `用空鏡呈現${t}氛圍`,
            `用故事包裝${t}`,
          ]
        : [
            "想用人物／角色當主視覺",
            "想用空鏡／場景帶氛圍",
            "想用產品／物件特寫",
            "想用故事／情境串成完整敘事",
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
        `${tPrefix}主視覺海報`,
        `${tPrefix}社群封面圖`,
        `${tPrefix}系列插畫（4 張）`,
        `${tPrefix}寫實照片風格`,
      ],
      duration: [],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [
        `${tPrefix}寫實風格`,
        `${tPrefix}日系插畫`,
        `${tPrefix}油畫／藝術感`,
        `${tPrefix}極簡平面風`,
      ],
      audience: [
        "個人桌布／珍藏",
        "社群貼文／IG",
        "品牌行銷素材",
        "印刷成品（高解析）",
      ],
      subject: topic
        ? [
            `主角是${t}本身`,
            `用環境襯托${t}`,
            `用人物搭配${t}`,
            `抽象呈現${t}`,
          ]
        : [
            "想用人物／肖像當主角",
            "想用風景／環境當主角",
            "想用產品／物件當主角",
            "想要抽象／概念視覺",
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
        `${tPrefix}主題 BGM（純音樂）`,
        `${tPrefix}歌詞歌曲`,
        `${tPrefix}場景環境音`,
        `${tPrefix}廣告短旋律（5–15 秒）`,
      ],
      duration: [
        "10–15 秒（短廣告）",
        "30–60 秒（社群影片）",
        "2–3 分鐘（完整曲目）",
        "5 分鐘以上（長 BGM）",
      ],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [
        `${tPrefix}療癒慢板`,
        `${tPrefix}節奏輕快`,
        `${tPrefix}電影氛圍交響`,
        `${tPrefix}民謠／東方韻味`,
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
        `${tPrefix}中文旁白`,
        `${tPrefix}廣告口白`,
        `${tPrefix}角色配音`,
        `${tPrefix}多語言版本`,
      ],
      duration: [
        "30 秒以內（短廣告）",
        "1–2 分鐘（敘事旁白）",
        "5 分鐘以上（podcast）",
      ],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
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
        `${tPrefix}短影音腳本（15–30 秒）`,
        `${tPrefix}紀錄／教學腳本（1–3 分鐘）`,
        `${tPrefix}廣告腳本（30–60 秒）`,
        `${tPrefix}文案／貼文文字`,
      ],
      modalityBundle: [
        "只要腳本",
        "腳本＋分鏡海報",
        "腳本＋分鏡＋配樂提案",
        "腳本＋配音稿",
      ],
      duration: [
        "100 字以內（社群貼文）",
        "300 字（短廣告腳本）",
        "800 字（教學長腳本）",
      ],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [
        `${tPrefix}親切口語`,
        `${tPrefix}嚴肅紀實`,
        `${tPrefix}幽默搞笑`,
        `${tPrefix}專業說明`,
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
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [],
      audience: [],
      subject: [],
      platform: [],
      open: [],
    },
    research: {
      format: [
        `${tPrefix}趨勢研究（Perplexity 深度搜尋）`,
        `${tPrefix}競品比較（模型＋功能建議）`,
        `${tPrefix}技術查核（來源＋摘要）`,
        `${tPrefix}落地方案（站內模型路線圖）`,
      ],
      duration: [],
      usecase: [
        "找最新趨勢與時事",
        "比對工具與模型差異",
        "整理可執行步驟",
        "輸出可直接用的提示詞",
      ],
      style: [
        "先外部深搜，再站內匹配模型",
        "只看權威來源（文件 / 論文）",
        "重點摘要 + 可點來源",
        "直接給最佳模型與參數建議",
      ],
      audience: [
        "個人創作者",
        "品牌行銷團隊",
        "技術 / 產品團隊",
        "教育 / 研究用途",
      ],
      subject: [],
      platform: [],
      open: [],
    },
    unknown: {
      format: topic
        ? [
            `做${t}影片`,
            `做${t}圖片／海報`,
            `做${t}配樂／旁白`,
            `先寫${t}腳本`,
          ]
        : [
            "做一支影片",
            "做一張圖片／海報",
            "做一段配樂／旁白",
            "先寫腳本／文案",
          ],
      duration: [],
      usecase: [
        "品牌廣告",
        "故事敘事",
        "教學解說",
        "情緒短片",
      ],
      style: [],
      audience: [],
      subject: [],
      platform: [],
      open: [],
    },
  };
  // Suppress unused-variable warnings — `tSuffix` is reserved for future
  // tail-suffix templates (e.g. "30 秒短片，主題：${t}"). Keep it accessible
  // so other helpers in this file can reuse the same naming.
  void tSuffix;

  const dims = lib[modality];
  let raw: string[] = dims?.[dimension] ?? [];
  if (raw.length === 0 && dimension === "purpose") {
    // `purpose` (用途) is intentionally cross-modality — collapse to the
    // generic deck so brand / personal / education / social show up
    // regardless of whether the user picked image / video / audio.
    raw = PURPOSE_GENERIC;
  }
  if (raw.length === 0) {
    // Fallback to format if the requested dimension has no entries for this modality.
    raw = dims?.format ?? [];
  }
  if (raw.length === 0) raw = lib.unknown.format ?? [];

  // Reserve the last slot for the open-input escape hatch so users are
  // never trapped in 4 pre-baked choices that don't fit their idea.
  const trimmed = uniqueOptions(raw, 3);
  const options = uniqueOptions([...trimmed, OPEN_INPUT_OPTION], 4);
  return { options, modality, dimension };
}

/**
 * Stepwise wizard helper — given the conversation so far (concatenated user
 * utterances + earlier `[使用者澄清]:` answers) and the user's modality, return
 * the next dimension that is still missing, or `null` once enough dimensions
 * are pinned down.
 *
 * Used by:
 * - `detectVideoIntent` (and friends in `global-agent-workflows.ts`) to
 *   produce a multi-round wizard instead of a single ask.
 * - The LLM planner via the system prompt (it mirrors this dimension order).
 *
 * The "enough" bar is intentionally low: format + length/duration + (style OR
 * platform/audience). We don't gate on every single dimension — over-asking
 * makes the orb feel like a form, not an agent.
 *
 * Order of asking (matches user expectation of orb behaviour):
 *   1. format (or duration for audio) — without this, nothing can run
 *   2. subject — what's the topic / who is it about
 *   3. style  — tone / look / mood
 *   4. platform OR audience — aspect ratio / target context
 */
export interface ConversationDimensionSignals {
  /** The user mentioned a concrete length / duration. */
  hasLength?: boolean;
  /** The user mentioned a concrete topic / subject. */
  hasSubject?: boolean;
  /** The user mentioned a style / tone / mood. */
  hasStyle?: boolean;
  /** The user mentioned a target platform / aspect ratio / audience. */
  hasPlatform?: boolean;
  /** The user mentioned a source (uploaded vs AI-generated material). */
  hasSource?: boolean;
  /** The user mentioned a purpose / use case (brand / personal / teaching). */
  hasPurpose?: boolean;
  /**
   * The user named which output bundle they want — e.g. 「只要影片」/
   * 「影片+海報」/「影片+海報+配樂」/「影片+配音」. Detected from explicit
   * mentions of additional artefacts (海報、配樂、配音 etc) alongside the
   * primary modality. Falsy ≠ no bundle — it just means "not yet confirmed".
   */
  hasModalityBundle?: boolean;
}

/**
 * Coverage from durable memory. Folded into `inferConversationDimensions`
 * so dimensions the user has previously answered (e.g. style=cinematic
 * stored from a multi-dim pick last week) are treated as already-known
 * and the multi-dim wizard skips them.
 */
export interface RememberedDimensionCoverage {
  hasStyle?: boolean;
  hasPlatform?: boolean;
  hasPurpose?: boolean;
}

const STYLE_HINT_RE =
  /電影感|品牌|敘事|寫實|MV|動畫|插畫|紀錄|教學|搞笑|療癒|廣告|cinematic|brand|narrative|documentary|realistic|cartoon|animation|anime|funny|advert/i;
const PLATFORM_HINT_RE =
  /(?:9:16|16:9|1:1|4:5|3:4|2:3|3:2|portrait|landscape|square)|直式|橫式|方形|限動|reel|tiktok|youtube|shorts|官網|電視|抖音|小紅書|podcast|播客|印刷/i;
const AUDIENCE_HINT_RE =
  /給.{0,4}看|受眾|觀眾|客戶|投放|target|audience|品牌|內部|員工|教學|學生|玩家/i;
const SOURCE_HINT_RE =
  /上傳|手邊|自己拍|現有素材|有素材|沒素材|純AI|全AI|AI\s*生成|無素材|reference|參考圖|參考影片/i;
const PURPOSE_HINT_RE =
  /用來|做給|要拿來|目的|用途|行銷|宣傳|品牌|曝光|轉換|教學|分享|個人|收藏|珍藏|社群成長|追蹤|粉絲|商業|業績|profit|marketing|promote|teach|tutorial|personal|hobby/i;
/**
 * Modality-bundle hints: the user signalled which OUTPUT BUNDLE they need
 * (just video, or also poster/BGM/voice). Match both explicit additive
 * phrasing ("影片+海報", "影片跟海報", "影片加配樂", "也要配樂") and
 * exclusive phrasing ("只要影片", "純影片就好"). The 6-step brainstorming
 * arc uses this to skip the dedicated modalityBundle ask when the user
 * already named their bundle.
 *
 * Connector set covers both punctuation (+ ＋ 、) and CJK conjunctions
 * (和 與 跟 加 以及). Bare 「跟」 alone is too noisy ("影片跟我說")
 * so we anchor it via the next-clause requirement on a real bundle noun
 * within 4 chars — keeps recall up without flooding false positives.
 */
const MODALITY_BUNDLE_HINT_RE =
  /(?:影片|短片|video|reel).{0,4}(?:[+＋、]|和|與|跟|加上?|以及)\s*(?:海報|封面|poster|配樂|bgm|music|配音|旁白|voice)|(?:海報|封面|配樂|bgm|配音|旁白).{0,4}(?:[+＋、]|和|與|跟|加上?|以及)\s*(?:影片|短片|video)|只要(?:影片|腳本)|純(?:影片|腳本)|只做(?:影片|腳本)|(?:video|script)\s*only|還要(?:海報|封面|配樂|配音|旁白)|順便(?:加|做)?(?:海報|封面|配樂|配音|旁白)|加上?(?:海報|封面|配樂|配音|旁白)|包含(?:海報|封面|配樂|配音|旁白)|需要(?:海報|封面|配樂|配音|旁白)|need (?:poster|bgm|music|voice|narration)/i;

export function inferConversationDimensions(
  text: string,
  modality: ClarificationModality,
  remembered?: RememberedDimensionCoverage,
  prefilled?: ConversationDimensionSignals
): ConversationDimensionSignals {
  const trimmed = text.trim();
  if (!trimmed) {
    // Even with empty text, remembered prefs still count — and a long-script
    // pass on the upstream message may already have populated `prefilled`.
    return mergeSignals(
      remembered
        ? {
            hasStyle: remembered.hasStyle,
            hasPlatform: remembered.hasPlatform,
            hasPurpose: remembered.hasPurpose,
          }
        : {},
      prefilled
    );
  }
  // `\b` is anchored on ASCII word boundaries, so after a CJK unit like
  // 秒/分/小時 it never fires (CJK chars aren't word chars in JS regex,
  // and end-of-string is also non-word — no boundary). That meant
  // "做一支 30 秒影片" had hasLength=false, which gated out the multi-dim
  // wizard. Drop the `\b` for the CJK branch and keep it for the ASCII
  // branch where it still does meaningful work.
  const lengthRe =
    /\d+\s*(?:秒|分鐘?|小時)|\d+\s*(?:second|minute|hour|min|sec|mins|secs)\b|\d+s\b|短片|長片|長影片|長視頻|\d+\s*字/i;
  const subjectMarkers =
    /[:：]|主題|題目|關於|介紹|品牌|產品|內容是|主角|story|theme|brand|product/i;
  const hasLength = modality === "image" || modality === "lora"
    ? false
    : lengthRe.test(trimmed);
  // Single-character "topics" extracted by `extractTopicWord` are usually
  // residual verbs ("做" / "拍") rather than real subjects, so we require ≥2
  // chars before treating the topic word as a confirmed subject. The other
  // two signals (explicit subject markers, long message) still apply.
  const topicWord = extractTopicWord(trimmed);
  const hasSubject =
    (topicWord !== null && topicWord.length >= 2) ||
    subjectMarkers.test(trimmed) ||
    trimmed.length >= 35;
  const baseline: ConversationDimensionSignals = {
    hasLength,
    hasSubject,
    hasStyle: STYLE_HINT_RE.test(trimmed) || Boolean(remembered?.hasStyle),
    hasPlatform:
      PLATFORM_HINT_RE.test(trimmed) ||
      AUDIENCE_HINT_RE.test(trimmed) ||
      Boolean(remembered?.hasPlatform),
    hasSource: SOURCE_HINT_RE.test(trimmed),
    hasPurpose: PURPOSE_HINT_RE.test(trimmed) || Boolean(remembered?.hasPurpose),
    hasModalityBundle: MODALITY_BUNDLE_HINT_RE.test(trimmed),
  };
  return mergeSignals(baseline, prefilled);
}

/**
 * OR-merge two dimension signal objects. Used so prefilled signals coming
 * from `extractScriptStructure` (long-script parse) can flip flags on
 * without ever flipping them off — regex hits on the current message stay
 * authoritative.
 */
function mergeSignals(
  base: ConversationDimensionSignals,
  extra?: ConversationDimensionSignals
): ConversationDimensionSignals {
  if (!extra) return base;
  return {
    hasLength: base.hasLength || extra.hasLength,
    hasSubject: base.hasSubject || extra.hasSubject,
    hasStyle: base.hasStyle || extra.hasStyle,
    hasPlatform: base.hasPlatform || extra.hasPlatform,
    hasSource: base.hasSource || extra.hasSource,
    hasPurpose: base.hasPurpose || extra.hasPurpose,
    hasModalityBundle: base.hasModalityBundle || extra.hasModalityBundle,
  };
}

export function nextMissingDimension(
  text: string,
  modality: ClarificationModality,
  remembered?: RememberedDimensionCoverage,
  prefilled?: ConversationDimensionSignals
): ClarificationDimension | null {
  const sig = inferConversationDimensions(text, modality, remembered, prefilled);
  // Bar for "wizard satisfied" — kept intentionally thorough so the orb feels
  // like a real director who actually understands the brief, not a one-shot
  // dispatcher. We walk every dimension that materially changes the output
  // before committing to the workflow:
  //   - Image / LoRA: subject + style + platform (aspect ratio / use)
  //   - Voice / Music: length + subject + style
  //   - Video / Script: length + subject + style + platform
  // Each call returns the SINGLE next missing dimension so the orb asks one
  // at a time; the wizard concludes (returns null) only when every required
  // box is checked. The LLM planner mirrors this order in the system prompt.
  if (modality === "image" || modality === "lora") {
    if (!sig.hasSubject) return "subject";
    if (!sig.hasStyle) return "style";
    if (!sig.hasPlatform) return "platform";
    return null;
  }
  if (modality === "voice" || modality === "music") {
    if (!sig.hasLength) return "duration";
    if (!sig.hasSubject) return "subject";
    if (!sig.hasStyle) return "style";
    return null;
  }
  // video / script / unknown — full 4-dimension wizard
  if (!sig.hasLength) return "duration";
  if (!sig.hasSubject) return "subject";
  if (!sig.hasStyle) return "style";
  if (!sig.hasPlatform) return "platform";
  return null;
}

/**
 * Compose a short clarification question paired with topic-aware options for
 * the next missing dimension. Returns null when the wizard is satisfied.
 *
 * The question text is intentionally conversational ("我會幫你跑完整套流程，
 * 但先確認…") so the user understands WHY we're asking — the orb is doing
 * real work, not bureaucratic form-filling.
 */
export function buildWizardClarification(
  text: string,
  modality: ClarificationModality,
  remembered?: RememberedDimensionCoverage,
  prefilled?: ConversationDimensionSignals
): { question: string; options: string[]; dimension: ClarificationDimension } | null {
  const dimension = nextMissingDimension(text, modality, remembered, prefilled);
  if (!dimension) return null;
  const { options } = buildContextualClarificationOptions({
    userText: text,
    modality,
    dimension,
  });
  const question = wizardQuestionFor(modality, dimension);
  return { question, options, dimension };
}

// ─── Multi-dimension wizard (parallel asking) ──────────────────────────

export interface MultiDimWizardEntry {
  dimension: ClarificationDimension;
  question: string;
  options: string[];
}

export interface MultiDimWizardClarification {
  /** Lead-in shown above the multi-dimension card. */
  leadIn: string;
  /** 2–4 dimensions the user should pick from in one go. */
  entries: MultiDimWizardEntry[];
}

/**
 * Count how many high-signal dimensions the user has covered already.
 * Used to decide between single-dim wizard (1–2 missing) and multi-dim
 * wizard (3+ missing). The four dimensions counted are the ones that
 * materially change downstream output: subject, style, platform, purpose.
 * Length / duration is excluded because it gets a dedicated single-dim ask
 * (it has knock-on effects on every later step).
 */
export function countMissingHighSignalDimensions(
  text: string,
  modality: ClarificationModality,
  remembered?: RememberedDimensionCoverage,
  prefilled?: ConversationDimensionSignals
): number {
  const sig = inferConversationDimensions(text, modality, remembered, prefilled);
  let missing = 0;
  if (!sig.hasSubject) missing += 1;
  if (!sig.hasStyle) missing += 1;
  if (!sig.hasPlatform) missing += 1;
  if (!sig.hasPurpose) missing += 1;
  return missing;
}

/**
 * When the user's prompt is severely under-specified (3+ high-signal
 * dimensions missing), batch the asks into a single multi-row card so the
 * user can answer in one round-trip instead of bouncing through 4 separate
 * single-dim wizard turns. Returns null when fewer than 3 dimensions are
 * missing — the caller should fall back to `buildWizardClarification` for
 * the standard single-dim flow.
 *
 * Length / duration intentionally stays in the single-dim wizard: it's the
 * one dimension with downstream cascade (workflow shape, scene count,
 * BGM length) that we'd rather pin down before any other choice.
 */
export function buildMultiDimWizardClarification(
  text: string,
  modality: ClarificationModality,
  remembered?: RememberedDimensionCoverage,
  prefilled?: ConversationDimensionSignals
): MultiDimWizardClarification | null {
  const sig = inferConversationDimensions(text, modality, remembered, prefilled);
  // Length is gating: if we don't have it, ask single-dim first.
  const lengthRequired = !(modality === "image" || modality === "lora");
  if (lengthRequired && !sig.hasLength) return null;

  const missing: ClarificationDimension[] = [];
  if (!sig.hasSubject) missing.push("subject");
  if (!sig.hasStyle) missing.push("style");
  if (!sig.hasPurpose) missing.push("purpose");
  if (!sig.hasPlatform) missing.push("platform");

  if (missing.length < 3) return null;

  // Cap at 3 to keep the card scannable on mobile.
  const picked = missing.slice(0, 3);
  const entries: MultiDimWizardEntry[] = picked.map(dim => ({
    dimension: dim,
    question: wizardQuestionFor(modality, dim),
    options: buildContextualClarificationOptions({
      userText: text,
      modality,
      dimension: dim,
    }).options,
  }));

  const leadIn =
    `這個方向有點開放，我先一次問你 ${entries.length} 個重點，每題挑一個就好——` +
    `回完我就能拼出貼合的工作流程，不用再多輪追問。`;

  return { leadIn, entries };
}

/**
 * Pure helper used by callers / tests: serialize a set of multi-dim answers
 * into the same `[使用者澄清/<dim>]: <answer>` format that the single-dim
 * wizard appends to user text. The router treats this exactly like multiple
 * sequential clarifications, so all downstream code (intent detection,
 * workflow builders, prompt assembly) keeps working without changes.
 */
export function serializeMultiDimAnswers(
  answers: Array<{ dimension: ClarificationDimension; value: string }>
): string {
  return answers
    .filter(a => a.value.trim().length > 0)
    .map(a => `[使用者澄清/${a.dimension}]: ${a.value.trim()}`)
    .join("\n");
}

function wizardQuestionFor(
  modality: ClarificationModality,
  dimension: ClarificationDimension
): string {
  const modalityNoun = modalityNounOf(modality);
  switch (dimension) {
    case "duration":
      if (modality === "voice")
        return `想要多長的旁白？這會決定字數、情緒節奏與換氣點──30 秒約 60–80 字、1 分鐘約 180–220 字。`;
      if (modality === "music")
        return `音樂希望幾秒到幾分鐘？短廣告（10–15 秒）走鉤點旋律、社群（30–60 秒）需要完整 A 段、長 BGM（>2 分鐘）就會配置前奏／主題／尾奏的曲式。`;
      return `想做多長的${modalityNoun}？時長直接決定運鏡密度──15 秒一個鏡頭一種情緒、30 秒可拼三幕節奏、60 秒以上才裝得下完整故事弧。`;
    case "subject":
      return `主角或主題是什麼？一兩個關鍵字就好，例如「茶道體驗」「品牌週年」「夜景城市」。我會把它接進每一張關鍵視覺、運鏡、旁白稿，讓整支片同調。`;
    case "style":
      return `想走什麼風格／調性？風格直接影響打光、運鏡、配色與配樂──例如「電影感」會選低飽和暖光＋淺景深，「動態插畫」會交給 2D 動畫模型。`;
    case "platform":
      if (modality === "image")
        return `要用在哪？這決定比例與解析度──IG 1:1、限動 9:16、YouTube 16:9、印刷 3:2，模型參數會跟著切換。`;
      if (modality === "video" || modality === "script")
        return `投放平台或畫面比例？9:16 直式（IG Reel／TikTok／Shorts）跟 16:9 橫式（YouTube／官網）的剪輯密度與字幕擺位完全不同。`;
      return `主要用在哪個情境？我會根據投放點調整節奏與輸出規格。`;
    case "audience":
      return `主要觀眾是誰？影響文案語氣、節奏與梗的選擇──對品牌客戶要穩、對社群粉絲要快、對員工要實。`;
    case "purpose":
      return `做這個是為了什麼？用途決定整支作品的取捨──個人珍藏可任性、品牌行銷要精準、社群成長要鉤點、教學要清楚。`;
    case "modalityBundle":
      if (modality === "script")
        return `要做的不只腳本嗎？我可以同時準備分鏡海報、配樂提案或配音稿——先確認你要拿到哪幾件，等等下游精靈就能同步接手。`;
      return `這次需要哪些產出？只要影片，還是順便要海報／配樂／配音？確認後我會把對應的精靈一起排進工作流程。`;
    case "format":
    case "open":
    default:
      return `想做哪一種${modalityNoun}？`;
  }
}

function modalityNounOf(modality: ClarificationModality): string {
  switch (modality) {
    case "video":
      return "影片";
    case "image":
      return "圖片／海報";
    case "music":
      return "音樂";
    case "voice":
      return "旁白／配音";
    case "script":
      return "腳本";
    case "lora":
      return "客製化模型";
    case "research":
      return "研究／深度搜尋";
    case "unknown":
    default:
      return "成品";
  }
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
    (reply.match(/(?:^|\n)\s*\*?\*?\s*步驟\s*\d/g) ?? []).length +
    (reply.match(/(?:^|\n)\s*\d[.)]\s+/g) ?? []).length +
    (reply.match(/(?:^|\n)\s*Step\s+\d/gi) ?? []).length;
  if (numberedSteps < 2) return false;

  // Question-tail heuristic: the reply asks the user to pick / decide.
  const tail = reply.slice(-220);
  const askMarkers = [
    /從哪[個一]?[步階]/,
    /想從哪[個一]?[步階]/,
    /比較想[從要]/,
    /有其他想法/,
    /要我從哪/,
    /you want to start with/i,
    /which step/i,
    /which one/i,
  ];
  const hasQuestionMark = /[?？]/.test(tail);
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
    if (/[?？]/.test(lines[i])) {
      return lines[i].replace(/^\*+|\*+$/g, "").slice(0, 160);
    }
  }
  // No question mark found — pick the last sentence-like line.
  const last = lines[lines.length - 1];
  return last ? last.slice(0, 160) : null;
}
