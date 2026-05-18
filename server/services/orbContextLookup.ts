/**
 * orbContextLookup — proper-noun detection + context lookup decision.
 *
 * Used by the ai.chat handler to decide whether the user's prompt contains
 * domain-specific terms (school names, club names, local brands, niche
 * concepts) that the orb does not recognize and should look up BEFORE
 * planning the reply.
 *
 * Why this exists: when a user asks
 * "可以帶著我發想淡大禪學社的期末社大影片嗎？", the orb used to dive straight
 * into "what length?" without acknowledging that 淡大禪學社 is a specific
 * student club. Per the design conversation, the correct flow is:
 *   1. Recognize 淡大禪學社 is a proper noun whose context matters.
 *   2. Quick lookup to gather background.
 *   3. Reply with "I understood it's the Tamkang Zen Society's end-of-semester
 *      club video — let me clarify purpose / feel first" before any wizard
 *      dimension.
 *
 * This module owns step 1: a small LLM call returning
 *   { shouldLookup: boolean, terms: string[], rationale: string }
 *
 * Failure mode: any LLM error / timeout returns shouldLookup=false silently
 * and the caller falls through to the existing trigger flow.
 */

import { extractMessageText, invokeLLM } from "../_core/llm";

const ANALYSIS_TIMEOUT_MS = 4_000;
const MAX_TEXT_LEN = 600;
const MAX_TERMS = 3;
const MAX_TERM_LEN = 24;

// Per-conversation cache so a back-and-forth like "可以帶著我發想淡大禪學社…"
// → "想做招生宣傳" → "30 秒" doesn't re-run the LLM analysis (4s + JSON parse)
// AND the deep search (3-5s) on every follow-up. Keyed by userId + a stable
// hash of the latest user text; TTL kept short so a topic switch later in the
// same session re-triggers the analysis fresh.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;

interface CacheEntry {
  value: OrbContextLookupResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(userId: number | null | undefined, text: string): string {
  const userPart = userId == null ? "anon" : String(userId);
  return `${userPart}:${djb2(text.trim().slice(0, MAX_TEXT_LEN))}`;
}

function pruneCache(now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Hard cap (defensive): drop the oldest entries when the LRU-less map grows
  // past CACHE_MAX_ENTRIES — Map iteration order is insertion order.
  if (cache.size > CACHE_MAX_ENTRIES) {
    const overflow = cache.size - CACHE_MAX_ENTRIES;
    let dropped = 0;
    for (const key of cache.keys()) {
      if (dropped >= overflow) break;
      cache.delete(key);
      dropped += 1;
    }
  }
}

export interface OrbContextLookupResult {
  shouldLookup: boolean;
  terms: string[];
  rationale: string;
  reason:
    | "matched"
    | "skipped:empty"
    | "skipped:too_long"
    | "skipped:no_terms"
    | "error"
    | "cache_hit";
}

const SYSTEM_PROMPT = [
  "你是 AI 影片製作工作室的前置助理。判斷使用者訊息中是否含有「LLM 不大可能熟悉、補充背景能讓回覆更貼題」的專有名詞。",
  "需要標記的：",
  "- 校名/系所/社團（例：淡大禪學社、政大熱舞社）",
  "- 在地品牌、店家、活動（例：師大夜市某攤、某地方節）",
  "- 較不知名的人名、組織、節目、產品型號",
  "- 特定領域術語",
  "不要標記：",
  "- 一般詞彙（影片、海報、音樂、療癒）",
  "- 知名品牌或公眾人物（Apple、Taylor Swift）",
  "- 抽象主題（冥想、寵物、夢境）",
  "- 純粹的閒聊（你好、謝謝、好喔）",
  "",
  '回傳純 JSON：{"shouldLookup": boolean, "terms": string[], "rationale": "一句 ≤40 字中文"}',
  "- shouldLookup=true 才填 terms。",
  "- terms 最多 3 個，每個 ≤24 字，去掉「的」「之」「我們」等贅字。",
  "- rationale 簡述為什麼這幾個詞需要查（≤40 字），給下游 planner 看的。",
].join("\n");

export interface AnalyzeOrbPromptOptions {
  /** When set, the analysis result is cached per (userId, prompt hash). */
  userId?: number | null;
  /**
   * Bypass the cache when true (used by tests). Production callers should
   * leave it false so the 5-min TTL kicks in for repeat asks on the same
   * topic in the same session.
   */
  bypassCache?: boolean;
}

export async function analyzeOrbPromptForContextLookup(
  userText: string,
  options: AnalyzeOrbPromptOptions = {}
): Promise<OrbContextLookupResult> {
  const trimmed = (userText ?? "").trim();
  if (!trimmed) {
    return { shouldLookup: false, terms: [], rationale: "", reason: "skipped:empty" };
  }
  if (trimmed.length > MAX_TEXT_LEN) {
    return {
      shouldLookup: false,
      terms: [],
      rationale: "",
      reason: "skipped:too_long",
    };
  }

  const key = cacheKey(options.userId, trimmed);
  if (!options.bypassCache) {
    pruneCache();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.value, reason: "cache_hit" };
    }
  }

  try {
    const result = await invokeLLM({
      model: "gpt-4o-mini",
      temperature: 0,
      preferEngine: "auto",
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      cacheable: true,
      runName: "orb-context-lookup-detect",
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });
    const raw = extractMessageText(result.choices[0]?.message?.content).trim();
    if (!raw) {
      return { shouldLookup: false, terms: [], rationale: "", reason: "error" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { shouldLookup: false, terms: [], rationale: "", reason: "error" };
    }
    if (!parsed || typeof parsed !== "object") {
      return { shouldLookup: false, terms: [], rationale: "", reason: "error" };
    }
    const p = parsed as Record<string, unknown>;
    const shouldLookupRaw = p.shouldLookup === true;
    const termsRaw = Array.isArray(p.terms) ? p.terms : [];
    const terms = termsRaw
      .map(t => (typeof t === "string" ? t.trim() : ""))
      .filter(t => t.length > 0 && t.length <= MAX_TERM_LEN)
      .slice(0, MAX_TERMS);
    const rationale =
      typeof p.rationale === "string" ? p.rationale.trim().slice(0, 80) : "";
    const finalResult: OrbContextLookupResult =
      !shouldLookupRaw || terms.length === 0
        ? {
            shouldLookup: false,
            terms: [],
            rationale,
            reason: "skipped:no_terms",
          }
        : {
            shouldLookup: true,
            terms,
            rationale,
            reason: "matched",
          };
    cache.set(key, {
      value: finalResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return finalResult;
  } catch (err) {
    console.warn("[orbContextLookup] analysis failed:", err);
    return { shouldLookup: false, terms: [], rationale: "", reason: "error" };
  }
}

/** Test-only: clear the in-memory cache between runs. */
export function __unsafe_resetOrbContextLookupCache(): void {
  cache.clear();
}
