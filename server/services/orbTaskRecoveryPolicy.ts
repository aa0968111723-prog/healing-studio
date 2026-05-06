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

