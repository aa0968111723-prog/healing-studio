/**
 * shared/composer-agent-loop.ts
 *
 * 編編 (composer) 的 **agent loop** — observe → think → act → verify → recover。
 *
 * 設計動機：
 *   parser + chat shortcut + handoff triggers 解決了「單一輪」的執行；
 *   但真正的 agent 行為需要「多輪記憶」：
 *     - 上一輪 dispatch 了什麼？
 *     - perception verdict 是什麼？
 *     - 如果使用者只說「再試一次」/「改便宜的」/「不行」，我要拿出上一輪
 *       的 action plan 重跑、降級、或交棒，而不是當作全新訊息重新解析。
 *
 * 這份模組提供：
 *   - ComposerAgentState — 純資料 (沒有 React)；caller 持有 ref/state
 *   - 三個 pure 函式：
 *       1. captureTurn  — 寫入當前 turn 的 (actions, verdict, ctx)
 *       2. planContinuation — 拿 user 一句新訊息，判斷是「retry / cheaper /
 *         escalate / new」並產出對應 plan
 *       3. summarizeForPrompt — 給 LLM fallback 看的「過去 N 輪做了什麼」摘要
 *
 * 跟既有 orb-task-state-machine.ts 的差別：
 *   - orb-task-state-machine.ts 是「workflow / task 的生命週期」(planning →
 *     awaiting_approval → executing …)，由 orbTaskOrchestrator 驅動，
 *     寫進 DB，是 long-lived 任務狀態。
 *   - 這份是「composer 在 chat 對話框內的 in-memory 短期記憶」，最多保留
 *     最近 6 輪，沒寫 DB，給聊天 UX 用。兩者互不相干 — composer 可以也
 *     可以不對應到任何 task。
 *
 * Pure / sync. Safe to import from both client and server.
 */

import type {
  AgentAction,
  PageAgentSnapshot,
} from "./agent-actions";
import type { PerceptionVerdict } from "./orb-perception-loop";
import type { AgentRole } from "./orb-agent-roles";

// ─── State ──────────────────────────────────────────────────────────────────

export interface ComposerTurnRecord {
  /** Timestamp the turn started (ms-since-epoch) */
  startedAt: number;
  /** User's raw message that triggered the turn */
  userText: string;
  /** Page snapshot at the time we parsed (may be null if not on studio) */
  snapshotPath: string | null;
  /** Actions composer dispatched this turn — empty if all fell through to LLM */
  actions: AgentAction[];
  /** Did dispatch succeed (ok across all actions)? null when never ran. */
  dispatchOk: boolean | null;
  /** Perception verdicts per-action when available */
  verdicts: PerceptionVerdict[];
  /** Whether this turn was actually a retry/continuation of a prior turn */
  continuationOf?: number; // index into history
}

export interface ComposerAgentState {
  /** Most-recent first. Capped at MAX_TURNS. */
  history: ComposerTurnRecord[];
  /** Last suggested handoff target — used to suppress duplicates */
  lastHandoffTo?: AgentRole;
}

export const MAX_TURNS = 6;

export function createComposerAgentState(): ComposerAgentState {
  return { history: [] };
}

export function captureTurn(
  state: ComposerAgentState,
  record: ComposerTurnRecord,
): ComposerAgentState {
  const next = [record, ...state.history].slice(0, MAX_TURNS);
  return { ...state, history: next };
}

export function rememberHandoff(
  state: ComposerAgentState,
  to: AgentRole,
): ComposerAgentState {
  return { ...state, lastHandoffTo: to };
}

// ─── Continuation planning ──────────────────────────────────────────────────

export type ContinuationKind =
  /** A bare retry of the previous turn's actions */
  | "retry"
  /** Same intent, but ask for a cheaper model (e.g. flux pro → schnell) */
  | "cheaper"
  /** User says "this isn't right" → escalate to critic/quality-coach */
  | "escalate"
  /** No prior context to lean on / message is a new intent */
  | "new";

export interface ContinuationPlan {
  kind: ContinuationKind;
  /** When kind != "new": the actions to dispatch (may be mutated copies) */
  actions: AgentAction[];
  /** Human-readable rationale for chat surface */
  rationale: string;
  /** When `kind === "escalate"`, the suggested target spirit */
  escalateTo?: AgentRole;
}

const RETRY_PATTERNS: RegExp[] = [
  /^再試一次$/,
  /^再來一(?:張|次|個)?$/,
  /^再生(?:成|一個|一張|一次)?$/,
  /^retry$/i,
  /^try again$/i,
];

const CHEAPER_PATTERNS: RegExp[] = [
  /便宜|省一?點|省點|降級|更省|cheaper|draft|快草稿/i,
];

const ESCALATE_PATTERNS: RegExp[] = [
  /不行|不對|不滿意|爛|糟|這個不好|這張很糊|失敗|沒fu/i,
  /not good|bad|wrong|terrible|sucks/i,
];

/** Map an expensive model id to a cheaper alternative for the same modality. */
const CHEAPER_FALLBACK: Record<string, string> = {
  "fal-ai/flux-pro/v1.1":                        "fal-ai/flux/schnell",
  "fal-ai/imagen4/preview":                       "fal-ai/flux/schnell",
  "fal-ai/kling-video/v2.1/pro/image-to-video":   "fal-ai/wan-i2v",
  "fal-ai/runway-gen4-turbo/image-to-video":      "fal-ai/wan-i2v",
  "fal-ai/pixverse/v4.5/image-to-video":          "fal-ai/wan-i2v",
};

