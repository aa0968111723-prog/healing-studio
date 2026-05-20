/**
 * shared/orb-script-structure.ts
 *
 * Pure structural parser for long-form Orb chat input — when a user pastes a
 * detailed brief / script (a few hundred to a few thousand chars), we want to
 * extract the dimensions they've already specified (length, subject, style,
 * platform, purpose, scene count) so the clarification wizard does NOT
 * re-ask them.
 *
 * Outputs are deliberately minimal: each field is either a confident value
 * or `null/undefined`. The clarification layer treats any populated field as
 * a "covered dimension" and skips that dimension when assembling the next
 * question.
 *
 * No I/O, no DOM. Importable from both server (planner system prompt) and
 * client (chat context).
 */

import type {
  ClarificationModality,
  ConversationDimensionSignals,
} from "./orb-clarification-options";
import { extractTopicWord } from "./orb-clarification-options";

export type ScriptFormat =
  | "短片"
  | "長片"
  | "圖片"
  | "海報"
  | "插畫"
  | "音樂"
  | "配音"
  | "音效"
  | "腳本"
  | "podcast"
  | "貼文";

export type ScriptPurpose =
  | "個人收藏"
  | "社群曝光"
  | "品牌行銷"
  | "教學分享"
  | "紀錄保存"
  | "廣告投放";

export interface ScriptStructure {
  /** High-level format categorisation. Mirrors what wizard "format" would ask. */
  format: ScriptFormat | null;
  /** Modality bucket consistent with `inferModalityFromText`. */
  modality: ClarificationModality;
  /** Concrete length, normalised to seconds. Image/poster briefs leave this null. */
  durationSec: number | null;
  /** Original user-facing length phrase ("30 秒", "1 分鐘", "5 分鐘以上"). */
  durationLabel: string | null;
  /** Topic / subject word — capped at 6 chars to fit a clarification chip. */
  subject: string | null;
  /** Detected style keywords (deduped, max 4). */
  styles: string[];
  /** Detected platform / aspect-ratio keywords (deduped, max 4). */
  platforms: string[];
  /** Inferred purpose / use-case bucket. */
  purpose: ScriptPurpose | null;
  /** Number of explicit scene markers (場景 1, scene 1, 第一段…). */
  scenes: number;
  /** Entities detected from the script for worldbuilding auto-linking. */
  productionEntities: {
    characters: string[];
    sceneRefs: string[];
    objects: string[];
    musicCues: string[];
    storyboardCues: string[];
  };
  /** Aggregate confidence score in 0–1 range — number of populated fields / 7. */
  coverage: number;
  /** Diagnostic: which raw signals fired. Useful for tests + the summary card. */
  signals: string[];
}

/**
 * Threshold: text under this length isn't treated as a "long script" — we
 * fall through to the regular per-message clarification path. Calibrated so
 * a typical creation request like "幫我做一支森林短片" stays out of the
 * structure-summary scenario.
 */
export const SCRIPT_STRUCTURE_MIN_CHARS = 280;

const FORMAT_PATTERNS: Array<[RegExp, ScriptFormat, ClarificationModality]> = [
  [/長片|長影片|長視頻|微電影|short ?film|long ?form/i, "長片", "video"],
  [/短片|reel|社群短片|vlog/i, "短片", "video"],
  [/podcast|播客|節目集/i, "podcast", "voice"],
  [/海報|poster|主視覺/i, "海報", "image"],
  [/插畫|illustration|手繪/i, "插畫", "image"],
  [/圖片|封面|picture|cover|wallpaper/i, "圖片", "image"],
  [/音樂|配樂|bgm|background music/i, "音樂", "music"],
  [/音效|sfx|sound effect|環境音/i, "音效", "music"],
  [/配音|旁白|tts|voice over|voiceover/i, "配音", "voice"],
  [/腳本|劇本|文案 ?稿|script/i, "腳本", "script"],
  [/貼文|社群文|carousel|ig 文/i, "貼文", "image"],
  [/影片|video|電影/i, "短片", "video"],
];

