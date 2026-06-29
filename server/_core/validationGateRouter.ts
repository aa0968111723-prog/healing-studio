/**
 * validationGateRouter.ts — AIDV-339 驗證門失敗路由
 *
 * Classifies tsc/vitest failure output into one of three types,
 * tracks per-key retry counts, and routes to the correct action:
 *   lint-fail  → retry (TS/lint errors are self-correctable)
 *   test-fail  → decision (logic errors need Bruce's call)
 *   max-retry  → escalate (human review, push notification)
 *
 * No DB dependency — pure in-memory state, sufficient for single-process Railway.
 */

export type ValidationFailureType = "lint" | "test" | "build" | "unknown";
export type RoutingAction = "retry" | "decision" | "escalate";

export interface ValidationState {
  issueKey: string;
  userId: number;
  failureType: ValidationFailureType;
  action: RoutingAction;
  retryCount: number;
  maxRetries: number;
  updatedAt: number;
}

interface RetryEntry {
  count: number;
  lastFailureType: ValidationFailureType;
  createdAt: number;
  updatedAt: number;
}

const retryMap = new Map<string, RetryEntry>();

const RETRY_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

function evictStaleEntries(now: number): void {
  const cutoff = now - RETRY_ENTRY_TTL_MS;
  retryMap.forEach((entry, key) => {
    if (entry.createdAt < cutoff) retryMap.delete(key);
  });
}

/** Exported only for tests — clears all state between tests. */
export function _resetValidationStateForTest(): void {
  retryMap.clear();
}

/**
 * Classify tsc + vitest output into a failure type.
 * Priority: lint (TS errors) > test > build > unknown.
 */
export function classifyValidationFailure(
  tscOutput: string,
  vitestOutput: string
): ValidationFailureType {
  const hasTsError = /error TS\d+/i.test(tscOutput);
  const hasVitestFail = /\bFAIL\b/.test(vitestOutput);
  const hasBuildError =
    /\bSyntaxError\b|\bCannot find module\b|\bfailed to build\b/i.test(tscOutput + vitestOutput);

  if (hasTsError) return "lint";
  if (hasVitestFail) return "test";
  if (hasBuildError) return "build";
  return "unknown";
}

/**
 * Record a validation failure and return the routing action.
 *
 * Routing rules (AIDV-339):
 *   lint    → retry (up to maxRetries)
 *   test    → decision immediately
 *   build   → retry (up to maxRetries, build errors are often fixable)
 *   unknown → decision (conservative: don't auto-retry unknown failures)
 *
 * After maxRetries consecutive failures of any retryable type → escalate.
 */
export function routeValidationFailure(
  issueKey: string,
  userId: number,
  failureType: ValidationFailureType,
  maxRetries = 3
): ValidationState {
  const mapKey = `${userId}:${issueKey}`;
  const now = Date.now();
  evictStaleEntries(now);
  const existing = retryMap.get(mapKey);

  // non-retryable types skip the counter and go straight to decision
  if (failureType === "test" || failureType === "unknown") {
    const state: ValidationState = {
      issueKey,
      userId,
      failureType,
      action: "decision",
      retryCount: existing?.count ?? 0,
      maxRetries,
      updatedAt: now,
    };
    retryMap.set(mapKey, { count: existing?.count ?? 0, lastFailureType: failureType, createdAt: existing?.createdAt ?? now, updatedAt: now });
    return state;
  }

  // retryable types: lint, build
  const retryCount = (existing?.count ?? 0) + 1;
  retryMap.set(mapKey, { count: retryCount, lastFailureType: failureType, createdAt: existing?.createdAt ?? now, updatedAt: now });

  const action: RoutingAction = retryCount >= maxRetries ? "escalate" : "retry";
  return {
    issueKey,
    userId,
    failureType,
    action,
    retryCount,
    maxRetries,
    updatedAt: now,
  };
}

/** Read the current retry state for a key without mutating it. */
export function getValidationState(
  issueKey: string,
  userId: number
): { retryCount: number; lastFailureType: ValidationFailureType | null } {
  const entry = retryMap.get(`${userId}:${issueKey}`);
  return {
    retryCount: entry?.count ?? 0,
    lastFailureType: entry?.lastFailureType ?? null,
  };
}

/** Reset the retry counter for a key (e.g. after a successful validation). */
export function clearValidationState(issueKey: string, userId: number): void {
  retryMap.delete(`${userId}:${issueKey}`);
}
