/**
 * server/services/orbWebResearch.ts
 *
 * Lightweight wrapper around `webSearch` (Brave + GitHub fallback) used by the
 * `ai.chat` route to enrich the orb's reply with real, citable web results
 * when the user asks a research-style question.
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

/**
 * Patterns that indicate the user is asking for an externally-researchable
 * topic rather than driving an in-app action. We only trigger web research
 * when one of these matches AND the message is short enough that we're
 * confident it's a question (very long messages are usually scripts /
 * prompts the user wants the orb to act on, not research).
 */
const RESEARCH_PATTERNS: RegExp[] = [
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
];

/**
 * Negative patterns — if the user is clearly asking the orb to perform an
 * in-app action ("帶我去 …", "幫我生成 …"), we skip research even when
 * RESEARCH_PATTERNS would otherwise match.
 */
const IN_APP_INTENT_PATTERNS: RegExp[] = [
  /帶我去|幫我去|前往|跳到|切到|打開/,
  /幫我[生產做]/,
  /\bnavigate\b|\bgo\s+to\b/i,
];

const MAX_RESEARCH_TEXT_LEN = 220;
const RESEARCH_QUERY_MAX_LEN = 120;
const RESEARCH_RESULT_LIMIT = 4;

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
    | "skipped:disabled"
    | "skipped:empty"
    | "skipped:too_long"
    | "skipped:in_app_intent"
    | "skipped:no_pattern"
    | "skipped:no_results"
    | "error";
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
}

function shouldTrigger(text: string): boolean {
  if (!text) return false;
  if (text.length > MAX_RESEARCH_TEXT_LEN) return false;
  if (IN_APP_INTENT_PATTERNS.some(re => re.test(text))) return false;
  return RESEARCH_PATTERNS.some(re => re.test(text));
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
  reason: OrbWebResearchOutcome["reason"];
} {
  if (!text || text.trim().length === 0) {
    return { shouldSearch: false, reason: "skipped:empty" };
  }
  if (text.length > MAX_RESEARCH_TEXT_LEN) {
    return { shouldSearch: false, reason: "skipped:too_long" };
  }
  if (IN_APP_INTENT_PATTERNS.some(re => re.test(text))) {
    return { shouldSearch: false, reason: "skipped:in_app_intent" };
  }
  if (!RESEARCH_PATTERNS.some(re => re.test(text))) {
    return { shouldSearch: false, reason: "skipped:no_pattern" };
  }
  return { shouldSearch: true, reason: "matched" };
}

/** Pure: format a list of results as a readable system-prompt block. */
export function formatResearchPromptBlock(
  results: WebResearchResult[],
  options: { mode?: "agent" | "qna" } = {}
): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const summary = (r.summary ?? "").replace(/\s+/g, " ").trim();
    const truncatedSummary = summary.length > 180 ? `${summary.slice(0, 179)}…` : summary;
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
 */
export async function runOrbWebResearch(
  latestUserText: string,
  options: OrbWebResearchOptions = {}
): Promise<OrbWebResearchOutcome> {
  if (options.enabled === false) {
    return { promptBlock: null, results: [], reason: "skipped:disabled" };
  }
  const classification = classifyOrbResearchIntent(latestUserText);
  if (!classification.shouldSearch) {
    return { promptBlock: null, results: [], reason: classification.reason };
  }
  const query = buildResearchQuery(latestUserText);
  if (!query) {
    return { promptBlock: null, results: [], reason: "skipped:empty" };
  }
  try {
    const results = await webSearch(query, options.maxResults ?? RESEARCH_RESULT_LIMIT);
    if (!Array.isArray(results) || results.length === 0) {
      return { promptBlock: null, results: [], reason: "skipped:no_results" };
    }
    return {
      promptBlock: formatResearchPromptBlock(results, { mode: options.mode }),
      results,
      reason: "matched",
    };
  } catch (err) {
    console.warn("[orbWebResearch] search failed:", err);
    return { promptBlock: null, results: [], reason: "error" };
  }
}
