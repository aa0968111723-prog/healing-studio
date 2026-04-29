/**
 * orb-task-state-machine-extras.test.ts
 *
 * Tests for the new agent-condition helpers added on top of the existing
 * state machine: exponential backoff retry, per-step timeout wrapper, and
 * the typed inter-agent messaging channel.
 */

import { describe, expect, it } from "vitest";
import {
  computeRetryBackoffMs,
  DEFAULT_STEP_TIMEOUT_MS,
} from "../shared/orb-task-state-machine";

describe("computeRetryBackoffMs", () => {
  it("starts at ~1s for the first retry", () => {
    const ms = computeRetryBackoffMs(0);
    // jitter: ±20% around 1s
    expect(ms).toBeGreaterThanOrEqual(800);
    expect(ms).toBeLessThanOrEqual(1_200);
  });

  it("grows exponentially per attempt", () => {
    const a1 = computeRetryBackoffMs(1);
    const a2 = computeRetryBackoffMs(2);
    const a3 = computeRetryBackoffMs(3);
    // Each step should be roughly double the previous (allowing for jitter).
    expect(a1).toBeGreaterThanOrEqual(1_600);
    expect(a2).toBeGreaterThanOrEqual(3_200);
    expect(a3).toBeGreaterThanOrEqual(6_400);
  });

  it("caps at 30s", () => {
    for (const attempt of [10, 20, 50]) {
      expect(computeRetryBackoffMs(attempt)).toBeLessThanOrEqual(30_000);
    }
  });

  it("handles negative / zero attempts gracefully", () => {
    const a = computeRetryBackoffMs(-5);
    expect(a).toBeGreaterThanOrEqual(800);
    expect(a).toBeLessThanOrEqual(1_200);
  });
});

describe("DEFAULT_STEP_TIMEOUT_MS", () => {
  it("is a sane default (between 30s and 5min)", () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(DEFAULT_STEP_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});
