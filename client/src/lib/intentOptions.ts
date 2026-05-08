/**
 * intentOptions.ts — Parse "intent option" blocks out of an AI chat message.
 *
 * The orb (and other agents) often reply with a 2-of-N choice list like:
 *
 *   **選項 A：繼續風景圖創作**
 *   → 我已經推薦好 Nano Banana Pro 了，現在直接生成就行
 *
 *   **選項 B：先用導演 AI 規劃腳本**
 *   → 把「療癒風景」的想法擴展成完整的分鏡需求
 *
 * Rendering this as raw markdown forces the user to retype the option. We turn
 * each block into a clickable intent card instead. The parser splits the
 * message text into segments — plain text sections and intent-card groups —
 * so the renderer can interleave both.
 */

export interface IntentOption {
  /** "A", "B", "1", "一" — the marker the AI used. */
  key: string;
  /** Human title, e.g. "繼續風景圖創作". */
  title: string;
  /** Optional short description (the line introduced by `→` / `-`). */
  description?: string;
  /** Reconstructed text the user "says" when they pick the card. */
  pickText: string;
}

export type IntentSegment =
  | { kind: "text"; value: string }
  | { kind: "options"; options: IntentOption[] };

// Bold heading: optionally prefixed with "選項" / "Option", then a single-token
// key (A-Z, 1-9, or 一二三...), a separator, then the title up to the closing
// `**`. We tolerate full-width / half-width separators.
const OPTION_BLOCK = new RegExp(
  // Opening **
  String.raw`\*\*\s*(?:選項|option)?\s*` +
    // Key: latin letter, arabic digit, or chinese numeral
    String.raw`([A-Za-z]|\d{1,2}|[一二三四五六七八九十])` +
    // Separator
    String.raw`\s*[：:．\.、)）]\s*` +
    // Title (non-* / non-newline, lazy)
    String.raw`([^*\n]+?)\s*\*\*` +
    // Optional description on the next line, prefixed by an arrow / dash
    String.raw`(?:[ \t]*\n[ \t]*(?:→|➡|▸|▶|⇒|›|->|=>|—|–|-)[ \t]*([^\n]+))?`,
  "giu"
);

interface RawMatch {
  start: number;
  end: number;
  option: IntentOption;
}

function findMatches(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  const re = new RegExp(OPTION_BLOCK.source, OPTION_BLOCK.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const title = m[2].trim();
    const description = m[3]?.trim();
    if (!title) continue;
    const pickText = `選項 ${key}：${title}`;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      option: { key, title, description, pickText },
    });
  }
  return out;
}

/**
 * Group consecutive matches that are only separated by whitespace into a
 * single options-segment. Returns text segments for everything else.
 *
 * A solitary option (1 of 1) is still rendered as a card — even a single
 * `**選項 A：…**` is a clear call-to-action.
 */
export function parseIntentSegments(text: string): IntentSegment[] {
  if (!text) return [];
  const matches = findMatches(text);
  if (matches.length === 0) return [{ kind: "text", value: text }];

  const segments: IntentSegment[] = [];
  let cursor = 0;
  let i = 0;
  while (i < matches.length) {
    // Group with the next matches as long as the gap is whitespace-only.
    const group: IntentOption[] = [matches[i].option];
    let groupEnd = matches[i].end;
    let j = i + 1;
    while (j < matches.length) {
      const gap = text.slice(groupEnd, matches[j].start);
      if (!/^\s*$/.test(gap)) break;
      group.push(matches[j].option);
      groupEnd = matches[j].end;
      j += 1;
    }

    // Flush text before the group.
    if (matches[i].start > cursor) {
      const before = text.slice(cursor, matches[i].start);
      if (before.length) segments.push({ kind: "text", value: before });
    }
    segments.push({ kind: "options", options: group });
    cursor = groupEnd;
    i = j;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
}

/** Returns true if `text` contains any intent-card pattern. Cheap pre-check. */
export function hasIntentOptions(text: string): boolean {
  if (!text) return false;
  const re = new RegExp(OPTION_BLOCK.source, OPTION_BLOCK.flags);
  return re.test(text);
}
