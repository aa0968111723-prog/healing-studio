import { describe, expect, it } from "vitest";
import {
  resolveStepRefsInArgs,
  resolveStepRefsInString,
} from "../shared/orb-step-ref-resolver";

const stepResults = [
  {
    stepId: "step1",
    toolResults: [
      {
        ok: true,
        data: {
          request_id: "fal-abc-123",
          video_url: "https://cdn.example/video1.mp4",
          modelId: "fal-ai/kling-video/v2.1/standard/text-to-video",
          duration: 30,
        },
      },
    ],
  },
  {
    stepId: "step2",
    toolResults: [
      {
        ok: true,
        data: {
          transcript: "貓咪正在發動進攻",
          confidence: 0.92,
        },
      },
    ],
  },
];

describe("resolveStepRefsInArgs", () => {
  it("substitutes a single ${stepId.key} placeholder and preserves the original type", () => {
    const out = resolveStepRefsInArgs({
      args: {
        video_url: "${step1.video_url}",
        duration: "${step1.duration}",
        operation: "upscale",
      },
      perStepToolResults: stepResults,
    });
    expect(out).toEqual({
      video_url: "https://cdn.example/video1.mp4",
      duration: 30,
      operation: "upscale",
    });
  });

  it("supports the optional 'steps.' / 'output.' namespace", () => {
    const out = resolveStepRefsInArgs({
      args: {
        a: "${steps.step1.video_url}",
        b: "${step1.output.video_url}",
        c: "${steps.step1.output.modelId}",
      },
      perStepToolResults: stepResults,
    });
    expect(out).toEqual({
      a: "https://cdn.example/video1.mp4",
      b: "https://cdn.example/video1.mp4",
      c: "fal-ai/kling-video/v2.1/standard/text-to-video",
    });
  });

  it("splices placeholders into mixed strings and stringifies non-string values", () => {
    expect(
      resolveStepRefsInString(
        "Caption for: ${step2.transcript} (confidence ${step2.confidence})",
        stepResults
      )
    ).toBe("Caption for: 貓咪正在發動進攻 (confidence 0.92)");
  });

  it("leaves unresolved placeholders in place so missing deps are obvious downstream", () => {
    const out = resolveStepRefsInArgs({
      args: {
        missing: "${stepX.foo}",
        partial: "prefix-${stepX.bar}-suffix",
      },
      perStepToolResults: stepResults,
    });
    expect(out).toEqual({
      missing: "${stepX.foo}",
      partial: "prefix-${stepX.bar}-suffix",
    });
  });

  it("walks nested objects + arrays", () => {
    const out = resolveStepRefsInArgs({
      args: {
        nested: {
          inputs: ["${step1.video_url}", "static-value"],
          meta: { duration: "${step1.duration}" },
        },
      },
      perStepToolResults: stepResults,
    });
    expect(out).toEqual({
      nested: {
        inputs: ["https://cdn.example/video1.mp4", "static-value"],
        meta: { duration: 30 },
      },
    });
  });

  it("only consumes the FIRST successful tool result per step (later failures don't shadow)", () => {
    const results = [
      {
        stepId: "step1",
        toolResults: [
          { ok: true, data: { video_url: "https://good" } },
          { ok: false },
        ],
      },
    ];
    const out = resolveStepRefsInArgs({
      args: { video_url: "${step1.video_url}" },
      perStepToolResults: results,
    });
    expect(out).toEqual({ video_url: "https://good" });
  });

  it("returns args untouched when no placeholders are present", () => {
    const args = { prompt: "raw prompt", duration: 30 };
    const out = resolveStepRefsInArgs({
      args,
      perStepToolResults: stepResults,
    });
    expect(out).toEqual(args);
  });

  it("returns undefined when given undefined args", () => {
    expect(
      resolveStepRefsInArgs({
        args: undefined,
        perStepToolResults: stepResults,
      })
    ).toBeUndefined();
  });
});
