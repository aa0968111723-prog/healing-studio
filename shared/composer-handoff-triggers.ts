/**
 * shared/composer-handoff-triggers.ts
 *
 * 編編 (composer) 的「主動交棒觸發器」— 在實際 dispatch 之前或之後，
 * 從 (userText, parsedActions, snapshot) 推斷該不該叫其他精靈來幫忙，
 * 並回傳一份具體的 handoff 建議（暱稱 + 一句話 reason）。
 *
 * 設計：
 *   - 純函式 (沒有 I/O、沒有 React、沒有 trpc)
 *   - 每條 trigger 是一個 predicate；命中時產出一條 `ComposerHandoffSuggestion`
 *   - 多條同時命中 → 全部回傳，按 priority 排好；caller 自己取前 N 條 render
 *
 * 跟既有 SPIRIT_COLLAB_PROTOCOL.composer.handoffs 的差別：
 *   - protocol.handoffs 是「編編做完之後 預設可以接給誰」的靜態 list；
 *     UI 用來 render 一排 chip。
 *   - 這裡是 **動態 trigger**：依當下使用者輸入 / parser 結果決定要不要
 *     主動冒出「@巧巧 你的 prompt 太短，要幫你寫一版嗎？」這種預判。
 *
 * Pure / sync. Safe to import from both client and server.
 */

import type {
  AgentAction,
  PageAgentSnapshot,
} from "./agent-actions";
import type { AgentRole } from "./orb-agent-roles";
import type { ComposerParseResult } from "./composer-imperative-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Priority — higher fires first; tie-breaks left to declaration order. */
export type HandoffPriority = "high" | "medium" | "low";

export interface ComposerHandoffSuggestion {
  /** Which spirit to invite */
  spirit: AgentRole;
  /** Short one-line reason — used as the chip label */
  reason: string;
  /** Free-form rationale (for telemetry / debug) */
  rationale: string;
  /** Higher fires first */
  priority: HandoffPriority;
  /** Trigger id — stable string for tests / analytics */
  triggerId: string;
}

export interface ComposerTriggerContext {
  /** Raw user message (after stripSpiritMention) */
  userText: string;
  /** Parser output (may be empty) */
  parsed: ComposerParseResult;
  /** Current page snapshot — may be null if not on a studio page */
  snapshot: PageAgentSnapshot | null;
  /** Did dispatch already happen this turn? (used for post-dispatch triggers) */
  postDispatch?: boolean;
  /** Result of the dispatch, if it ran */
  dispatchFailed?: boolean;
}

// ─── Triggers ──────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<HandoffPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * @巧巧 — when the user's prompt is suspicious / too short / too vague.
 * Catches the most common "編編 dispatch 出去的圖糊掉" case before submit.
 */
function triggerShortPrompt(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  // Only relevant when there's actually a fillPrompt action OR when the
  // page already has a (too-short) prompt and the user is trying to submit.
  const fillAction = ctx.parsed.actions.find(a => a.type === "fillPrompt");
  const promptText = fillAction?.type === "fillPrompt"
    ? fillAction.text
    : (ctx.snapshot?.currentPrompt ?? "");

  const trimmed = promptText.trim();
  if (trimmed.length === 0) return null; // covered by missing.prompt
  if (trimmed.length >= 12) return null; // long enough

  return {
    spirit: "quality-coach",
    reason: "提示詞太短，要請巧巧幫你寫得更具體嗎？",
    rationale: `prompt length ${trimmed.length} < 12 chars`,
    priority: "high",
    triggerId: "short_prompt",
  };
}

/**
 * @財財 — when the selected model is on the expensive shortlist OR
 * the user wants a long video on a premium model. Catches the
 * "I just blew through monthly quota" scenario before submit.
 */
const EXPENSIVE_MODEL_IDS = new Set<string>([
  "fal-ai/flux-pro/v1.1",
  "fal-ai/kling-video/v2.1/pro/image-to-video",
  "fal-ai/runway-gen4-turbo/image-to-video",
  "fal-ai/imagen4/preview",
]);

function triggerExpensiveOp(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  const setModelAction = ctx.parsed.actions.find(a => a.type === "setModel");
  const submitAction = ctx.parsed.actions.find(a => a.type === "submit");
  if (!submitAction) return null; // only worth warning before actual submit

  const targetModel =
    setModelAction?.type === "setModel"
      ? setModelAction.modelId
      : (ctx.snapshot?.activeModel ?? "");
  if (!targetModel) return null;
  if (!EXPENSIVE_MODEL_IDS.has(targetModel)) return null;

  // For video, also check if duration > 5s (cost scales with duration)
  const durationAction = ctx.parsed.actions.find(
    a => a.type === "setParam" && a.key === "durationSec",
  );
  const duration =
    durationAction?.type === "setParam" && typeof durationAction.value === "number"
      ? durationAction.value
      : null;
  const isLongVideo = duration !== null && duration > 5;

  return {
    spirit: "accountant",
    reason: isLongVideo
      ? "這個模型 + 長度會花不少點數，要請財財估一下嗎？"
      : "用付費首選方案，先讓財財估算成本？",
    rationale: `expensive model ${targetModel}${isLongVideo ? ` + ${duration}s` : ""}`,
    priority: isLongVideo ? "high" : "medium",
    triggerId: "expensive_op",
  };
}

