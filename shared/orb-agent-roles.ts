/**
 * shared/orb-agent-roles.ts
 *
 * Multi-agent role routing. The orb is one user-facing assistant but
 * internally it plays distinct roles depending on the request — director
 * for planning, composer for execution, critic for review, researcher for
 * gathering info, navigator for taking the user somewhere. This module
 * centralises the routing logic so the chat router and planner can ask
 * "which role is in charge of this turn?" instead of duplicating
 * keyword heuristics.
 *
 * Pure / sync; no I/O. The actual prompt slices are short on purpose —
 * the full personality + site knowledge already exists in
 * `siteKnowledge.buildOrbSystemPrompt`. These slices just steer that
 * prompt for the current turn.
 */
import type { PageAgentSnapshot } from "./agent-actions";

export type AgentRole =
  | "director"   // multi-step planning across pages
  | "composer"   // execution / dispatch on a single page
  | "critic"     // review user's plan / output, suggest improvements
  | "researcher" // search docs / web / asset library before acting
  | "navigator"  // just take the user somewhere, no execution
  | "companion"; // open conversation, no goal yet

export interface RoleSelectionInput {
  /** User's most recent utterance, lower-cased before matching. */
  text: string;
  /** Current page snapshot, when available — narrows composer detection. */
  snapshot?: PageAgentSnapshot | null;
  /** Conversation length in turns; >0 means we're not in a cold-start. */
  turnCount?: number;
}

export interface RoleSelection {
  role: AgentRole;
  /** Confidence in the selection (0..1). */
  confidence: number;
  /** Why we picked this role — useful for telemetry + LLM prompts. */
  rationale: string;
}

const KEYWORD_RULES: Array<{
  role: AgentRole;
  keywords: readonly string[];
  rationale: string;
}> = [
  // Director: explicit multi-step / cross-page workflow asks.
  {
    role: "director",
    keywords: [
      "規劃",
      "計畫",
      "工作流",
      "拼起來",
      "整個流程",
      "多步驟",
      "從頭到尾",
      "幫我做一支",
      "幫我做一首",
      "幫我做一張",
      "拆成步驟",
      "plan",
      "workflow",
      "pipeline",
      "story arc",
      "end-to-end",
    ],
    rationale: "user asked for multi-step / cross-page planning",
  },
  // Researcher: gather / look-up before acting.
  {
    role: "researcher",
    keywords: [
      "查",
      "搜尋",
      "找一下",
      "資料",
      "參考",
      "比較",
      "差別",
      "推薦哪個",
      "推薦哪幾個",
      "差在哪",
      "search",
      "look up",
      "compare",
      "what's the difference",
      "research",
    ],
    rationale: "user wants to look up / compare before deciding",
  },
  // Critic: review / improve / fix-up.
  {
    role: "critic",
    keywords: [
      "幫我改",
      "幫我修",
      "怎麼改",
      "改進",
      "優化",
      "再好一點",
      "review",
      "critique",
      "improve",
      "polish",
      "refine",
      "fix this",
    ],
    rationale: "user wants the orb to review / refine existing work",
  },
  // Navigator: take me somewhere.
  {
    role: "navigator",
    keywords: [
      "帶我去",
      "去到",
      "跳到",
      "幫我打開",
      "幫我找到",
      "in哪裡",
      "在哪裡",
      "從哪裡",
      "open",
      "go to",
      "take me to",
      "navigate to",
    ],
    rationale: "user wants to be taken to a specific page",
  },
];

const COMPOSER_ON_STUDIO_HINTS = [
  "生成",
  "送出",
  "做這張",
  "做這個",
  "再來一張",
  "下一張",
  "再生成",
  "submit",
  "generate",
  "render",
];

function lowerOnce(s: string): string {
  return (s ?? "").toLowerCase();
}

function matchesAny(haystack: string, keywords: readonly string[]): boolean {
  for (const k of keywords) {
    if (haystack.includes(k.toLowerCase())) return true;
  }
  return false;
}

/**
 * Pick the most-likely role for the current turn. Order of precedence:
 *   1. director  — explicit multi-step / cross-page intent
 *   2. researcher — explicit lookup / compare intent
 *   3. critic    — explicit review / refine intent
 *   4. navigator — explicit "take me to X" intent
 *   5. composer  — short message + on a studio page that supports execution
 *   6. companion — fallback, open conversation
 *
 * Confidence reflects how strong the keyword evidence is; the chat router
 * can fold this into its decision to actually invoke the role's prompt
 * slice (e.g., only switch when confidence > 0.5).
 */
