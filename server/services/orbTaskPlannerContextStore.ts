/**
 * orbTaskPlannerContextStore.ts — short-lived per-task planner inputs.
 *
 * The chain runner (orbTaskChainRunner) needs to call the planner AGAIN
 * when the post-mortem observer says "continue", so it can ask for a
 * recovery / next-step plan grounded in the original conversation.
 * `driveOrbTaskInBackground` only receives `{taskId, userId, userRole}`
 * — none of the planner inputs (messages, page snapshot, preferences …)
 * are in scope.
 *
 * Rather than thread those inputs through 5 call sites, the brain
 * router stashes them here right after creating a task; the chain
 * runner reads them when it needs to replan; the entry is dropped once
 * the chain ends or after a TTL.
 *
 * In-memory only. If the process restarts mid-task the context is lost,
 * which is fine — the chain runner's "no_continuation_context" exit path
 * just surfaces the post-mortem observation to the user instead of
 * silently auto-continuing.
 */

import type { Message } from "../_core/llm";
import type {
  AgentFeedbackEvent,
  PageAgentSnapshot,
} from "../../shared/agent-actions";
import type { AgentPlannerInput } from "./agentPlanner";

export interface StoredOrbTaskPlannerContext {
  userId: number;
  userRole: string;
  /** Messages used to make the original plan. The chain runner appends a
   *  synthetic user message describing the previous attempt before re-invoking
   *  the planner. */
  messages: Message[];
  context?: string;
  personality?: string;
  pageSnapshot?: PageAgentSnapshot | null;
  recentFeedback?: AgentFeedbackEvent[];
  recentTaskMemorySummary?: string;
  recentOrbMemorySummary?: string;
  siteKnowledgeSummary?: string;
  preferences?: AgentPlannerInput["preferences"];
  storedAt: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes — same window as orbTaskStore TTL
const store = new Map<string, StoredOrbTaskPlannerContext>();

function cleanup(now: number) {
  // Avoid `for…of` over a Map so we don't depend on tsconfig downlevelIteration.
  store.forEach((ctx, taskId) => {
    if (now - ctx.storedAt > TTL_MS) {
      store.delete(taskId);
    }
  });
}

export function setOrbTaskPlannerContext(
  taskId: string,
  ctx: Omit<StoredOrbTaskPlannerContext, "storedAt">
): void {
  const now = Date.now();
  cleanup(now);
  store.set(taskId, { ...ctx, storedAt: now });
}

export function getOrbTaskPlannerContext(
  taskId: string
): StoredOrbTaskPlannerContext | null {
  cleanup(Date.now());
  return store.get(taskId) ?? null;
}

export function deleteOrbTaskPlannerContext(taskId: string): void {
  store.delete(taskId);
}

/** Test-only — clear the entire store between unit tests. */
export function _resetOrbTaskPlannerContextStoreForTests(): void {
  store.clear();
}
