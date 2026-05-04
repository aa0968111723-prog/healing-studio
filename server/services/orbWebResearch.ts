/**
 * server/services/orbWebResearch.ts
 *
 * Lightweight wrapper around `webSearch` (Brave + GitHub fallback) used by the
 * `ai.chat` route to enrich the orb's reply with real, citable web results
 * when the user asks a research-style question.
 *
 * ═══ v2 升級（Perplexity Deep Search 整合）═══
 *
 * 改動重點：
 *   1. RESEARCH_PATTERNS 大幅擴展 — 涵蓋「搜尋」「查詢」「最新」「趨勢」「比較」
 *      等更多中英文搜尋意圖關鍵字
 *   2. IN_APP_INTENT_PATTERNS 精緻化 — 「幫我搜尋」不再被誤判為站內操作
 *   3. 新增 `runOrbDeepSearch()` — 主動式深度搜尋，由 planner 決定呼叫
 *   4. MAX_RESEARCH_TEXT_LEN 提高至 400 — 支援更長的搜尋請求
 *   5. 新增 `EXPLICIT_SEARCH_PATTERNS` — 使用者明確要求搜尋時直接觸發
 *
 * Trigger: only when the latest user message contains explicit research /
 * how-to language (中文：流程、過程、怎麼、如何、步驟、教學、做法、是什麼、原理；
 * 英文：how to, steps, tutorial, what is, process, recipe, history of …).
 *
 * The orb's existing LLM call gets a `【網路研究】` block appended to its system
 * prompt, listing 3–5 source titles + URLs + 1-line summaries. The LLM is then
 * told to cite the sources in its reply (via the existing /process URL guide).
 */

import { webSearch, type WebResearchResult } from "./brainAutoRepair";
import {
  executeDeepSearch,
  formatDeepSearchForPrompt,
  formatDeepSearchAsLearnDoc,
  type DeepSearchResult,
} from "./perplexityDeepSearch";

// ─── Explicit search intent patterns (highest priority) ─────────────────────
// When the user explicitly asks to "search", "look up", "find info about",
// these ALWAYS trigger web research, regardless of other patterns.
const EXPLICIT_SEARCH_PATTERNS: RegExp[] = [
  /搜尋|搜索|查詢|查找|查一下|找一下|幫我查|幫我找|幫我搜/,
  /爬網|爬取|網路搜尋|外部搜尋|上網查|上網找|上網搜/,
  /\bsearch\s+(for|about|on)\b/i,
  /\blook\s*up\b/i,
  /\bfind\s+(info|information|out|about)\b/i,
  /\bresearch\b/i,
  /\bgoogle\b/i,
];

/**
 * Patterns that indicate the user is asking for an externally-researchable
 * topic rather than driving an in-app action. We only trigger web research
 * when one of these matches AND the message is short enough that we're
 * confident it's a question (very long messages are usually scripts /
 * prompts the user wants the orb to act on, not research).
 *
 * v2: 大幅擴展，涵蓋更多搜尋意圖
 */
const RESEARCH_PATTERNS: RegExp[] = [
  // ── 原有模式 ──
  /如何\s*[做製作生實泡]/,
  /怎麼[做樣製作泡煮]/,
  /[製做]\s*[作茶飯麵糕]/,
  /流程|過程|步驟|教學|做法|原理|歷史|起源|由來/,
  /是什麼|是甚麼|什麼是|甚麼是/,
  /\bhow\s+to\b/i,
  /\bstep\s*by\s*step\b/i,
  /\btutorial\b/i,
  /\bwhat\s+is\b/i,
  /\bhistory\s+of\b/i,
  /\bprocess\s+of\b/i,
  /\brecipe\b/i,

  // ── v2 新增：趨勢、比較、推薦、新聞 ──
  /最新|最近|趨勢|動態|新聞|消息|發展|進展|更新/,
  /比較|對比|差異|優缺點|優劣|哪個好|哪個比較/,
  /推薦|建議|排名|排行|評價|評測|評比|心得/,
  /有哪些|有什麼|列出|整理|盤點|總結|摘要/,
  /為什麼|為何|原因|解釋|說明/,
  /技術|方法|方案|策略|工具|框架|平台/,
  /價格|費用|成本|收費|定價/,

  // ── v2 新增：英文擴展 ──
  /\blatest\b|\brecent\b|\btrend\b|\bnews\b/i,
  /\bcompare\b|\bcomparison\b|\bvs\b|\bversus\b/i,
  /\brecommend\b|\bsuggestion\b|\bbest\b|\btop\b/i,
  /\bwhy\b|\breason\b|\bexplain\b/i,
  /\bprice\b|\bcost\b|\bpricing\b/i,
  /\breview\b|\brating\b|\bbenchmark\b/i,
];

