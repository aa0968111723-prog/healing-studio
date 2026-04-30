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
const RESEARCH_QUERY_MAX_LEN = 200;
const RESEARCH_RESULT_LIMIT = 4;

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
}

function shouldTrigger(text: string): boolean {
  if (!text) return false;
  if (text.length > MAX_RESEARCH_TEXT_LEN) return false;
  if (IN_APP_INTENT_PATTERNS.some(re => re.test(text))) return false;
  return RESEARCH_PATTERNS.some(re => re.test(text));
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
export function formatResearchPromptBlock(results: WebResearchResult[]): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const summary = (r.summary ?? "").replace(/\s+/g, " ").trim();
    const truncatedSummary = summary.length > 180 ? `${summary.slice(0, 179)}…` : summary;
    return `${i + 1}. ${r.title} — ${truncatedSummary}\n   ${r.url}`;
  });
  return [
    "【網路研究 / Web Research（即時抓取）】",
    "你剛剛幫使用者爬到的最新網路資料如下，請優先依這些資料回答，並在文字回覆裡引用 1–3 條 URL 作為來源。若內容互相矛盾，挑最可信的來源並標註不一致。",
    ...lines,
    "回覆規範：",
    "- 用步驟 1 / 步驟 2 … 列出 3–8 個步驟。",
    "- 在最後一行附上「來源：<url1>、<url2>」讓使用者可驗證。",
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
  const query = latestUserText.trim().slice(0, RESEARCH_QUERY_MAX_LEN);
  try {
    const results = await webSearch(query, options.maxResults ?? RESEARCH_RESULT_LIMIT);
    if (!Array.isArray(results) || results.length === 0) {
      return { promptBlock: null, results: [], reason: "skipped:no_results" };
    }
    return {
      promptBlock: formatResearchPromptBlock(results),
      results,
      reason: "matched",
    };
  } catch (err) {
    console.warn("[orbWebResearch] search failed:", err);
    return { promptBlock: null, results: [], reason: "error" };
  }
}