/**
 * Replace any setModel actions with a cheaper alternative. Returns the
 * resulting actions and the chosen substitute (or null if there was no
 * setModel to swap).
 */
function applyCheaperFallback(
  actions: AgentAction[],
): { actions: AgentAction[]; switched: string | null } {
  let switched: string | null = null;
  const out = actions.map(a => {
    if (a.type !== "setModel") return a;
    const cheaper = CHEAPER_FALLBACK[a.modelId];
    if (!cheaper) return a;
    switched = cheaper;
    return { ...a, modelId: cheaper };
  });
  return { actions: out, switched };
}

/**
 * Decide what to do with the user's new message given prior composer
 * history. Pure function.
 *
 * - If history is empty → "new"
 * - If user matches a retry/cheaper/escalate pattern AND the previous turn
 *   actually dispatched something → produce a continuation plan
 * - Otherwise → "new"
 */
export function planContinuation(
  state: ComposerAgentState,
  userText: string,
): ContinuationPlan {
  const trimmed = userText.trim();
  const lastTurn = state.history[0];
  const hasPriorActions = !!lastTurn && lastTurn.actions.length > 0;

  if (!hasPriorActions || trimmed.length === 0) {
    return { kind: "new", actions: [], rationale: "no prior turn to continue" };
  }

  if (RETRY_PATTERNS.some(re => re.test(trimmed))) {
    return {
      kind: "retry",
      // Clone the action list so caller can't accidentally mutate history.
      actions: lastTurn.actions.map(a => ({ ...a })),
      rationale: "user asked to retry",
    };
  }

  if (CHEAPER_PATTERNS.some(re => re.test(trimmed))) {
    const { actions, switched } = applyCheaperFallback(lastTurn.actions);
    if (switched) {
      return {
        kind: "cheaper",
        actions,
        rationale: `swap to cheaper model: ${switched}`,
      };
    }
    // No expensive model to swap → fall through to "new"
  }

  if (ESCALATE_PATTERNS.some(re => re.test(trimmed))) {
    return {
      kind: "escalate",
      actions: [],
      rationale: "user signalled the previous output wasn't good",
      escalateTo: "quality-coach",
    };
  }

  return { kind: "new", actions: [], rationale: "no continuation pattern matched" };
}

// ─── LLM-facing summary ─────────────────────────────────────────────────────

/**
 * Render the recent N turns as a short paragraph the LLM can use as
 * context when 編編 falls through to llm-persona. Truncated to ~400 chars
 * to fit a system-prompt slice.
 */
export function summarizeForPrompt(
  state: ComposerAgentState,
  turns: number = 3,
): string {
  if (state.history.length === 0) return "";
  const slice = state.history.slice(0, turns);
  const lines: string[] = ["【編編最近的 turn 摘要】"];
  for (const [i, t] of slice.entries()) {
    const types = t.actions.map(a => a.type).join("→") || "(無 action)";
    const ok = t.dispatchOk === null ? "?" : t.dispatchOk ? "ok" : "fail";
    const verdictReason = t.verdicts[0]?.reason ?? "";
    const verdictTail = verdictReason ? ` / ${verdictReason.slice(0, 40)}` : "";
    const tail = `${types} [${ok}]${verdictTail}`;
    lines.push(`- T-${i} 「${t.userText.slice(0, 30)}」 → ${tail}`);
  }
  return lines.join("\n").slice(0, 400);
}

// ─── Recovery from verdicts ─────────────────────────────────────────────────

export type RecoveryDecision =
  /** Verdict says proceed — nothing to do */
  | { kind: "noop"; reason: string }
  /** Auto-retry once with the same plan */
  | { kind: "auto-retry"; reason: string }
  /** Surface a suggestion chip — user picks */
  | { kind: "ask-user"; reason: string; chips: string[] }
  /** Hand off to inspector / quality-coach / etc */
  | { kind: "escalate"; reason: string; to: AgentRole };

/**
 * Look at the perception verdict from the just-finished turn and decide
 * what 編編 should do NEXT. Caller bridges this into the chat surface.
 *
 *   - succeeded / unknown → noop
 *   - retry once (transient no-effect) → auto-retry
 *   - replan → ask the user with concrete chips
 *   - abort (dispatch fail) → escalate to inspector
 */
export function decideRecovery(
  verdict: PerceptionVerdict | null | undefined,
  attempt: number,
): RecoveryDecision {
  if (!verdict || verdict.outcome === "succeeded" || verdict.outcome === "unknown") {
    return { kind: "noop", reason: "verdict says proceed" };
  }
  if (verdict.recommendation === "retry" && attempt < 1) {
    return { kind: "auto-retry", reason: verdict.reason };
  }
  if (verdict.recommendation === "replan") {
    return {
      kind: "ask-user",
      reason: verdict.reason,
      chips: [
        "@編編 換個模型再試一次",
        "@巧巧 幫我改寫提示詞",
        "@守守 看一下哪裡卡住",
      ],
    };
  }
  if (verdict.recommendation === "abort") {
    return { kind: "escalate", reason: verdict.reason, to: "inspector" };
  }
  return { kind: "noop", reason: "verdict matched no recovery branch" };
}
