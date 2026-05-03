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
  // When the topic can't be inferred we drop it from the option label entirely
  // instead of substituting "你的主題" — the placeholder used to leak into the
  // chip text (e.g. "你的主題 社群短片（15–30 秒）"), which made the orb feel
  // generic and unaware of the user's request. Neutral options force the user
  // (or a follow-up round) to commit to a real topic.
  const t = topic ?? "";
  const tPrefix = topic ? `${topic} ` : "";
  const tSuffix = topic ? ` ${topic}` : "";

  const lib: Record<ClarificationModality, Record<ClarificationDimension, string[]>> = {
    video: {
      format: [
        `${tPrefix}社群短片（15–30 秒）`,
        `${tPrefix}紀錄／教學（1–3 分鐘）`,
        `${tPrefix}廣告或宣傳片（30–60 秒）`,
        `${tPrefix}微電影／長片（>3 分鐘）`,
      ],
      duration: [
        "15 秒之內（社群快剪）",
        "30 秒（廣告／預告）",
        "1 分鐘（紀錄／敘事）",
        "3 分鐘以上（微電影）",
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
      duration: [
        "100 字以內（社群貼文）",
        "300 字（短廣告腳本）",
        "800 字（教學長腳本）",
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
      style: [],
      audience: [],
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
}

const STYLE_HINT_RE =
  /電影感|品牌|敘事|寫實|MV|動畫|插畫|紀錄|教學|搞笑|療癒|廣告|cinematic|brand|narrative|documentary|realistic|cartoon|animation|anime|funny|advert/i;
const PLATFORM_HINT_RE =
  /(?:9:16|16:9|1:1|4:5|3:4|2:3|3:2|portrait|landscape|square)|直式|橫式|方形|限動|reel|tiktok|youtube|shorts|官網|電視|抖音|小紅書|podcast|播客|印刷/i;
const AUDIENCE_HINT_RE =
  /給.{0,4}看|受眾|觀眾|客戶|投放|target|audience|品牌|內部|員工|教學|學生|玩家/i;
const SOURCE_HINT_RE =
  /上傳|手邊|自己拍|現有素材|有素材|沒素材|純AI|全AI|AI\s*生成|無素材|reference|參考圖|參考影片/i;

export function inferConversationDimensions(
  text: string,
  modality: ClarificationModality
): ConversationDimensionSignals {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const lengthRe =
    /(\d+\s*(秒|分鐘?|小時|second|minute|hour|min|sec|mins|secs)\b)|\d+s\b|短片|長片|長影片|長視頻|\d+\s*字/i;
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
  return {
    hasLength,
    hasSubject,
    hasStyle: STYLE_HINT_RE.test(trimmed),
    hasPlatform: PLATFORM_HINT_RE.test(trimmed) || AUDIENCE_HINT_RE.test(trimmed),
    hasSource: SOURCE_HINT_RE.test(trimmed),
  };
}

export function nextMissingDimension(
  text: string,
  modality: ClarificationModality
): ClarificationDimension | null {
  const sig = inferConversationDimensions(text, modality);
  // Bar for "wizard satisfied":
  //   - The two foundational dimensions (length + subject for time-based
  //     media; subject for image/lora) are mandatory — we won't run a real
  //     workflow without these.
  //   - At least ONE finishing dimension (style / platform / audience) is
  //     enough; we don't want to over-ask. If the user provided either a
  //     style cue OR a platform cue, treat the wizard as complete.
  //
  // This is intentionally lenient so that "幫我做一支 30 秒廣告短片" (length +
  // implicit subject + 廣告 style) goes straight to ready instead of being
  // trapped in an extra "投放平台？" round. The LLM planner can still ask
  // for finer dimensions when it has the budget for a richer wizard.
  if (modality === "image" || modality === "lora") {
    if (!sig.hasSubject) return "subject";
    if (!sig.hasStyle && !sig.hasPlatform) return "style";
    return null;
  }
  if (modality === "voice" || modality === "music") {
    if (!sig.hasLength && !sig.hasSubject) return "duration";
    if (!sig.hasSubject) return "subject";
    return null;
  }
  // video / script / unknown
  if (!sig.hasLength && !sig.hasSubject) return "duration";
  if (!sig.hasSubject) return "subject";
  if (!sig.hasStyle && !sig.hasPlatform) return "style";
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
  modality: ClarificationModality
): { question: string; options: string[]; dimension: ClarificationDimension } | null {
  const dimension = nextMissingDimension(text, modality);
  if (!dimension) return null;
  const { options } = buildContextualClarificationOptions({
    userText: text,
    modality,
    dimension,
  });
  const question = wizardQuestionFor(modality, dimension);
  return { question, options, dimension };
}

function wizardQuestionFor(
  modality: ClarificationModality,
  dimension: ClarificationDimension
): string {
  const modalityNoun = modalityNounOf(modality);
  switch (dimension) {
    case "duration":
      if (modality === "voice") return `想要多長的旁白？（這會決定字數與情緒節奏）`;
      if (modality === "music") return `音樂希望幾秒到幾分鐘？（影響曲式與配器）`;
      return `想做多長的${modalityNoun}？（時長決定節奏與分鏡密度）`;
    case "subject":
      return `主題或主角是什麼？（一兩個關鍵字就好，例如人物、品牌、場景）`;
    case "style":
      return `想要什麼風格／調性？（這會決定我給的視覺與運鏡指引）`;
    case "platform":
      if (modality === "image") return `要用在哪？這會決定比例與解析度。`;
      if (modality === "video" || modality === "script")
        return `投放平台或比例？（IG Reel、YouTube、官網…）`;
      return `主要用在哪個情境？`;
    case "audience":
      return `主要觀眾是誰？（影響文案語氣與節奏）`;
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