/**
 * Negative patterns — if the user is clearly asking the orb to perform an
 * in-app action ("帶我去 …", "幫我生成 …"), we skip research even when
 * RESEARCH_PATTERNS would otherwise match.
 *
 * v2: 精緻化 — 「幫我搜尋」「幫我查」不再被誤判為站內操作
 *     只有明確的站內導航/生成指令才跳過搜尋
 */
const IN_APP_INTENT_PATTERNS: RegExp[] = [
  /帶我去|幫我去|前往|跳到|切到|打開/,
  // v2: 「幫我生」「幫我做」仍然是站內操作，但「幫我搜」「幫我查」「幫我找」已移除
  /幫我[生產做](?!.*搜|.*查|.*找)/,
  /\bnavigate\b|\bgo\s+to\b/i,
  // v2: 明確的生成指令
  /^生成|^產生|^製作|^創建|^建立/,
];

/** v2: 提高長度上限，支援更長的搜尋請求 */
const MAX_RESEARCH_TEXT_LEN = 400;
const RESEARCH_QUERY_MAX_LEN = 150;
const RESEARCH_RESULT_LIMIT = 5;

/**
 * Conversational filler / instruction prefixes we strip from the search query.
 * The raw user message is great context for the LLM but pollutes search engine
 * recall — e.g., "幫我規劃一支貓咪大戰爭影片" should query for the topic
 * ("貓咪大戰爭 影片"), not the imperative wrapper.
 */
const QUERY_FILLER_PATTERNS: RegExp[] = [
  /^[\s，。、！？\?!.]+/,
  /(請|幫我|可以|麻煩|能不能|想要|我要|我想|想請|請問|想做|要做|做一個|做個|規劃|安排|生成|產生|產出|教我|告訴我|跟我說|請你|請給我|請幫我)/g,
  /(嗎|呢|啊|喔|耶|拜託|謝謝|感恩)/g,
  /\[使用者澄清\][:：][\s\S]*$/,
  // v2: 移除搜尋相關的填充詞
  /(搜尋|搜索|查詢|查找|查一下|找一下|上網查|上網找|上網搜|爬網|爬取)/g,
];

