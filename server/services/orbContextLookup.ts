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

export interface OrbContextLookupResult {
  shouldLookup: boolean;
  terms: string[];
  rationale: string;
  reason:
    | "matched"
    | "skipped:empty"
    | "skipped:too_long"
    | "skipped:no_terms"
    | "error";
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

export async function analyzeOrbPromptForContextLookup(
  userText: string
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
    if (!shouldLookupRaw || terms.length === 0) {
      return {
        shouldLookup: false,
        terms: [],
        rationale,
        reason: "skipped:no_terms",
      };
    }
    return {
      shouldLookup: true,
      terms,
      rationale,
      reason: "matched",
    };
  } catch (err) {
    console.warn("[orbContextLookup] analysis failed:", err);
    return { shouldLookup: false, terms: [], rationale: "", reason: "error" };
  }
}
