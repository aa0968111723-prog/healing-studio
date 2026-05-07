/**
 * orb-search-intent.ts — 偵測使用者想搜尋全站資料的意圖。
 *
 * 觸發詞：
 *   - "找我之前的 X" / "翻一下 X" / "我之前做過的 X"
 *   - "搜尋 X" / "search X"
 *   - "我的素材有沒有 X" / "我的筆記提到 X"
 *
 * 抓出搜尋字串後丟給 `orbProxy.unifiedSearch` 端點。純函式，可在前端與
 * 後端同樣呼叫；vitest 可直接測。
 */

// Mirrored locally so this module stays isomorphic (no server-only imports).
// Keep in sync with server/services/orbUnifiedSearch.ts.
export type UnifiedSearchKind = "asset" | "note" | "history" | "tutorial";

const TRIGGER_RE =
  /^(?:幫我|麻煩|可以幫我|請)?\s*(?:找一下|找|搜|搜尋|翻一下|翻|查|查一下|search|find|look\s*up)\s*(.+?)\s*$/i;
const POSSESSIVE_RE =
  /(?:我之前|之前我|我那個|我那邊|我手邊|我的)\s*(?:做過的|生成過的|存過的|拍過的|寫過的|看過的)?\s*(.+?)$/i;
const NOTE_HINT_RE = /(?:我的)?筆記|note/i;
const ASSET_HINT_RE = /(?:素材|資產|庫|圖|影片|音樂|asset)/i;
const HISTORY_HINT_RE = /(?:歷史|生成記錄|history)/i;
const TUTORIAL_HINT_RE = /(?:教學|文件|文章|tutorial|doc)/i;

export interface SearchIntentDetection {
  /** Cleaned query the user is searching for. */
  query: string;
  /** Optional restricted kinds based on hints in the user text. */
  types?: UnifiedSearchKind[];
}

/**
 * Try to detect a "search the site" intent. Returns null when the text doesn't
 * look like a search command.
 */
export function detectOrbSearchIntent(text: string): SearchIntentDetection | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  let query: string | null = null;
  const triggerMatch = cleaned.match(TRIGGER_RE);
  if (triggerMatch) {
    query = triggerMatch[1].trim();
  } else {
    const possessiveMatch = cleaned.match(POSSESSIVE_RE);
    // Possessive matches alone are very prone to false positives, so require
    // an explicit data-type hint (素材 / 筆記 / 歷史 / 教學) before we trust it.
    if (
      possessiveMatch &&
      (ASSET_HINT_RE.test(cleaned) ||
        NOTE_HINT_RE.test(cleaned) ||
        HISTORY_HINT_RE.test(cleaned))
    ) {
      query = possessiveMatch[1].trim();
    }
  }

  if (!query) return null;
  // Strip trailing particles + punctuation that survive the trigger regex.
  query = query.replace(/^(?:的|那個|那邊|嗎|呢|啊|耶|喔)\s*/i, "");
  query = query.replace(/[?？！。.，,]+$/g, "").trim();
  if (!query || query.length < 2) return null;

  const types: UnifiedSearchKind[] = [];
  if (NOTE_HINT_RE.test(cleaned)) types.push("note");
  if (ASSET_HINT_RE.test(cleaned)) types.push("asset");
  if (HISTORY_HINT_RE.test(cleaned)) types.push("history");
  if (TUTORIAL_HINT_RE.test(cleaned)) types.push("tutorial");

  return {
    query,
    ...(types.length > 0 ? { types } : {}),
  };
}

/**
 * Format a list of unified-search results into a readable markdown reply.
 * Pure function — no DOM / network / state. Call from the chat context after
 * `trpc.orbProxy.unifiedSearch.fetch()` returns.
 */
export interface UnifiedSearchResultLike {
  kind: UnifiedSearchKind;
  title: string;
  snippet: string;
  path: string;
  badge?: string;
}

const KIND_EMOJI: Record<UnifiedSearchKind, string> = {
  asset: "🖼️",
  note: "📝",
  history: "🗂️",
  tutorial: "📚",
};

const KIND_LABEL: Record<UnifiedSearchKind, string> = {
  asset: "素材",
  note: "筆記",
  history: "生成記錄",
  tutorial: "教學文件",
};

export function formatUnifiedSearchReply(
  query: string,
  items: UnifiedSearchResultLike[]
): string {
  if (items.length === 0) {
    return `🔍 全站翻找「${query}」沒有命中——可以試試把關鍵字改寬一點，或告訴我要找哪一類（素材／筆記／生成記錄／教學）。`;
  }
  const lines: string[] = [`🔍 為「${query}」整理 ${items.length} 筆結果：`, ""];
  for (const item of items) {
    const emoji = KIND_EMOJI[item.kind];
    const label = KIND_LABEL[item.kind];
    const badge = item.badge ? `（${item.badge}）` : "";
    lines.push(`- ${emoji} **${item.title}** — ${label}${badge}`);
    if (item.snippet) lines.push(`  > ${item.snippet}`);
    lines.push(`  [開啟](${item.path})`);
  }
  lines.push("");
  lines.push("想再縮小範圍，可以告訴我「只看素材」「只找筆記」這類條件。");
  return lines.join("\n");
}