const STYLE_KEYWORDS = [
  "電影感",
  "紀錄",
  "寫實",
  "手繪",
  "水彩",
  "水墨",
  "油畫",
  "插畫",
  "極簡",
  "復古",
  "未來",
  "賽博",
  "cyberpunk",
  "療癒",
  "溫柔",
  "夢幻",
  "暗黑",
  "明亮",
  "高對比",
  "電影級",
  "cinematic",
  "documentary",
  "realistic",
  "anime",
  "manga",
  "watercolor",
  "sketch",
  "neon",
  "pastel",
  "minimalist",
  "vintage",
];

const PLATFORM_KEYWORDS = [
  "ig reel",
  "instagram",
  "ig",
  "tiktok",
  "抖音",
  "youtube shorts",
  "youtube",
  "shorts",
  "facebook",
  "fb",
  "小紅書",
  "x ",
  "twitter",
  "linkedin",
  "9:16",
  "16:9",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "3:2",
  "直式",
  "橫式",
  "方形",
  "限動",
  "story",
  "印刷",
  "podcast 平台",
  "spotify",
  "apple podcasts",
];

const PURPOSE_PATTERNS: Array<[RegExp, ScriptPurpose]> = [
  [/(廣告|投放|轉換|conversion|advert|promo)/i, "廣告投放"],
  [/(品牌|brand|公司形象|corporate)/i, "品牌行銷"],
  [/(教學|tutorial|教程|科普|knowledge|teach)/i, "教學分享"],
  [/(社群|曝光|粉絲|追蹤|engagement|reach)/i, "社群曝光"],
  [/(紀錄|保存|回憶|memorial|archive)/i, "紀錄保存"],
  [/(個人|收藏|興趣|私房|hobby|personal)/i, "個人收藏"],
];

const SCENE_MARKER_REGEXES: RegExp[] = [
  // Allow scene markers after a newline OR after Chinese sentence
  // punctuation — long briefs often write "...沉靜。場景一：..." inline.
  /(?:^|[\n。.！？!?])\s*場景\s*[一二三四五六七八九十0-9]+/g,
  /(?:^|[\n。.！？!?])\s*第\s*[一二三四五六七八九十0-9]+\s*[幕段場]/g,
  /(?:^|[\n。.！？!?])\s*scene\s*\d+/gi,
  /(?:^|[\n。.！？!?])\s*chapter\s*\d+/gi,
  /(?:^|[\n。.！？!?])\s*shot\s*\d+/gi,
];

/**
 * Subjects that look like leftover stripping artefacts — duration units,
 * style-modifier fragments, single repeated chars. We reject these so the
 * wizard still asks for a real topic instead of being satisfied with noise.
 */
const SUBJECT_REJECT_RE = /^(分鐘?|秒|小?時|hours?|minutes?|seconds?|配.+風格.*|.+風格.*)$/i;
const SUBJECT_EXPLICIT_RE =
  /(?:主題|題目|主角|內容(?:是)?|關於)\s*[：:是為]?\s*([一-鿿]{2,8}|[A-Za-z][A-Za-z\s\-]{1,20})/;

const CN_NUMBERS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  兩: 2, 半: 0.5,
};

function chineseNumberToInt(token: string): number | null {
  if (!token) return null;
  if (/^\d+(?:\.\d+)?$/.test(token)) return parseFloat(token);
  // Handle simple cases: 一二三...十, 二十, 三十秒, 一個半, 兩, 半
  if (token === "半") return 0.5;
  let value = 0;
  let pending = 0;
  for (const ch of token) {
    const n = CN_NUMBERS[ch];
    if (n === undefined) {
      // unrecognised char — bail, single-digit fallback later
      return null;
    }
    if (n === 10) {
      value += pending === 0 ? 10 : pending * 10;
      pending = 0;
    } else {
      pending += n;
    }
  }
  return value + pending || null;
}

