/**
 * orb-process-link.test.ts
 *
 * Verifies the shareable process-spec encoder/decoder used by the orb to
 * hand back `/process?spec=…` URLs.
 */

import { describe, expect, it } from "vitest";
import {
  buildProcessUrl,
  decodeProcessSpec,
  encodeProcessSpec,
  normalizeProcessSpec,
  workflowActionToProcessSpec,
  PROCESS_SPEC_MAX_STEPS,
} from "../shared/orb-process-link";
import type { RunWorkflowAction } from "../shared/agent-actions";

describe("orb-process-link encoder", () => {
  it("round-trips a how-to spec through encode + decode", () => {
    const spec = {
      title: "製茶過程",
      summary: "從採葉到泡茶的標準六個步驟",
      kind: "howto" as const,
      emoji: "🍵",
      steps: [
        { title: "採摘嫩葉", detail: "清晨手摘一心二葉" },
        { title: "萎凋", detail: "讓茶葉自然失水" },
        { title: "揉捻" },
        { title: "發酵" },
        { title: "乾燥" },
        { title: "品飲" },
      ],
    };
    const encoded = encodeProcessSpec(spec);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeProcessSpec(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.spec?.title).toBe("製茶過程");
    expect(decoded.spec?.steps).toHaveLength(6);
    expect(decoded.spec?.kind).toBe("howto");
    expect(decoded.spec?.emoji).toBe("🍵");
  });

  it("normalizes overly long titles and trims to step cap", () => {
    const longTitle = "a".repeat(500);
    const tooManySteps = Array.from({ length: PROCESS_SPEC_MAX_STEPS + 5 }, (_, i) => ({
      title: `step ${i}`,
    }));
    const spec = normalizeProcessSpec({
      title: longTitle,
      steps: tooManySteps,
    });
    expect(spec.title.length).toBeLessThanOrEqual(80);
    expect(spec.steps).toHaveLength(PROCESS_SPEC_MAX_STEPS);
  });

  it("rejects invalid base64 with a structured error", () => {
    const result = decodeProcessSpec("!!!not-base64!!!");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects empty spec", () => {
    expect(decodeProcessSpec("").ok).toBe(false);
  });

  it("rejects non-object payload (number)", () => {
    const encoded = encodeProcessSpec({
      title: "ok",
      steps: [{ title: "a" }],
    });
    expect(decodeProcessSpec(encoded).ok).toBe(true);
    // Force a malformed payload by hand-encoding a JSON number.
    const bytes = new TextEncoder().encode(JSON.stringify(42));
    const b64 = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = decodeProcessSpec(b64);
    expect(result.ok).toBe(false);
  });

  it("converts a runWorkflow action into a process spec", () => {
    const action: RunWorkflowAction = {
      type: "runWorkflow",
      name: "短片生成流程",
      steps: [
        {
          path: "/director",
          actionType: "fillPrompt",
          payload: "請拆成 30 秒短片",
          label: "導演 AI：產生企劃",
        },
        {
          path: "/image-studio",
          actionType: "submit",
          payload: "",
          label: "生成關鍵視覺",
        },
      ],
    };
    const spec = workflowActionToProcessSpec(action);
    expect(spec.kind).toBe("workflow");
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[0]?.path).toBe("/director");
    expect(spec.steps[0]?.actionType).toBe("fillPrompt");
  });

  it("buildProcessUrl returns path-only by default and full origin when given", () => {
    const spec = { title: "test", steps: [{ title: "s1" }] };
    const path = buildProcessUrl(spec);
    expect(path.startsWith("/process?spec=")).toBe(true);
    const full = buildProcessUrl(spec, { origin: "https://example.com/" });
    expect(full.startsWith("https://example.com/process?spec=")).toBe(true);
  });

  it("rejects specs that exceed the byte cap after normalization", () => {
    const huge = {
      title: "h".repeat(80),
      summary: "s".repeat(240),
      source: "src".repeat(20),
      steps: Array.from({ length: 24 }, (_, i) => ({
        title: `${i}-${"t".repeat(70)}`,
        detail: "d".repeat(240),
        path: `/very/long/path/segment/${"p".repeat(150)}`,
        actionType: "fillPrompt",
        payload: "x".repeat(380),
      })),
    };
    expect(() => encodeProcessSpec(huge)).toThrow(/too large/);
  });
});
