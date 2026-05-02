/**
 * shared/workflow-run-state.ts
 *
 * Snapshot of a runWorkflow execution that the orchestrator can persist
 * after every step and reload to resume. Long workflows (>3 steps that
 * span navigates, generations, and approvals) frequently outlive the
 * browser tab they were started in — losing the entire run because step 7
 * crashed is unacceptable when steps 1-6 already produced billable
 * generations. This state is the durable handle that bridges crashes and
 * tab reloads.
 *
 * The orchestrator never reads or writes this file directly; it depends
 * on `ctx.persistRunState` / `ctx.loadRunState` so each environment
 * (browser localStorage, server postgres, e2e in-memory) can plug in its
 * own store without touching workflow logic.
 */
import type { AgentWorkflowStep } from "./agent-actions";

export interface WorkflowRunState {
  /** Stable run id; survives reloads so the same workflow can be resumed. */
  runId: string;
  /** Human-readable name copied from the originating RunWorkflowAction. */
  workflowName: string;
  /** Total step count when the run started (does not shrink on replan). */
  totalSteps: number;
  /**
   * Step ids the orchestrator has already finished. The resume path skips
   * any expanded step whose id appears here. Steps that were skipped on
   * fail (`retryPolicy.skipOnFail`) or by `confirmStep === "skip"` also
   * land here so resume doesn't retry them.
   */
  completedStepIds: string[];
  /**
   * Tool-call results threaded through the run, in the same shape the
   * step-ref resolver consumes. Persisted so a resumed workflow can still
   * substitute `${stepN.key}` against earlier-step outputs.
   */
  perStepToolResults: Array<{
    stepId: string;
    toolResults: Array<{ ok: boolean; data?: unknown }>;
  }>;
  /** When non-empty: the run aborted at this step id. */
  failedAt?: string;
  /** Failure reason mirrored from AgentActionResult / tool result. */
  failReason?: string;
  /** Steps that the planner / replan injected after the run started. */
  injectedSteps?: AgentWorkflowStep[];
  /** ms since epoch — when the run first started. */
  startedAt: number;
  /** ms since epoch — last persistRunState call. */
  updatedAt: number;
}

/** Build a fresh run-state with sensible defaults. */
export function createWorkflowRunState(input: {
  runId: string;
  workflowName: string;
  totalSteps: number;
  startedAt?: number;
}): WorkflowRunState {
  const now = input.startedAt ?? Date.now();
  return {
    runId: input.runId,
    workflowName: input.workflowName,
    totalSteps: input.totalSteps,
    completedStepIds: [],
    perStepToolResults: [],
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Pure helper — append a stepId to completedStepIds, dedup, bump updatedAt.
 * Returns a fresh state object so caller side can compare references.
 */
export function markStepCompleted(
  state: WorkflowRunState,
  stepId: string,
  now: number = Date.now()
): WorkflowRunState {
  if (state.completedStepIds.includes(stepId)) {
    return { ...state, updatedAt: now };
  }
  return {
    ...state,
    completedStepIds: [...state.completedStepIds, stepId],
    updatedAt: now,
  };
}

/**
 * Pure helper — record a tool result against a step id, then bump updatedAt.
 * The first ok entry wins; later failures don't shadow earlier successes
 * (matches `resolveStepRefsInArgs` semantics).
 */
export function appendToolResult(
  state: WorkflowRunState,
  stepId: string,
  result: { ok: boolean; data?: unknown },
  now: number = Date.now()
): WorkflowRunState {
  const existing = state.perStepToolResults.find(entry => entry.stepId === stepId);
  if (existing) {
    return {
      ...state,
      perStepToolResults: state.perStepToolResults.map(entry =>
        entry.stepId === stepId
          ? { ...entry, toolResults: [...entry.toolResults, result] }
          : entry
      ),
      updatedAt: now,
    };
  }
  return {
    ...state,
    perStepToolResults: [
      ...state.perStepToolResults,
      { stepId, toolResults: [result] },
    ],
    updatedAt: now,
  };
}

/** True if the run-state already has a step marked complete with this id. */
export function isStepCompleted(state: WorkflowRunState | null | undefined, stepId: string): boolean {
  if (!state) return false;
  return state.completedStepIds.includes(stepId);
}
