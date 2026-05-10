import { createTRPCReact } from "@trpc/react-query";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * tRPC procedure path prefixes that should bypass `httpBatchLink` and run on
 * their own request. These are the long-running LLM / generation routes —
 * batching them with cheap calls (auth.me, credits.balance, etc.) means a
 * single slow procedure poisons the whole batch and surfaces as "API doesn't
 * connect" for everything queued in the same ~10ms window.
 *
 * Match is by `op.path.startsWith(prefix)` so this covers every nested
 * procedure under each branch (`ai.chat`, `ai.streamChat`, `generate.text`…).
 */
export const NON_BATCHED_PROCEDURE_PREFIXES = [
  "ai.",
  "generate.",
  "director.",
  "evaluate.",
  "models.",
  "ai.orbTask.",
  "orbTask.",
  "ai.codeTask.",
  "codeTask.",
] as const;

export function isHeavyProcedurePath(path: string): boolean {
  return NON_BATCHED_PROCEDURE_PREFIXES.some(prefix => path.startsWith(prefix));
}

/**
 * React Query retry policy that distinguishes deterministic 4xx failures
 * (don't retry — same input will fail the same way) from transient 5xx /
 * network errors (worth retrying). Default tRPC + React Query treats every
 * error the same, which both wastes requests on auth failures AND gives up
 * too quickly on cold-start / transient backend hiccups.
 *
 * Returns true if the failure should be retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown, maxRetries = 2): boolean {
  if (failureCount >= maxRetries) return false;
  if (error instanceof TRPCClientError) {
    const status = (error.data as { httpStatus?: number } | undefined)?.httpStatus;
    // 4xx is deterministic (auth, validation, not-found, rate-limit) — retry
    // only adds load and delays the inevitable failure UX.
    if (typeof status === "number" && status >= 400 && status < 500) return false;
  }
  return true;
}

/**
 * Exponential backoff with ±25% jitter so multiple concurrent retries don't
 * stampede the backend at the same instants. Capped at 10s.
 */
export function computeRetryDelay(attemptIndex: number): number {
  const base = Math.min(1_000 * 2 ** attemptIndex, 10_000);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}