export function selectRoleForIntent(input: RoleSelectionInput): RoleSelection {
  const text = lowerOnce(input.text);
  if (!text.trim()) {
    return {
      role: "companion",
      confidence: 0.2,
      rationale: "empty utterance — fall back to companion",
    };
  }

  for (const rule of KEYWORD_RULES) {
    if (matchesAny(text, rule.keywords)) {
      return { role: rule.role, confidence: 0.85, rationale: rule.rationale };
    }
  }

  // Composer: short imperative + we're already on a studio page.
  const onStudioPage =
    !!input.snapshot && /studio|director|focus-flow/.test(input.snapshot.pagePath);
  if (onStudioPage && text.length < 40 && matchesAny(text, COMPOSER_ON_STUDIO_HINTS)) {
    return {
      role: "composer",
      confidence: 0.7,
      rationale: "short imperative on a studio page → execute, don't re-plan",
    };
  }

  // Long message + studio page → composer with lower confidence; the
  // user is likely describing what to fill in.
  if (onStudioPage && text.length >= 40 && text.length <= 240) {
    return {
      role: "composer",
      confidence: 0.55,
      rationale: "concrete, on-page request → execute on the current studio",
    };
  }

  return {
    role: "companion",
    confidence: 0.3,
    rationale: "no explicit signal; default to open conversation",
  };
}

/**
 * Returns the system-prompt slice for a role. Caller appends this AFTER
 * the personality block so the role guidance overrides nothing but
 * narrows behaviour for THIS turn.
 */
export function getRoleSystemPromptSlice(role: AgentRole): string {
  switch (role) {
    case "director":
      return [
        "【本回合扮演：導演 (director)】",
        "這一回合你是規劃者：把使用者需求拆成跨頁面的工作流程，每步說明「為什麼這樣選」與「下一步」。",
        "優先輸出 runWorkflow，每個 step 都要可執行（toolName 或非 navigate 的 UI 動作）；不要只下「導向某頁」。",
      ].join("\n");
    case "composer":
      return [
        "【本回合扮演：作曲家 (composer)】",
        "使用者已經在工作室裡；你只負責執行：在當頁填提示詞、設參數、按送出。",
        "不要重新規劃跨頁流程，也不要把使用者帶離當前頁面，除非他明確要求。",
      ].join("\n");
    case "critic":
      return [
        "【本回合扮演：評論者 (critic)】",
        "使用者要你檢視現有作品或計畫；先點出 1-3 個具體可改進的地方，再給可選的修改路徑。",
        "保持溫和、邀請式語氣，不要列一長串硬性建議。",
      ].join("\n");
    case "researcher":
      return [
        "【本回合扮演：研究員 (researcher)】",
        "使用者想先比較或查資料再決定；先彙整事實（模型、價位、差別），再附上 1-2 個推薦選項。",
        "不要直接執行動作；研究完讓使用者自己選下一步。",
      ].join("\n");
    case "navigator":
      return [
        "【本回合扮演：導航 (navigator)】",
        "使用者只想被帶到某個頁面；用一個 navigate 動作完成，並用 1 句話說「到了之後可以做什麼」。",
        "不要展開跨頁工作流。",
      ].join("\n");
    case "companion":
      return [
        "【本回合扮演：陪伴 (companion)】",
        "對話開放，沒有明確目標；保持輕鬆對話，必要時輕聲提供 1-2 個下一步選項。",
        "不要主動執行動作；先問清意圖。",
      ].join("\n");
  }
}

/**
 * For multi-step intents, return the sequence of roles the orb should
 * play in order. Used by chat routers that surface "我接下來會這樣陪你"
 * preview cards — purely advisory; the actual planner still owns step
 * generation.
 */
export function composeRoleChain(input: RoleSelectionInput): AgentRole[] {
  const head = selectRoleForIntent(input);
  switch (head.role) {
    case "director":
      // Director typically delegates to composer once each downstream
      // page is reached; critic optionally reviews before final ship.
      return ["director", "composer", "critic"];
    case "researcher":
      return ["researcher", "director", "composer"];
    case "critic":
      return ["critic", "composer"];
    case "navigator":
      return ["navigator"];
    case "composer":
      return ["composer"];
    case "companion":
      return ["companion"];
  }
}

/** Render a role chain into a 1-2 sentence preview for the orb's reply. */
export function summarizeRoleChainForPrompt(chain: AgentRole[]): string {
  if (chain.length === 0) return "";
  const labels: Record<AgentRole, string> = {
    director: "導演",
    composer: "作曲家",
    critic: "評論者",
    researcher: "研究員",
    navigator: "導航",
    companion: "陪伴",
  };
  if (chain.length === 1) return `【角色】${labels[chain[0]]}`;
  return `【角色鏈】${chain.map(r => labels[r]).join(" → ")}`;
}