/**
 * @律律 — when the prompt mentions IP / celebrities / trademarks.
 * Hands off BEFORE submit so we don't waste a generation on something
 * we'll just have to redo anyway.
 */
const IP_RISK_PATTERNS: RegExp[] = [
  /迪士尼|disney/i,
  /漫威|marvel/i,
  /神奇寶貝|寶可夢|pok[eé]mon/i,
  /哈利波特|harry\s*potter/i,
  /星際大戰|star\s*wars/i,
  /蜘蛛人|spider[- ]man/i,
  // celebrities — keep this list short; precise detection is a separate task
  /trump|biden|musk|swift/i,
  /(?:^|[^a-zA-Z])(?:nike|adidas|apple|google|coca[ -]cola|pepsi)(?:$|[^a-zA-Z])/i,
];

function triggerIpRisk(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  const fillAction = ctx.parsed.actions.find(a => a.type === "fillPrompt");
  const text = [
    ctx.userText,
    fillAction?.type === "fillPrompt" ? fillAction.text : "",
    ctx.snapshot?.currentPrompt ?? "",
  ].join(" ");

  const matched = IP_RISK_PATTERNS.some(re => re.test(text));
  if (!matched) return null;

  return {
    spirit: "legal-advisor",
    reason: "提示詞含 IP / 名人 / 品牌名，請律律檢查再送出？",
    rationale: "ip risk pattern matched",
    priority: "high",
    triggerId: "ip_risk",
  };
}

/**
 * @守守 — when dispatch failed mid-turn. Lets 守守 surface workarounds.
 * Post-dispatch trigger only.
 */
function triggerDispatchFailure(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  if (!ctx.postDispatch || !ctx.dispatchFailed) return null;
  return {
    spirit: "inspector",
    reason: "頁面 dispatch 沒成功，要請守守看一下狀況嗎？",
    rationale: "dispatch failed during composer page-execution",
    priority: "high",
    triggerId: "dispatch_failure",
  };
}

/**
 * @品品 — after a successful submit, suggest critic review. Light-touch,
 * priority low — should NOT compete with handoffs that ask before submit.
 */
function triggerPostSubmitCritique(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  if (!ctx.postDispatch || ctx.dispatchFailed) return null;
  const hasSubmit = ctx.parsed.actions.some(a => a.type === "submit");
  if (!hasSubmit) return null;
  return {
    spirit: "critic",
    reason: "完成了！要請品品挑 1-3 個改進點嗎？",
    rationale: "post-submit critique suggestion",
    priority: "low",
    triggerId: "post_submit_critic",
  };
}

/**
 * @影影 — when user just rendered an image and naturally wants animation.
 * Heuristic: image-studio + submit just happened + userText mentions
 * "動畫 / animate / 動起來 / 影片".
 */
function triggerAnimateFollowup(ctx: ComposerTriggerContext): ComposerHandoffSuggestion | null {
  if (!ctx.postDispatch || ctx.dispatchFailed) return null;
  const onImageStudio = ctx.snapshot?.pagePath === "/image-studio";
  if (!onImageStudio) return null;
  const wantsAnimation = /動畫|動起來|animate|影片|video/i.test(ctx.userText);
  if (!wantsAnimation) return null;
  return {
    spirit: "video-specialist",
    reason: "圖完成後，要不要接影影做動畫版？",
    rationale: "image-studio + animation keyword in user text",
    priority: "medium",
    triggerId: "animate_followup",
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

const TRIGGERS: Array<(ctx: ComposerTriggerContext) => ComposerHandoffSuggestion | null> = [
  triggerIpRisk,        // safety-critical, before everything
  triggerShortPrompt,   // quality-critical, before submit
  triggerExpensiveOp,   // cost-critical, before submit
  triggerDispatchFailure, // recovery, after failed dispatch
  triggerAnimateFollowup, // follow-up, after success
  triggerPostSubmitCritique, // light-touch follow-up, after success
];

/**
 * Run every trigger and return the suggestions in priority order.
 * Caller decides how many to render (typically 1-3 as chat suggestion chips).
 */
export function getComposerHandoffSuggestions(
  ctx: ComposerTriggerContext,
): ComposerHandoffSuggestion[] {
  const hits: ComposerHandoffSuggestion[] = [];
  for (const trigger of TRIGGERS) {
    const hit = trigger(ctx);
    if (hit) hits.push(hit);
  }
  // Sort by priority desc; preserve declaration order for ties.
  hits.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  return hits;
}

/**
 * Convenience: pick the single most important suggestion (or null).
 * Used for inline "編編 主動建議" surfaces that can only show one.
 */
export function pickPrimaryComposerHandoff(
  ctx: ComposerTriggerContext,
): ComposerHandoffSuggestion | null {
  const all = getComposerHandoffSuggestions(ctx);
  return all.length > 0 ? all[0] : null;
}
