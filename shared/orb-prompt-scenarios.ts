/**
 * shared/orb-prompt-scenarios.ts
 *
 * Pure, dependency-free detectors for the edge-case prompt scenarios the
 * site-wide Orb chat needs to recognise BEFORE it spends an LLM round-trip:
 *
 *   1. Boundary input — empty / noise-only / extremely short / extremely long
 *   2. Emotional input — cancel, frustration, thanks
 *   3. Self-help queries — "這網站能幹嘛？" / "what can you do"
 *   4. History reference — "你剛剛說什麼？"
 *   5. Repeat-loop detection — same prompt 3 times in a row
 *   6. Attachment-only message with no descriptive text
 *
 * The detectors return a structured `OrbPromptScenarioOutcome` so the chat
 * context can short-circuit with a friendly reply instead of forwarding noise
 * to the planner. They never throw, never read globals, and never fetch —
 * which is what lets us unit-test them in node without React.
 */

export type OrbPromptScenario =
  | "boundary-empty"
  | "boundary-noise"
  | "boundary-too-short"
  | "boundary-too-long"
  | "attachment-only-hint"
  | "emotional-cancel"
  | "emotional-thanks"
  | "emotional-frustration"
  | "self-help"
  | "history-reference"
  | "loop";

export interface OrbPromptScenarioOutcome {
  /** Which scenario fired. */
  scenario: OrbPromptScenario;
  /** Friendly Markdown reply for the orb to post. */
  reply: string;
  /** Short label used by the chat UI's intent badge. */
  intent: string;
  /**
   * Quick-pick suggestions to surface alongside the reply. Always 0-4 items,
   * each ≤ 20 characters so the existing suggestion chip layout doesn't break.
   */
  suggestions?: string[];
  /**
   * Optional structured action hint. The chat layer is free to ignore this —
   * we surface it so callers can wire scenarios like `self-help` to the same
   * registry-driven feature summary that the explicit "ask-feature" mode uses.
   */
  followUp?: "show-feature-summary" | "open-history" | "reset-conversation";
}

export interface DetectScenarioInput {
  /** Raw user text (already trimmed by the caller is fine, we re-trim defensively). */
  text: string;
  /** Whether the user attached at least one image / video / audio / pdf. */
  hasAttachments: boolean;
  /**
   * Last few user-typed messages, oldest → newest. Used for loop detection;
   * pass the texts only, not orb replies. Pass `undefined` to disable.
   */
  recentUserTexts?: string[];
}

/**
 * Hard ceiling matching `MAX_CHAT_REQUEST_CHARS` in GlobalOrbChatContext —
 * anything past this gets silently truncated by `compactHistoryForRequest`,
 * so we warn the user before that happens.
 */
export const ORB_PROMPT_MAX_CHARS = 12_000;

/** Inputs shorter than this with no CJK/letter/digit are treated as noise. */
const MIN_MEANINGFUL_CHARS = 2;

/**
 * Repeat-loop heuristic: when the last N consecutive user messages are
 * essentially identical (case-folded + whitespace-collapsed), we surface a
 * "let me try a different angle" reply instead of bouncing the same prompt
 * through the planner again.
 */
const LOOP_REPEAT_COUNT = 3;

const CANCEL_PATTERNS = [
  /^算了$/,
  /^不要了?$/,
  /^停[一下]?$/,
  /^別[做說]?了?$/,
  /^取消$/,
  /^cancel$/i,
  /^stop$/i,
  /^nevermind$/i,
  /^never mind$/i,
  /^forget it$/i,
];

const FRUSTRATION_KEYWORDS = [
  "煩死",
  "好煩",
  "很煩",
  "爛死",
  "好爛",
  "很爛",
  "笨死",
  "蠢死",
  "廢物",
  "沒用",
  "useless",
  "stupid",
  "frustrating",
  "annoying",
];

const THANKS_PATTERNS = [
  /^謝[謝啦了]+$/,
  /^多謝$/,
  /^感謝$/,
  /^謝謝你$/,
  /^thanks?$/i,
  /^thank you$/i,
  /^thx$/i,
  /^ty$/i,
];

const SELF_HELP_PATTERNS: RegExp[] = [
  /這(個)?網站(能|可以|會)?(做|幹|提供)/,
  /(網站|平台).*(功能|可以做|能做)/,
  /有(什麼|哪些)功能/,
  /怎麼(用|開始|入門)(這個|該|此)/,
  /^幫(我)?介紹/,
  /(站內|這裡)有什麼/,
  /what can (you|it|this site) do/i,
  /how (do|to) (i )?use this/i,
  /^help$/i,
  /^\?$/,
  /^？$/,
];

