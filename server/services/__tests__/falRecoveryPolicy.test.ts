import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyFalFailure,
  isAdp2RetryEnabled,
  getAdp2MaxRetries,
  adp2BackoffMs,
  _setAdp2SleepFnForTest,
  _resetAdp2SleepFn,
  type FalFailureCategory,
} from "../falRecoveryPolicy";

// ─── classifyFalFailure ───────────────────────────────────────────────────────

describe("classifyFalFailure", () => {
  const cases: Array<[string, string | undefined, unknown, FalFailureCategory]> = [
    // Content violations
    ["content_policy in error", "content_policy violation", null, "content"],
    ["moderation in error", "moderation failed", null, "content"],
    ["nsfw in error", "NSFW content detected", null, "content"],
    ["inappropriate in raw", undefined, { detail: "inappropriate request" }, "content"],
    ["safety in raw", undefined, { message: "Safety filter triggered" }, "content"],
    ["policy_violation in raw", undefined, { error: "policy_violation" }, "content"],
    ["blocked by content filter", "blocked by content filter", null, "content"],
    // Hard failures
    ["model not found", "model not found: fal-ai/bad-model", null, "hard"],
    ["unknown model", undefined, { error: "unknown model id" }, "hard"],
    ["invalid model", "invalid model specified", null, "hard"],
    ["bad request", "bad request from client", null, "hard"],
    ["validation error in raw", undefined, { error: "validation_error: missing field" }, "hard"],
    ["422 in error string", "422 Unprocessable Entity", null, "hard"],
    ["400 in error string", "400 Bad Request", null, "hard"],
    // Transient
    ["timeout", "request timed out", null, "transient"],
    ["queue overload", "queue temporarily overloaded", null, "transient"],
    ["5xx from fal", "503 Service Unavailable", null, "transient"],
    ["empty error", undefined, null, "transient"],
    ["generic fal failure", "generation failed", null, "transient"],
    ["network reset", "ECONNRESET", null, "transient"],
  ];

  for (const [label, error, raw, expected] of cases) {
    it(`classifies "${label}" as ${expected}`, () => {
      expect(classifyFalFailure(error, raw)).toBe(expected);
    });
  }

  it("checks both error string and raw JSON for content patterns", () => {
    expect(
      classifyFalFailure(undefined, { nested: { reason: "content_policy triggered" } })
    ).toBe("content");
  });

  it("content takes priority over hard patterns", () => {
    // If both content and hard patterns match, content wins
    expect(
      classifyFalFailure("model not found due to content_policy", null)
    ).toBe("content");
  });
});

// ─── isAdp2RetryEnabled ────────────────────────────────────────────────────────

describe("isAdp2RetryEnabled", () => {
  const original = process.env.ADP2_RETRY_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.ADP2_RETRY_ENABLED;
    else process.env.ADP2_RETRY_ENABLED = original;
  });

  it("returns true when env var is not set", () => {
    delete process.env.ADP2_RETRY_ENABLED;
    expect(isAdp2RetryEnabled()).toBe(true);
  });

  it("returns true when env var is '1'", () => {
    process.env.ADP2_RETRY_ENABLED = "1";
    expect(isAdp2RetryEnabled()).toBe(true);
  });

  it("returns false when env var is '0'", () => {
    process.env.ADP2_RETRY_ENABLED = "0";
    expect(isAdp2RetryEnabled()).toBe(false);
  });

  it("returns true for any value other than '0'", () => {
    process.env.ADP2_RETRY_ENABLED = "true";
    expect(isAdp2RetryEnabled()).toBe(true);
  });
});

// ─── getAdp2MaxRetries ────────────────────────────────────────────────────────

describe("getAdp2MaxRetries", () => {
  const original = process.env.ADP2_MAX_RETRIES;

  afterEach(() => {
    if (original === undefined) delete process.env.ADP2_MAX_RETRIES;
    else process.env.ADP2_MAX_RETRIES = original;
  });

  it("returns 2 when env var is not set", () => {
    delete process.env.ADP2_MAX_RETRIES;
    expect(getAdp2MaxRetries()).toBe(2);
  });

  it("returns the configured value", () => {
    process.env.ADP2_MAX_RETRIES = "3";
    expect(getAdp2MaxRetries()).toBe(3);
  });

  it("caps at 5", () => {
    process.env.ADP2_MAX_RETRIES = "10";
    expect(getAdp2MaxRetries()).toBe(5);
  });

  it("returns 2 for non-numeric values", () => {
    process.env.ADP2_MAX_RETRIES = "lots";
    expect(getAdp2MaxRetries()).toBe(2);
  });

  it("returns 0 when explicitly set to 0 (no retries)", () => {
    process.env.ADP2_MAX_RETRIES = "0";
    expect(getAdp2MaxRetries()).toBe(0);
  });

  it("returns 2 for negative values", () => {
    process.env.ADP2_MAX_RETRIES = "-1";
    expect(getAdp2MaxRetries()).toBe(2);
  });
});

// ─── adp2BackoffMs ────────────────────────────────────────────────────────────

describe("adp2BackoffMs", () => {
  it("returns 1000ms for attempt 1", () => {
    expect(adp2BackoffMs(1)).toBe(1000);
  });

  it("returns 2000ms for attempt 2", () => {
    expect(adp2BackoffMs(2)).toBe(2000);
  });

  it("returns 4000ms for attempt 3", () => {
    expect(adp2BackoffMs(3)).toBe(4000);
  });

  it("caps at 8000ms", () => {
    expect(adp2BackoffMs(5)).toBe(8000);
    expect(adp2BackoffMs(10)).toBe(8000);
  });
});

// ─── retry integration via sleep seam ────────────────────────────────────────

describe("_setAdp2SleepFnForTest / _resetAdp2SleepFn", () => {
  afterEach(() => {
    _resetAdp2SleepFn();
  });

  it("sleep seam can be replaced for instant-resolve in tests", async () => {
    const calls: number[] = [];
    _setAdp2SleepFnForTest(async (ms) => { calls.push(ms); });

    // Import the live sleep fn by using the module directly
    const { _adp2SleepFn } = await import("../falRecoveryPolicy");
    await _adp2SleepFn(1234);
    expect(calls).toEqual([1234]);
  });

  it("reset restores original (no-op test, verifies no throw)", () => {
    _setAdp2SleepFnForTest(async () => {});
    _resetAdp2SleepFn();
    // should not throw
  });
});