const QUERY_KEEP_PUNCTUATION = /[「」『』《》〈〉【】（）()\[\]"']/g;
const QUERY_WHITESPACE = /\s+/g;

export interface OrbWebResearchOutcome {
  /** Block to append to the system prompt (already prefixed with header). */
  promptBlock: string | null;
  /** Raw results — used for telemetry / surfacing references in the reply. */
  results: WebResearchResult[];
  /** Reason the trigger fired (or didn't), for debugging / telemetry. */
  reason:
    | "matched"
    | "matched:explicit_search"
    | "matched:deep_search"
    | "skipped:disabled"
    | "skipped:empty"
    | "skipped:too_long"
    | "skipped:in_app_intent"
    | "skipped:no_pattern"
    | "skipped:no_results"
    | "error";
  /** v2: Deep search result (when Perplexity deep search was used) */
  deepSearchResult?: DeepSearchResult;
}

export interface OrbWebResearchOptions {
  /** Default true — set to false to short-circuit the trigger. */
  enabled?: boolean;
  /** Override result count for tests. */
  maxResults?: number;
  /**
   * Output mode:
   *   - "agent" (default for planner-driven calls): emits a lean source list
   *     without numbered-step formatting instructions, so the planner stays
   *     in charge of plan.steps shape.
   *   - "qna" (legacy / Q&A reply): keeps the original "用步驟 1 / 步驟 2"
   *     format directive for educational replies that bypass the planner.
   */
  mode?: "agent" | "qna";
  /** v2: 使用者 ID（用於 per-user 節流） */
  userId?: number | null;
  /** v2: 強制使用 Perplexity 深度搜尋（由 planner 決定） */
  forceDeepSearch?: boolean;
  /** v2: 搜尋時間範圍過濾 */
  recencyFilter?: "day" | "week" | "month" | "year";
  /** v2: 是否將結果寫入學習文件中心 */
  addToLearnHub?: boolean;
}

/**
 * v2: 判斷是否為明確的搜尋意圖（最高優先級）。
 * 當使用者明確說「搜尋」「查詢」「幫我查」時，即使同時符合 IN_APP_INTENT，
 * 也應該觸發搜尋。
 */
function isExplicitSearchIntent(text: string): boolean {
  return EXPLICIT_SEARCH_PATTERNS.some((re) => re.test(text));
}

function shouldTrigger(text: string): boolean {
  if (!text) return false;
  if (text.length > MAX_RESEARCH_TEXT_LEN) return false;

  // v2: 明確搜尋意圖 → 直接觸發（跳過 IN_APP_INTENT 檢查）
  if (isExplicitSearchIntent(text)) return true;

  if (IN_APP_INTENT_PATTERNS.some((re) => re.test(text))) return false;
  return RESEARCH_PATTERNS.some((re) => re.test(text));
}

/**
 * Pure: turn a free-form user message into a focused search query that better
 * reflects the user's actual topic. We strip the appended `[使用者澄清]:`
 * suffix (used by the multi-step wizard for LLM context, not for search),
 * conversational fillers and imperative verbs, and collapse whitespace so
 * the search engine sees the topical noun phrases — fixes the "ask about
 * cat war videos, get Midjourney tutorials" mismatch.
 */
export function buildResearchQuery(text: string): string {
  if (!text) return "";
  let cleaned = text;
  for (const pattern of QUERY_FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = cleaned
    .replace(QUERY_KEEP_PUNCTUATION, " ")
    .replace(QUERY_WHITESPACE, " ")
    .trim();
  // Don't return an empty query — search engines treat "" as anything.
  // Fall back to the original trimmed text if filler-stripping ate everything.
  if (!cleaned) cleaned = text.trim();
  return cleaned.slice(0, RESEARCH_QUERY_MAX_LEN);
}

/** Pure: decide whether the latest user text warrants a web search. */
export function classifyOrbResearchIntent(text: string): {
  shouldSearch: boolean;
  isExplicitSearch: boolean;
  reason: OrbWebResearchOutcome["reason"];
} {
  if (!text || text.trim().length === 0) {
    return { shouldSearch: false, isExplicitSearch: false, reason: "skipped:empty" };
  }
  if (text.length > MAX_RESEARCH_TEXT_LEN) {
    return { shouldSearch: false, isExplicitSearch: false, reason: "skipped:too_long" };
  }

  // v2: 明確搜尋意圖 → 最高優先級
  if (isExplicitSearchIntent(text)) {
    return {
      shouldSearch: true,
      isExplicitSearch: true,
      reason: "matched:explicit_search",
    };
  }

  if (IN_APP_INTENT_PATTERNS.some((re) => re.test(text))) {
    return { shouldSearch: false, isExplicitSearch: false, reason: "skipped:in_app_intent" };
  }
  if (!RESEARCH_PATTERNS.some((re) => re.test(text))) {
    return { shouldSearch: false, isExplicitSearch: false, reason: "skipped:no_pattern" };
  }
  return { shouldSearch: true, isExplicitSearch: false, reason: "matched" };
}

/** Pure: format a list of results as a readable system-prompt block. */
export function formatResearchPromptBlock(
  results: WebResearchResult[],
  options: { mode?: "agent" | "qna" } = {}
): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const summary = (r.summary ?? "").replace(/\s+/g, " ").trim();
    const truncatedSummary =
      summary.length > 180 ? `${summary.slice(0, 179)}…` : summary;
    return `${i + 1}. ${r.title} — ${truncatedSummary}\n   ${r.url}`;
  });
  // "agent" mode: caller is the planner-driven path. Surface the sources as
  // background context only — DO NOT instruct the LLM to format the reply
  // as 步驟 1 / 步驟 2, because that conflicts with the planner's mandate
  // to either commit to decision.mode='clarification' (with structured
  // clarificationQuestion + clarificationOptions) or 'tasked' (with real
  // toolName/toolArgs). When both rules fire the LLM ends up describing a
  // pseudo-plan in chat and asking "從哪步開始？" — the empty-prompt UX bug
  // we keep stamping out.
  if (options.mode === "agent") {
    return [
      "【網路研究 / Web Research（即時抓取，僅供背景參考）】",
      "以下是即時搜到的相關來源，內容可作為你規劃 plan / 回答 clarification 時的事實參考；",
      "請只在 reply 文字裡引用 1–2 條 URL（且必須是真的對應使用者主題的來源）。",
      "不要把整個回覆寫成編號步驟的教學文 — 步驟結構由 plan.steps 決定。",
      ...lines,
    ].join("\n");
  }
  return [
    "【網路研究 / Web Research（即時抓取）】",
    "你剛剛幫使用者爬到的最新網路資料如下，請優先依這些資料回答，並在文字回覆裡引用 1–3 條 URL 作為來源。若內容互相矛盾，挑最可信的來源並標註不一致。",
    ...lines,
    "回覆規範：",
    "- 先評估每一條來源的標題／摘要是否真的對應使用者的主題；不相關的來源請直接捨棄，不要為了引用而引用 (寧可不附來源，也不要引用離題的內容)。",
    "- 用步驟 1 / 步驟 2 … 列出 3–8 個步驟。",
    "- 在最後一行附上「來源：<url1>、<url2>」讓使用者可驗證；如果沒有任何來源符合主題，這一行就省略。",
    "- 也請依「可分享的流程連結」規則，自行產生 /process?spec=… 連結。",
  ].join("\n");
}