const HISTORY_REFERENCE_PATTERNS: RegExp[] = [
  // Tightened: require an explicit interrogative ("什麼" / "?" / "的是") so we
  // don't false-positive on "幫我做剛剛提過的影片" which is a creation request,
  // not a history lookup.
  /你剛(剛|才)?(說|講|提)(了)?什麼/,
  /^上一(句|則|條)/,
  /回(顧|看)(一下)?(我們)?(剛|之前)(說|聊)/,
  /(剛剛|前面)(說|提)(過)?(什麼|的[那是])/,
  /what did (you|i) (just )?say/i,
  /go back to (what|the)/i,
];

/**
 * Top-level entry point. Runs detectors in priority order and returns the
 * first match. Returns `null` when the prompt is normal and should be
 * forwarded to the regular chat pipeline.
 *
 * Priority is ordered so that user-safety / friction-reducing scenarios
 * (cancel, loop, attachment-only, too-long) win over best-effort routing
 * scenarios (self-help, history-reference).
 */
export function detectOrbPromptScenario(
  input: DetectScenarioInput
): OrbPromptScenarioOutcome | null {
  const text = (input.text ?? "").trim();
  const hasAttachments = Boolean(input.hasAttachments);

  if (!text && !hasAttachments) return buildBoundaryEmpty();
  if (!text && hasAttachments) return buildAttachmentOnlyHint();

  if (text.length > ORB_PROMPT_MAX_CHARS) return buildBoundaryTooLong(text.length);

  const loopOutcome = detectLoop(text, input.recentUserTexts);
  if (loopOutcome) return loopOutcome;

  if (matchAny(text, CANCEL_PATTERNS)) return buildEmotionalCancel();

  if (matchAny(text, THANKS_PATTERNS)) return buildEmotionalThanks();

  if (containsAny(text, FRUSTRATION_KEYWORDS)) return buildEmotionalFrustration();

  if (matchAny(text, SELF_HELP_PATTERNS)) return buildSelfHelp();

  if (matchAny(text, HISTORY_REFERENCE_PATTERNS)) return buildHistoryReference();

  // Boundary noise / very-short detection runs last so a meaningful question
  // like "?" still routes to self-help (handled above) rather than tripping
  // the noise gate.
  const meaningful = countMeaningfulChars(text);
  if (meaningful === 0) return buildBoundaryNoise(text);
  if (meaningful < MIN_MEANINGFUL_CHARS) return buildBoundaryTooShort();

  return null;
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

function containsAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return true;
  }
  return false;
}

/**
 * Counts characters that are CJK ideographs, basic Latin letters, digits, or
 * Hangul/Kana — the alphabets the site actively supports. Punctuation and
 * emoji do NOT count, so "！！！" or "🤔🤔" come back as zero meaningful chars.
 */
export function countMeaningfulChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (isMeaningfulChar(ch)) count += 1;
  }
  return count;
}

function isMeaningfulChar(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  // ASCII letters / digits
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
    return true;
  }
  // CJK Unified Ideographs (basic + extension A) + Hiragana + Katakana + Hangul
  if (code >= 0x3400 && code <= 0x9fff) return true;
  if (code >= 0x3040 && code <= 0x309f) return true; // Hiragana
  if (code >= 0x30a0 && code <= 0x30ff) return true; // Katakana
  if (code >= 0xac00 && code <= 0xd7af) return true; // Hangul syllables
  return false;
}

function detectLoop(
  current: string,
  history: string[] | undefined
): OrbPromptScenarioOutcome | null {
  if (!history || history.length < LOOP_REPEAT_COUNT - 1) return null;
  const normalizedCurrent = normalizeForCompare(current);
  if (!normalizedCurrent) return null;

  const tail = history.slice(-(LOOP_REPEAT_COUNT - 1));
  const allMatch = tail.every(prev => normalizeForCompare(prev) === normalizedCurrent);
  if (!allMatch) return null;

  return {
    scenario: "loop",
    intent: "重複輸入偵測",
    reply: [
      "🔁 我注意到你連續送出同一句話了。",
      "",
      "可能是我上一次沒答到位——告訴我下面任一個方向，我換個方式再試：",
      "• 想要不同的成品（換成圖片／影片／音樂…）",
      "• 想要不同的風格或長度",
      "• 想直接看站內已有的素材",
      "",
      "或者輸入「重置對話」我們重來一次。",
    ].join("\n"),
    suggestions: ["換個風格再來", "改成短影片", "看站內已有素材", "重置對話"],
    followUp: "reset-conversation",
  };
}

