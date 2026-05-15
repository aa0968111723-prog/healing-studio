/**
 * orb-self-reflection.test.ts
 *
 * Verifies the structured step-reflection layer that wraps `verifyToolResult`:
 *   - Verifier fail → severity "fail" + replan signal.
 *   - Empty-success heuristic → severity "warn" + replan signal.
 *   - High retry count or slow latency on a valid result → severity "warn"
 *     but the result still passes (advisory only).
 *   - Clean result → severity "info" + ok.
 *   - Malformed input never throws.
 */

import { describe, expect, it } from "vitest";
import {
  reflectOnStepResult,
  shouldReplanFromReflection,
} from "../shared/orb-self-reflection";

describe("reflectOnStepResult", () => {
  it("returns fail severity when the verifier rejects the data", () => {
    const reflection = reflectOnStepResult({
      toolName: "studio.generateImage",
      data: null,
    });
    expect(reflection.ok).toBe(false);
    expect(reflection.severity).toBe("fail");
    expect(reflection.code.startsWith("verifier:")).toBe(true);
    expect(shouldReplanFromReflection(reflection)).toBe(true);
  });

  it("flags 200-with-empty-results as warn + replan", () => {
    const reflection = reflectOnStepResult({
      toolName: "research.deepSearch",
      data: { results: [] },
    });
    expect(reflection.ok).toBe(false);
    expect(reflection.severity).toBe("warn");
    expect(reflection.code).toBe("reflection:empty-results");
    expect(reflection.advice.toLowerCase()).toContain("empty");
    expect(shouldReplanFromReflection(reflection)).toBe(true);
  });

  it("treats empty text reply as warn", () => {
    const reflection = reflectOnStepResult({
      toolName: "qualityCoach.diagnose",
      data: { text: "   " },
    });
    expect(reflection.severity).toBe("warn");
    expect(reflection.code).toBe("reflection:empty-text");
  });

  it("warns on a high retry count but still marks the step ok", () => {
    const reflection = reflectOnStepResult({
      toolName: "studio.generateImage",
      data: { url: "https://example.com/i.png" },
      retryCount: 3,
    });
    expect(reflection.ok).toBe(true);
    expect(reflection.severity).toBe("warn");
    expect(reflection.code).toBe("reflection:high-retry-count");
    expect(shouldReplanFromReflection(reflection)).toBe(false);
  });

  it("warns on slow latency but still marks the step ok", () => {
    const reflection = reflectOnStepResult({
      toolName: "studio.generateImage",
      data: { url: "https://example.com/i.png" },
      latencyMs: 90_000,
    });
    expect(reflection.ok).toBe(true);
    expect(reflection.severity).toBe("warn");
    expect(reflection.code).toBe("reflection:slow-latency");
    expect(shouldReplanFromReflection(reflection)).toBe(false);
  });

  it("returns info severity for a clean fast result", () => {
    const reflection = reflectOnStepResult({
      toolName: "studio.generateImage",
      data: { url: "https://example.com/i.png" },
      latencyMs: 1_200,
      retryCount: 0,
    });
    expect(reflection.ok).toBe(true);
    expect(reflection.severity).toBe("info");
    expect(reflection.advice).toBe("");
  });

  it("never throws on weird input", () => {
    expect(() =>
      reflectOnStepResult({
        toolName: "studio.unknown",
        data: undefined,
      })
    ).not.toThrow();
    expect(() =>
      reflectOnStepResult({
        toolName: "studio.unknown",
        data: 42 as unknown,
      })
    ).not.toThrow();
  });
});