/**
 * Convert a raw duration phrase (e.g. "30 秒", "1 分", "兩分半", "5 mins")
 * to seconds. Returns null when nothing parses cleanly.
 */
export function parseDurationToSeconds(phrase: string): number | null {
  if (!phrase) return null;
  const lower = phrase.toLowerCase().trim();

  // English first: "30 sec", "1 min", "1.5 minutes"
  const enMin = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (enMin) return Math.round(parseFloat(enMin[1]) * 60);
  const enSec = lower.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (enSec) return Math.round(parseFloat(enSec[1]));
  const enHr = lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (enHr) return Math.round(parseFloat(enHr[1]) * 3600);

  // Chinese: "30秒" / "1分鐘" / "兩分半" / "1小時"
  const cnHr = phrase.match(/([零一二三四五六七八九十兩半\d]+(?:\.\d+)?)\s*小?時/);
  if (cnHr) {
    const v = chineseNumberToInt(cnHr[1]);
    if (v !== null) return Math.round(v * 3600);
  }
  const cnMinHalf = phrase.match(/([零一二三四五六七八九十兩半\d]+)\s*分(鐘)?半/);
  if (cnMinHalf) {
    const v = chineseNumberToInt(cnMinHalf[1]);
    if (v !== null) return Math.round((v + 0.5) * 60);
  }
  const cnMin = phrase.match(/([零一二三四五六七八九十兩半\d]+(?:\.\d+)?)\s*分(鐘)?/);
  if (cnMin) {
    const v = chineseNumberToInt(cnMin[1]);
    if (v !== null) return Math.round(v * 60);
  }
  const cnSec = phrase.match(/([零一二三四五六七八九十兩半\d]+(?:\.\d+)?)\s*秒/);
  if (cnSec) {
    const v = chineseNumberToInt(cnSec[1]);
    if (v !== null) return Math.round(v);
  }
  return null;
}

function detectFormat(
  text: string
): { format: ScriptFormat | null; modality: ClarificationModality } {
  for (const [re, format, modality] of FORMAT_PATTERNS) {
    if (re.test(text)) return { format, modality };
  }
  return { format: null, modality: "unknown" };
}

function detectSubject(text: string): string | null {
  // Highest-precedence: explicit markers like "主題是 X" / "關於 X" / "topic: X".
  const explicit = text.match(SUBJECT_EXPLICIT_RE);
  if (explicit) {
    const cand = explicit[1].trim().slice(0, 6);
    if (cand.length >= 2 && !SUBJECT_REJECT_RE.test(cand)) return cand;
  }
  // Fallback: the shared topic extractor. We post-filter its output so
  // residue like "分鐘" / "配療癒風格的" / single-char repeats don't pose as
  // legitimate subjects (those would let the wizard wrongly skip its
  // "what's the topic?" question).
  const fallback = extractTopicWord(text);
  if (!fallback || fallback.length < 2) return null;
  if (SUBJECT_REJECT_RE.test(fallback)) return null;
  // Reject runs that are a single character repeated (e.g. "做做做做做做").
  if (new Set(Array.from(fallback)).size <= 1) return null;
  return fallback;
}

function detectDuration(text: string): {
  durationSec: number | null;
  durationLabel: string | null;
} {
  // Try to find the FIRST duration phrase — for long scripts with multiple
  // numbers, the first one is almost always the overall length.
  const matchers: RegExp[] = [
    /([零一二三四五六七八九十兩半\d]+(?:\.\d+)?\s*小?時)/,
    /([零一二三四五六七八九十兩半\d]+\s*分(?:鐘)?半)/,
    /([零一二三四五六七八九十兩半\d]+(?:\.\d+)?\s*分(?:鐘)?)/,
    /([零一二三四五六七八九十兩半\d]+(?:\.\d+)?\s*秒)/,
    /(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours))\b/i,
    /(\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes))\b/i,
    /(\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds))\b/i,
  ];
  for (const re of matchers) {
    const m = text.match(re);
    if (!m) continue;
    const seconds = parseDurationToSeconds(m[1]);
    if (seconds !== null && seconds > 0) {
      return { durationSec: seconds, durationLabel: m[1].trim() };
    }
  }
  return { durationSec: null, durationLabel: null };
}