function normalizeForCompare(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildBoundaryEmpty(): OrbPromptScenarioOutcome {
  return {
    scenario: "boundary-empty",
    intent: "空白輸入",
    reply: "🪶 訊息看起來是空的——直接告訴我你想做什麼（例如：「幫我做一張森林海報」「帶我去影像工作室」），或附上一張圖片讓我看看。",
    suggestions: ["生成圖片", "做短影片", "看看能做什麼", "帶我去儀表板"],
  };
}

function buildAttachmentOnlyHint(): OrbPromptScenarioOutcome {
  return {
    scenario: "attachment-only-hint",
    intent: "附件未說明",
    reply: [
      "📎 收到附件了！為了把它用對，告訴我你想拿它做什麼，例如：",
      "• 「幫我把這張延伸成一支短影片」",
      "• 「以這張的風格再生 3 張變體」",
      "• 「分析一下這張圖的主題」",
    ].join("\n"),
    suggestions: ["延伸成短影片", "生成同風格變體", "分析這張圖", "整合到我的素材庫"],
  };
}

function buildBoundaryTooLong(length: number): OrbPromptScenarioOutcome {
  return {
    scenario: "boundary-too-long",
    intent: "輸入過長",
    reply: [
      `📏 這段輸入有 ${length.toLocaleString()} 字，超過我一次能完整處理的 ${ORB_PROMPT_MAX_CHARS.toLocaleString()} 字上限——後段可能會被截掉。`,
      "",
      "可以幫我把它縮成幾個重點，或拆成兩、三輪送過來嗎？例如：",
      "• 第 1 輪先講「成品要什麼」",
      "• 第 2 輪補「風格與長度」",
      "• 第 3 輪附上參考素材",
    ].join("\n"),
    suggestions: ["改用條列重點", "拆成兩輪送", "先做摘要"],
  };
}

function buildBoundaryNoise(text: string): OrbPromptScenarioOutcome {
  const preview = text.length > 12 ? `${text.slice(0, 12)}…` : text;
  return {
    scenario: "boundary-noise",
    intent: "無法解析的輸入",
    reply: [
      `🤔 我看到「${preview}」，但讀不出明確意思——`,
      "用一句話告訴我你想做的事，例如：",
      "• 「生一張寧靜森林的封面」",
      "• 「幫我寫 30 秒的療癒短片腳本」",
      "• 「找之前那張禪意水墨」",
    ].join("\n"),
    suggestions: ["生成圖片", "做短影片", "找之前的素材", "看看能做什麼"],
  };
}

function buildBoundaryTooShort(): OrbPromptScenarioOutcome {
  return {
    scenario: "boundary-too-short",
    intent: "輸入太短",
    reply: "✏️ 訊息太短我猜不出方向——多給我幾個字，例如「想要 30 秒森林短影片」或「找我之前的水彩素材」。",
    suggestions: ["生成圖片", "做短影片", "看看能做什麼"],
  };
}

function buildEmotionalCancel(): OrbPromptScenarioOutcome {
  return {
    scenario: "emotional-cancel",
    intent: "使用者取消",
    reply: [
      "✋ 好——這輪我先停下，沒幫你下任何動作。",
      "",
      "需要時再叫我；如果想換個方向，直接告訴我新需求就行。",
    ].join("\n"),
    suggestions: ["重置對話", "看看能做什麼", "回首頁"],
    followUp: "reset-conversation",
  };
}

function buildEmotionalThanks(): OrbPromptScenarioOutcome {
  return {
    scenario: "emotional-thanks",
    intent: "使用者道謝",
    reply: "✨ 不客氣！想繼續做下一件事的話，告訴我成品方向（圖片／影片／音樂／腳本…）我接著幫你拼流程。",
    suggestions: ["繼續上一個任務", "做新東西", "看看能做什麼"],
  };
}

function buildEmotionalFrustration(): OrbPromptScenarioOutcome {
  return {
    scenario: "emotional-frustration",
    intent: "使用者不滿",
    reply: [
      "😣 抱歉讓你覺得卡住了——讓我們換個方式：",
      "• 想要我直接給三組不同方向你挑？",
      "• 還是先告訴我哪一步沒對到位？",
      "• 想重置這輪對話從頭來也可以。",
    ].join("\n"),
    suggestions: ["給我三組方向", "先告訴我哪裡卡住", "重置對話"],
    followUp: "reset-conversation",
  };
}

function buildSelfHelp(): OrbPromptScenarioOutcome {
  return {
    scenario: "self-help",
    intent: "站內功能查詢",
    reply: "🧭 想知道這個站能幫你做什麼？我把目前實際註冊的功能列表整理給你——",
    suggestions: ["生成圖片", "做短影片", "找素材", "帶我去儀表板"],
    followUp: "show-feature-summary",
  };
}

function buildHistoryReference(): OrbPromptScenarioOutcome {
  return {
    scenario: "history-reference",
    intent: "回顧歷史對話",
    reply: [
      "🕰️ 想回顧之前的對話的話：",
      "• 點右上「歷史」可以看到完整聊天紀錄",
      "• 或告訴我關鍵字（例如「上次那個森林海報」），我幫你找回對應段落",
    ].join("\n"),
    suggestions: ["打開聊天歷史", "找上次的素材", "重置對話"],
    followUp: "open-history",
  };
}
