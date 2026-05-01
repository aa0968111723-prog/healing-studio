/**
 * trpc-client-helpers.test.ts — tRPC client hardening helpers
 *
 * Covers the pure functions extracted from client/src/lib/trpc.ts that drive
 * the splitLink / retry policy added to fix intermittent "API doesn't connect"
 * failures. The actual link wiring lives in client/src/main.tsx and gets its
 * coverage from manual smoke tests; the policy logic that decides which calls
 * skip batching, which failures retry, and how long to back off lives here so
 * regressions surface in CI instead of in production.
 */

import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  NON_BATCHED_PROCEDURE_PREFIXES,
  isHeavyProcedurePath,
  shouldRetryQuery,
  computeRetryDelay,
} from "../client/src/lib/trpc";

describe("isHeavyProcedurePath", () => {
  it("classifies every declared LLM / generation prefix as heavy", () => {
    for (const prefix of NON_BATCHED_PROCEDURE_PREFIXES) {
      // Arbitrary nested procedure under each branch — the matcher must hit
      // any depth so we don't have to enumerate every leaf.
      expect(isHeavyProcedurePath(`${prefix}someProcedure`)).toBe(true);
      expect(isHeavyProcedurePath(`${prefix}nested.deep.proc`)).toBe(true);
    }
  });

  it("treats lightweight procedures as batchable", () => {
    expect(isHeavyProcedurePath("auth.me")).toBe(false);
    expect(isHeavyProcedurePath("credits.balance")).toBe(false);
    expect(isHeavyProcedurePath("assets.list")).toBe(false);
    expect(isHeavyProcedurePath("dashboard.summary")).toBe(false);
    expect(isHeavyProcedurePath("settings.get")).toBe(false);
  });

  it("does not over-match prefixes that share a substring", () => {
    // `aircraft.foo` must NOT be matched by the `ai.` prefix even though it
    // starts with the same two letters — the dot in the prefix is load-bearing.
    expect(isHeavyProcedurePath("aircraft.foo")).toBe(false);
    expect(isHeavyProcedurePath("airport.list")).toBe(false);
    // Same vibe for `evaluate.` not matching `eval.` etc.
    expect(isHeavyProcedurePath("eval.foo")).toBe(false);
  });
});

describe("shouldRetryQuery", () => {
  function clientErrorWithStatus(status: number): TRPCClientError<never> {
    const err = new TRPCClientError("test");
    // Mutate `data` directly — TRPCClientError exposes it as a plain field.
    (err as unknown as { data: { httpStatus: number } }).data = { httpStatus: status };
    return err;
  }

  it("never retries past the configured ceiling", () => {
    expect(shouldRetryQuery(0, new Error("net"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("net"))).toBe(true);
    expect(shouldRetryQuery(2, new Error("net"))).toBe(false);
    // Custom ceiling honoured.
    expect(shouldRetryQuery(2, new Error("net"), 3)).toBe(true);
    expect(shouldRetryQuery(3, new Error("net"), 3)).toBe(false);
  });

  it("does NOT retry deterministic 4xx tRPC errors", () => {
    // Auth, validation, not-found, rate-limit — same input → same failure.
    expect(shouldRetryQuery(0, clientErrorWithStatus(400))).toBe(false);
    expect(shouldRetryQuery(0, clientErrorWithStatus(401))).toBe(false);
    expect(shouldRetryQuery(0, clientErrorWithStatus(403))).toBe(false);
    expect(shouldRetryQuery(0, clientErrorWithStatus(404))).toBe(false);
    expect(shouldRetryQuery(0, clientErrorWithStatus(429))).toBe(false);
    expect(shouldRetryQuery(0, clientErrorWithStatus(499))).toBe(false);
  });

  it("retries 5xx tRPC errors and unclassified errors", () => {
    expect(shouldRetryQuery(0, clientErrorWithStatus(500))).toBe(true);
    expect(shouldRetryQuery(0, clientErrorWithStatus(502))).toBe(true);
    expect(shouldRetryQuery(0, clientErrorWithStatus(503))).toBe(true);
    expect(shouldRetryQuery(0, clientErrorWithStatus(504))).toBe(true);
    // Plain network errors (fetch failed, abort, timeout) have no httpStatus.
    expect(shouldRetryQuery(0, new Error("network down"))).toBe(true);
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  });

  it("treats tRPC errors without httpStatus as transient (retry)", () => {
    const err = new TRPCClientError("abort");
    // No `data.httpStatus` set — typical for network-layer aborts.
    expect(shouldRetryQuery(0, err)).toBe(true);
  });
});

describe("computeRetryDelay", () => {
  it("grows exponentially before the cap with jitter held within ±25%", () => {
    // Sample many runs to validate the jitter window without flaking on a
    // single random draw.
    for (const attempt of [0, 1, 2, 3, 4]) {
      const base = Math.min(1_000 * 2 ** attempt, 10_000);
      for (let i = 0; i < 50; i++) {
        const delay = computeRetryDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(Math.max(100, base * 0.75 - 1));
        expect(delay).toBeLessThanOrEqual(base * 1.25 + 1);
      }
    }
  });

  it("caps at 10s + jitter for very high attempt counts", () => {
    for (let i = 0; i < 50; i++) {
      const delay = computeRetryDelay(20);
      expect(delay).toBeLessThanOrEqual(10_000 * 1.25 + 1);
    }
  });

  it("never returns less than the 100ms floor", () => {
    for (let i = 0; i < 50; i++) {
      // Even attempt=0 with worst-case negative jitter (-25% of 1000 = -250)
      // would land at 750, but the floor protects against future tuning.
      expect(computeRetryDelay(0)).toBeGreaterThanOrEqual(100);
    }
  });
});