/**
 * Run the orb-side web research stage. Always resolves; returns
 * `promptBlock=null` when the trigger doesn't fire or when search yielded
 * nothing, so the caller can simply concatenate the block to its existing
 * system prompt.
 *
 * v2: 支援 Perplexity 深度搜尋 + 強制搜尋模式
 */
export async function runOrbWebResearch(
  latestUserText: string,
  options: OrbWebResearchOptions = {}
): Promise<OrbWebResearchOutcome> {
  if (options.enabled === false) {
    return { promptBlock: null, results: [], reason: "skipped:disabled" };
  }

  // v2: 強制深度搜尋模式（由 planner 決定）
  if (options.forceDeepSearch) {
    return runDeepSearchPath(latestUserText, options);
  }

  const classification = classifyOrbResearchIntent(latestUserText);
  if (!classification.shouldSearch) {
    return { promptBlock: null, results: [], reason: classification.reason };
  }

  // v2: 明確搜尋意圖 → 優先使用 Perplexity 深度搜尋
  if (classification.isExplicitSearch) {
    const deepResult = await runDeepSearchPath(latestUserText, options);
    if (deepResult.reason !== "error" && deepResult.promptBlock) {
      return deepResult;
    }
    // 深度搜尋失敗 → fallback 到原有搜尋
  }

  const query = buildResearchQuery(latestUserText);
  if (!query) {
    return { promptBlock: null, results: [], reason: "skipped:empty" };
  }
  try {
    const results = await webSearch(
      query,
      options.maxResults ?? RESEARCH_RESULT_LIMIT
    );
    if (!Array.isArray(results) || results.length === 0) {
      return { promptBlock: null, results: [], reason: "skipped:no_results" };
    }
    return {
      promptBlock: formatResearchPromptBlock(results, { mode: options.mode }),
      results,
      reason: classification.reason,
    };
  } catch (err) {
    console.warn("[orbWebResearch] search failed:", err);
    return { promptBlock: null, results: [], reason: "error" };
  }
}

/**
 * v2: 執行 Perplexity 深度搜尋路徑。
 * 這是一個獨立的搜尋路徑，使用 perplexityDeepSearch 模組。
 */
async function runDeepSearchPath(
  latestUserText: string,
  options: OrbWebResearchOptions
): Promise<OrbWebResearchOutcome> {
  const query = buildResearchQuery(latestUserText);
  if (!query) {
    return { promptBlock: null, results: [], reason: "skipped:empty" };
  }

  try {
    const deepResult = await executeDeepSearch({
      query,
      userId: options.userId ?? null,
      recencyFilter: options.recencyFilter,
      maxResults: options.maxResults ?? RESEARCH_RESULT_LIMIT,
      addToLearnHub: options.addToLearnHub,
    });

    if (!deepResult.ok || deepResult.sources.length === 0) {
      // 深度搜尋無結果 → fallback 到原有 webSearch
      try {
        const fallbackResults = await webSearch(
          query,
          options.maxResults ?? RESEARCH_RESULT_LIMIT
        );
        if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
          return {
            promptBlock: formatResearchPromptBlock(fallbackResults, {
              mode: options.mode,
            }),
            results: fallbackResults,
            reason: "matched",
          };
        }
      } catch {
        // fallback 也失敗
      }
      return {
        promptBlock: null,
        results: [],
        reason: "skipped:no_results",
        deepSearchResult: deepResult,
      };
    }

    // 深度搜尋成功
    const promptBlock = formatDeepSearchForPrompt(
      deepResult,
      options.mode ?? "agent"
    );

    // 將 DeepSearchSource 轉為 WebResearchResult 格式（相容現有介面）
    const compatResults: WebResearchResult[] = deepResult.sources.map(
      (s, i) => ({
        id: `deep-${Date.now()}-${i}`,
        query,
        source: `Perplexity (${deepResult.provider})`,
        title: s.title,
        summary: s.snippet,
        url: s.url,
        relevance: 90 - i * 5,
        addedToLearnHub: false,
        createdAt: Date.now(),
      })
    );

    return {
      promptBlock,
      results: compatResults,
      reason: "matched:deep_search",
      deepSearchResult: deepResult,
    };
  } catch (err) {
    console.warn("[orbWebResearch] deep search failed:", err);
    return { promptBlock: null, results: [], reason: "error" };
  }
}

/**
 * v2: 公開的深度搜尋 API — 供 planner 或路由直接呼叫。
 * 不做意圖分類，直接執行搜尋。
 */
export async function runOrbDeepSearch(
  query: string,
  options: {
    userId?: number | null;
    recencyFilter?: "day" | "week" | "month" | "year";
    maxResults?: number;
    mode?: "agent" | "qna";
    addToLearnHub?: boolean;
  } = {}
): Promise<OrbWebResearchOutcome> {
  return runDeepSearchPath(query, {
    ...options,
    forceDeepSearch: true,
    enabled: true,
  });
}