function detectStyles(text: string): string[] {
  const lowered = text.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of STYLE_KEYWORDS) {
    const needle = kw.toLowerCase();
    if (lowered.includes(needle) && !seen.has(needle)) {
      seen.add(needle);
      out.push(kw);
      if (out.length >= 4) break;
    }
  }
  return out;
}

function detectPlatforms(text: string): string[] {
  const lowered = text.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of PLATFORM_KEYWORDS) {
    const needle = kw.toLowerCase();
    if (lowered.includes(needle) && !seen.has(needle)) {
      seen.add(needle);
      out.push(kw);
      if (out.length >= 4) break;
    }
  }
  return out;
}

function detectPurpose(text: string): ScriptPurpose | null {
  for (const [re, purpose] of PURPOSE_PATTERNS) {
    if (re.test(text)) return purpose;
  }
  return null;
}

function detectScenes(text: string): number {
  let count = 0;
  for (const re of SCENE_MARKER_REGEXES) {
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

function detectProductionEntities(text: string): ScriptStructure["productionEntities"] {
  const normalize = (items: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const token = raw.trim();
      if (!token || token.length < 2 || seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= 8) break;
    }
    return out;
  };

  const pick = (re: RegExp): string[] =>
    Array.from(text.matchAll(re)).map(m => (m[1] ?? "").replace(/[，。,.!?！？:：]/g, "").trim());

  return {
    characters: normalize(pick(/(?:角色|主角|人物)\s*[：:是為]?\s*([\u4e00-\u9fffa-zA-Z0-9_\-]{2,20})/gmu)),
    sceneRefs: normalize(pick(/(?:場景|scene)\s*[：:#]?\s*([\u4e00-\u9fffa-zA-Z0-9_\-]{1,24})/gimu)),
    objects: normalize(pick(/(?:物件|道具|props?)\s*[：:是為]?\s*([\u4e00-\u9fffa-zA-Z0-9_\-]{2,20})/gimu)),
    musicCues: normalize(pick(/(?:配樂|bgm|music)\s*[：:是為]?\s*([\u4e00-\u9fffa-zA-Z0-9_\-]{2,24})/gimu)),
    storyboardCues: normalize(pick(/(?:分鏡|鏡頭|shot)\s*[：:#]?\s*([\u4e00-\u9fffa-zA-Z0-9_\-]{1,24})/gimu)),
  };
}

/**
 * Top-level parser. Always returns a populated `ScriptStructure` — fields
 * that couldn't be extracted are null / empty. Use `coverage` (or check
 * individual fields) to decide whether the result is worth surfacing to the
 * user.
 */
export function extractScriptStructure(text: string): ScriptStructure {
  if (!text) {
    return {
      format: null,
      modality: "unknown",
      durationSec: null,
      durationLabel: null,
      subject: null,
      styles: [],
      platforms: [],
      purpose: null,
      scenes: 0,
      productionEntities: { characters: [], sceneRefs: [], objects: [], musicCues: [], storyboardCues: [] },
      coverage: 0,
      signals: [],
    };
  }

  const formatHit = detectFormat(text);
  const duration = detectDuration(text);
  const subjectFinal = detectSubject(text);
  const styles = detectStyles(text);
  const platforms = detectPlatforms(text);
  const purpose = detectPurpose(text);
  const scenes = detectScenes(text);
  const productionEntities = detectProductionEntities(text);

  const signals: string[] = [];
  if (formatHit.format) signals.push(`format=${formatHit.format}`);
  if (duration.durationSec !== null) signals.push(`duration=${duration.durationSec}s`);
  if (subjectFinal) signals.push(`subject=${subjectFinal}`);
  if (styles.length > 0) signals.push(`styles=${styles.join(",")}`);
  if (platforms.length > 0) signals.push(`platforms=${platforms.join(",")}`);
  if (purpose) signals.push(`purpose=${purpose}`);
  if (scenes > 0) signals.push(`scenes=${scenes}`);
  if (Object.values(productionEntities).some(items => items.length > 0)) {
    signals.push("production_entities");
  }

  // Coverage: how many of the seven dimensions are populated.
  const coverage = signals.length / 7;

  return {
    format: formatHit.format,
    modality: formatHit.modality,
    durationSec: duration.durationSec,
    durationLabel: duration.durationLabel,
    subject: subjectFinal,
    styles,
    platforms,
    purpose,
    scenes,
    productionEntities,
    coverage,
    signals,
  };
}

/**
 * Convert the structured parse into the same `ConversationDimensionSignals`
 * shape the clarification wizard already understands. The wizard then OR-s
 * these with regex-detected signals so anything pulled from a long brief is
 * treated as a covered dimension — no re-asking.
 */
export function structureToDimensionSignals(
  s: ScriptStructure
): ConversationDimensionSignals {
  return {
    hasLength: s.durationSec !== null,
    hasSubject: s.subject !== null,
    hasStyle: s.styles.length > 0,
    hasPlatform: s.platforms.length > 0,
    hasPurpose: s.purpose !== null,
    hasSource: false,
  };
}

/**
 * Render a short Markdown summary of what we extracted. Used by the
 * `long-script-summarised` scenario card so the user can confirm
 * (or correct) the parse before we kick off the workflow.
 */
export function summarizeScriptStructure(
  s: ScriptStructure,
  charCount: number
): string {
  const lines: string[] = [`📄 我從你給的 ${charCount.toLocaleString()} 字詳細說明擷取到——`];
  if (s.format || s.modality !== "unknown") {
    lines.push(`• 成品：${s.format ?? modalityFallback(s.modality)}`);
  }
  if (s.durationLabel) {
    lines.push(`• 長度：${s.durationLabel}`);
  }
  if (s.subject) {
    lines.push(`• 主題：${s.subject}`);
  }
  if (s.styles.length > 0) {
    lines.push(`• 風格：${s.styles.slice(0, 3).join("、")}`);
  }
  if (s.platforms.length > 0) {
    lines.push(`• 平台：${s.platforms.slice(0, 3).join("、")}`);
  }
  if (s.purpose) {
    lines.push(`• 用途：${s.purpose}`);
  }
  if (s.scenes > 0) {
    lines.push(`• 場景：偵測到 ${s.scenes} 段（會走多章節流程）`);
  }
  const queueSize = Object.values(s.productionEntities).reduce((sum, items) => sum + items.length, 0);
  if (queueSize > 0) {
    lines.push(`• 製作清單：抓到 ${queueSize} 個角色／場景／物件／配樂／分鏡線索，可自動建立初稿供你調整`);
  }
  lines.push("");
  lines.push("是這樣嗎？想直接開始就回「這樣開始」，要修改告訴我哪一項。");
  return lines.join("\n");
}

function modalityFallback(m: ClarificationModality): string {
  switch (m) {
    case "video": return "影片";
    case "image": return "圖像";
    case "music": return "音樂";
    case "voice": return "配音／旁白";
    case "script": return "腳本";
    case "lora": return "客製化模型";
    case "research": return "研究／調研";
    default: return "成品";
  }
}

/**
 * Count of dimensions extracted — used by the long-script scenario gate to
 * decide whether the parse is substantial enough to short-circuit with a
 * confirmation card instead of forwarding straight to the planner.
 */
export function scriptStructureDimensionCount(s: ScriptStructure): number {
  let n = 0;
  if (s.format !== null || s.modality !== "unknown") n += 1;
  if (s.durationSec !== null) n += 1;
  if (s.subject !== null) n += 1;
  if (s.styles.length > 0) n += 1;
  if (s.platforms.length > 0) n += 1;
  if (s.purpose !== null) n += 1;
  if (s.scenes > 0) n += 1;
  return n;
}
