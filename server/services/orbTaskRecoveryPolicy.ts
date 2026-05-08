/**
 * Orb step error classification — contract clarification:
 *
 * - `OrbStepErrorCode` (5 values) is a normalised error TAXONOMY that the
 *   orchestrator emits per failed step. It powers the `error_code` field on
 *   `perStepToolResults` and feeds `recordRecoveryMetric` for observability
 *   dashboards (which strategy is firing the most often, which tool keeps
 *   tripping the same code, etc.).
 *
 * - `OrbRecoveryAction` (6 values) is the matching ADVISORY LABEL that
 *   ships in the response payload so the UI / future planner can render
 *   "next step you should take" hints. The orchestrator itself does NOT
 *   route on this label — actual recovery happens through dedicated paths:
 *
 *     * Deterministic retries (validation_error / selector_not_found /
 *       timeout) — driven by the per-tool `retryPolicy` in
 *       runOrbToolStepWithRetries (see orbTaskOrchestrator.ts:200-320).
 *     * LLM replan (provider_error) — driven by `onRequestReplan` →
 *       orbLLMReplan.ts → planner regenerates the failed step.
 *     * Human confirmation (policy_blocked) — driven by the workflow
 *       confirmation gates in shared/global-agent-orchestrator.ts.
 *     * Hand-off (any code, after MAX_SAME_ERROR_STREAK) — orchestrator
 *       overrides recovery_action="handoff_to_human" and stops retrying.
 *
 *   The label is therefore a CLASSIFICATION, not a directive. Future work
 *   can route on it by mapping each label to a real recovery procedure.
 */
export type OrbStepErrorCode =
  | "validation_error"
  | "selector_not_found"
  | "timeout"
  | "provider_error"
  | "policy_blocked";

export type OrbRecoveryAction =
  | "backfill_required_fields"
  | "relocate_selector"
  | "retry_with_exponential_backoff"
  | "switch_provider_or_replan"
  | "request_human_confirmation"
  | "handoff_to_human";

export function classifyOrbStepError(raw?: string): OrbStepErrorCode {
  const value = String(raw ?? "").toLowerCase();
  if (/approval|required|blocked|forbidden|policy/.test(value)) return "policy_blocked";
  if (/selector|element|not found|unresolved-step-ref/.test(value)) return "selector_not_found";
  if (/timeout|timed out|etimedout|abort/.test(value)) return "timeout";
  if (/validation|invalid|required field|schema/.test(value)) return "validation_error";
  return "provider_error";
}

/**
 * Maps an error code to its advisory recovery label. See the file-level
 * comment for the full contract — only `handoff_to_human` (set by the
 * orchestrator after a same-error streak) actually changes runtime
 * behaviour. The other five labels are observability metadata.
 */
export function recoveryActionFor(code: OrbStepErrorCode): OrbRecoveryAction {
  switch (code) {
    case "validation_error":
      return "backfill_required_fields";
    case "selector_not_found":
      return "relocate_selector";
    case "timeout":
      return "retry_with_exponential_backoff";
    case "policy_blocked":
      return "request_human_confirmation";
    case "provider_error":
    default:
      return "switch_provider_or_replan";
  }
}

