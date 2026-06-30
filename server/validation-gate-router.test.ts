/**
 * validation-gate-router.test.ts — AIDV-339
 *
 * 驗收條件：
 *   1. classifyValidationFailure：TS error → "lint"
 *   2. classifyValidationFailure：FAIL → "test"
 *   3. classifyValidationFailure：SyntaxError (no TS error) → "build"
 *   4. classifyValidationFailure：空輸入 → "unknown"
 *   5. routeValidationFailure：lint 第 1 次 → "retry"
 *   6. routeValidationFailure：lint 達 maxRetries → "escalate"
 *   7. routeValidationFailure：test 失敗立即 → "decision"
 *   8. routeValidationFailure：unknown 立即 → "decision"
 *   9. 不同 userId 計數相互獨立
 *  10. clearValidationState 重置計數器
 *  11. getValidationState 反映最新狀態
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyValidationFailure,
  routeValidationFailure,
  getValidationState,
  clearValidationState,
  _resetValidationStateForTest,
} from "./_core/validationGateRouter";

beforeEach(() => {
  _resetValidationStateForTest();
});

// ── classifyValidationFailure ─────────────────────────────────────────────────

describe("classifyValidationFailure", () => {
  it("TS error → lint", () => {
    expect(classifyValidationFailure("error TS2345: blah", "")).toBe("lint");
  });

  it("vitest FAIL → test", () => {
    expect(classifyValidationFailure("", "FAIL  server/foo.test.ts")).toBe("test");
  });

  it("SyntaxError (no TS error) → build", () => {
    expect(classifyValidationFailure("SyntaxError: Unexpected token", "")).toBe("build");
  });

  it("empty inputs → unknown", () => {
    expect(classifyValidationFailure("", "")).toBe("unknown");
  });

  it("TS error takes priority over FAIL", () => {
    expect(classifyValidationFailure("error TS2304: blah", "FAIL")).toBe("lint");
  });
});

// ── routeValidationFailure ────────────────────────────────────────────────────

describe("routeValidationFailure", () => {
  it("lint 第 1 次 → retry", () => {
    const state = routeValidationFailure("AIDV-339", 1, "lint", 3);
    expect(state.action).toBe("retry");
    expect(state.retryCount).toBe(1);
  });

  it("lint 連續 3 次 → escalate（maxRetries=3）", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    const state = routeValidationFailure("AIDV-339", 1, "lint", 3);
    expect(state.action).toBe("escalate");
    expect(state.retryCount).toBe(3);
  });

  it("test 失敗立即 → decision", () => {
    const state = routeValidationFailure("AIDV-339", 1, "test", 3);
    expect(state.action).toBe("decision");
  });

  it("unknown 立即 → decision", () => {
    const state = routeValidationFailure("AIDV-339", 1, "unknown", 3);
    expect(state.action).toBe("decision");
  });

  it("build 第 2 次（< maxRetries=3）→ retry", () => {
    routeValidationFailure("AIDV-339", 1, "build", 3);
    const state = routeValidationFailure("AIDV-339", 1, "build", 3);
    expect(state.action).toBe("retry");
    expect(state.retryCount).toBe(2);
  });

  it("不同 userId 計數相互獨立", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    // userId=2 should start fresh
    const state = routeValidationFailure("AIDV-339", 2, "lint", 3);
    expect(state.retryCount).toBe(1);
    expect(state.action).toBe("retry");
  });

  it("不同 issueKey 計數相互獨立", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    const state = routeValidationFailure("AIDV-999", 1, "lint", 3);
    expect(state.retryCount).toBe(1);
  });
});

// ── getValidationState / clearValidationState ─────────────────────────────────

describe("getValidationState", () => {
  it("未記錄時回傳 retryCount=0, lastFailureType=null", () => {
    const s = getValidationState("AIDV-339", 1);
    expect(s.retryCount).toBe(0);
    expect(s.lastFailureType).toBeNull();
  });

  it("記錄後反映最新狀態", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    const s = getValidationState("AIDV-339", 1);
    expect(s.retryCount).toBe(1);
    expect(s.lastFailureType).toBe("lint");
  });
});

describe("clearValidationState", () => {
  it("清除後 retryCount 歸零", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    clearValidationState("AIDV-339", 1);
    const s = getValidationState("AIDV-339", 1);
    expect(s.retryCount).toBe(0);
  });

  it("清除後重新計數從 1 開始", () => {
    routeValidationFailure("AIDV-339", 1, "lint", 3);
    clearValidationState("AIDV-339", 1);
    const state = routeValidationFailure("AIDV-339", 1, "lint", 3);
    expect(state.retryCount).toBe(1);
    expect(state.action).toBe("retry");
  });
});
