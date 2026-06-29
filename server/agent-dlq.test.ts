/**
 * agent-dlq.test.ts — AIDV-346 驗證門失敗路由 DLQ 測試
 *
 * Tests three routing branches via classifyValidationFailure + routeValidationFailure:
 *   1. lint-fail  → action "retry"
 *   2. test-fail  → action "decision"
 *   3. max-retry  → action "escalate" after exhausting retries
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyValidationFailure,
  routeValidationFailure,
  _resetValidationStateForTest,
} from "./_core/validationGateRouter";

beforeEach(() => {
  _resetValidationStateForTest();
});

describe("classifyValidationFailure", () => {
  it("classifies TS compiler errors as lint", () => {
    const out = classifyValidationFailure(
      "src/foo.ts(10,5): error TS2345: Argument of type",
      ""
    );
    expect(out).toBe("lint");
  });

  it("classifies vitest FAIL output as test", () => {
    const out = classifyValidationFailure("", "FAIL src/foo.test.ts > suite > case");
    expect(out).toBe("test");
  });

  it("classifies module-not-found as build", () => {
    const out = classifyValidationFailure("Cannot find module 'react'", "");
    expect(out).toBe("build");
  });

  it("returns unknown when no patterns match", () => {
    const out = classifyValidationFailure("", "");
    expect(out).toBe("unknown");
  });
});

describe("routeValidationFailure — lint branch (retry → escalate)", () => {
  it("routes first lint failure to retry", () => {
    const state = routeValidationFailure("AIDV-99", 1, "lint", 3);
    expect(state.action).toBe("retry");
    expect(state.retryCount).toBe(1);
  });

  it("escalates after maxRetries lint failures", () => {
    routeValidationFailure("AIDV-99", 1, "lint", 3);
    routeValidationFailure("AIDV-99", 1, "lint", 3);
    const state = routeValidationFailure("AIDV-99", 1, "lint", 3);
    expect(state.action).toBe("escalate");
    expect(state.retryCount).toBe(3);
  });
});

describe("routeValidationFailure — test branch (decision)", () => {
  it("routes test failure directly to decision on first occurrence", () => {
    const state = routeValidationFailure("AIDV-99", 1, "test", 3);
    expect(state.action).toBe("decision");
    expect(state.failureType).toBe("test");
  });

  it("routes unknown failure directly to decision", () => {
    const state = routeValidationFailure("AIDV-99", 1, "unknown", 3);
    expect(state.action).toBe("decision");
  });
});

describe("routeValidationFailure — build branch (retry → escalate)", () => {
  it("routes first build failure to retry", () => {
    const state = routeValidationFailure("AIDV-88", 2, "build", 2);
    expect(state.action).toBe("retry");
  });

  it("escalates after maxRetries build failures", () => {
    routeValidationFailure("AIDV-88", 2, "build", 2);
    const state = routeValidationFailure("AIDV-88", 2, "build", 2);
    expect(state.action).toBe("escalate");
  });
});

describe("routeValidationFailure — isolation", () => {
  it("tracks retry counts independently per userId+issueKey", () => {
    routeValidationFailure("AIDV-99", 1, "lint", 3);
    routeValidationFailure("AIDV-99", 1, "lint", 3);
    // different userId should have a fresh counter
    const stateOtherUser = routeValidationFailure("AIDV-99", 2, "lint", 3);
    expect(stateOtherUser.action).toBe("retry");
    expect(stateOtherUser.retryCount).toBe(1);
  });
});
