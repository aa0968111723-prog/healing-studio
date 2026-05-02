/**
 * tests/unit/shared/orb-plan-critic.test.ts
 *
 * Module 3 — plan self-critique:
 *   1. unknown-tool blocker.
 *   2. unresolved + forward-reference placeholder detection.
 *   3. missing-prerequisite (changeVoice without cloneVoice).
 *   4. submit-without-prompt warning.
 *   5. dependency-cycle detection.
 *   6. duplicate-step-id detection.
 *   7. tool-arg-shape blocker (required arg missing).
 *   8. score + shouldRefine semantics.
 *   9. healthy plan returns 100/no issues.
 */
import { describe, expect, it } from "vitest";
import type { RunWorkflowAction } from "../../../shared/agent-actions";
import {
  buildCritiquePromptForLLM,
  critiquePlan,
} from "../../../shared/orb-plan-critic";

const wf = (steps: RunWorkflowAction["steps"]): RunWorkflowAction => ({
  type: "runWorkflow",
  name: "test",
  steps,
});

describe("critiquePlan — unknown tool / arg shape", () => {
  it("flags unknown tools as a blocker", () => {
    const r = critiquePlan(wf([
      {
        actionType: "",
        payload: "",
        label: "x",
        toolName: "studio.notARealTool",
        toolArgs: { prompt: "x" },
      },
    ]));
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain("unknown-tool");
    expect(r.shouldRefine).toBe(true);
  });

  it("flags missing required tool args as a blocker", () => {
    // studio.generateImage.allowedArgsSchema requires `prompt`.
    const r = critiquePlan(wf([
      {
        actionType: "",
        payload: "",
        label: "x",
        toolName: "studio.generateImage",
        toolArgs: {},
      },
    ]));
    const argShape = r.issues.find(i => i.code === "tool-arg-shape");
    expect(argShape).toBeDefined();
    expect(argShape?.message).toMatch(/prompt/);
  });
});

describe("critiquePlan — placeholders", () => {
  it("flags unresolved placeholders pointing at unknown step ids", () => {
    const r = critiquePlan(wf([
      { id: "a", actionType: "", payload: "", label: "first", toolName: "studio.generateImage", toolArgs: { prompt: "x" } },
      { id: "b", actionType: "", payload: "", label: "second", toolName: "studio.generateImage", toolArgs: { prompt: "${nonexistent.foo}" } },
    ]));
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain("unresolved-placeholder");
  });

  it("flags forward references (placeholder pointing at a later step)", () => {
    const r = critiquePlan(wf([
      { id: "a", actionType: "", payload: "", label: "first", toolName: "studio.generateImage", toolArgs: { prompt: "${b.foo}" } },
      { id: "b", actionType: "", payload: "", label: "second", toolName: "studio.generateImage", toolArgs: { prompt: "x" } },
    ]));
    const fwd = r.issues.find(i => i.code === "forward-reference");
    expect(fwd).toBeDefined();
    expect(fwd?.message).toMatch(/AFTER/);
  });

  it("accepts placeholders that point at a prior step", () => {
    const r = critiquePlan(wf([
      { id: "gen", actionType: "", payload: "", label: "gen", toolName: "studio.generateVideo", toolArgs: { prompt: "x" } },
      { id: "enh", actionType: "", payload: "", label: "enh", toolName: "studio.enhanceVideo", toolArgs: { video_url: "${gen.video_url}", operation: "upscale" } },
    ]));
    const placeholderIssues = r.issues.filter(
      i => i.code === "unresolved-placeholder" || i.code === "forward-reference"
    );
    expect(placeholderIssues).toEqual([]);
  });
});

describe("critiquePlan — prerequisites", () => {
  it("flags studio.changeVoice without an upstream cloneVoice", () => {
    const r = critiquePlan(wf([
      {
        actionType: "",
        payload: "",
        label: "change",
        toolName: "studio.changeVoice",
        toolArgs: { audio_url: "https://x" },
      },
    ]));
    const missing = r.issues.find(i => i.code === "missing-prerequisite");
    expect(missing).toBeDefined();
    expect(missing?.message).toMatch(/voice_id/);
  });

  it("does not flag changeVoice when voice_id is provided directly", () => {
    const r = critiquePlan(wf([
      {
        actionType: "",
        payload: "",
        label: "change",
        toolName: "studio.changeVoice",
        toolArgs: { audio_url: "https://x", voice_id: "voice_xyz" },
      },
    ]));
    expect(r.issues.find(i => i.code === "missing-prerequisite")).toBeUndefined();
  });
});

describe("critiquePlan — submit-without-prompt", () => {
  it("flags submit on a page with no prior fillPrompt", () => {
    const r = critiquePlan(wf([
      { path: "/studio", actionType: "submit", payload: "", label: "submit" },
    ]));
    const swp = r.issues.find(i => i.code === "submit-without-prompt");
    expect(swp).toBeDefined();
    expect(swp?.severity).toBe("warning");
  });

  it("does not flag submit when a fillPrompt on the same page came earlier", () => {
    const r = critiquePlan(wf([
      { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
      { path: "/studio", actionType: "submit", payload: "", label: "submit" },
    ]));
    expect(r.issues.find(i => i.code === "submit-without-prompt")).toBeUndefined();
  });
});

describe("critiquePlan — structural", () => {
  it("detects dependency cycles", () => {
    const r = critiquePlan(wf([
      { id: "a", actionType: "fillPrompt", payload: "x", label: "a", path: "/studio", dependsOn: ["b"] },
      { id: "b", actionType: "fillPrompt", payload: "y", label: "b", path: "/studio", dependsOn: ["a"] },
    ]));
    const cycle = r.issues.find(i => i.code === "dependency-cycle");
    expect(cycle).toBeDefined();
    expect(cycle?.message).toMatch(/a/);
    expect(cycle?.message).toMatch(/b/);
  });

  it("detects duplicate step ids", () => {
    const r = critiquePlan(wf([
      { id: "x", actionType: "fillPrompt", payload: "a", label: "a", path: "/studio" },
      { id: "x", actionType: "fillPrompt", payload: "b", label: "b", path: "/studio" },
    ]));
    expect(r.issues.find(i => i.code === "duplicate-step-id")).toBeDefined();
  });

  it("flags navigate-and-abandon plans", () => {
    const r = critiquePlan(wf([
      { actionType: "navigate", payload: "/studio", label: "go" },
      { actionType: "focusElement", payload: "promptInput", label: "focus" },
    ]));
    expect(r.issues.find(i => i.code === "navigate-and-abandon")).toBeDefined();
  });
});

describe("critiquePlan — score", () => {
  it("returns 100 with no issues for a healthy plan", () => {
    const r = critiquePlan(wf([
      { path: "/studio", actionType: "fillPrompt", payload: "scene", label: "fill" },
      { path: "/studio", actionType: "submit", payload: "", label: "submit" },
    ]));
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.shouldRefine).toBe(false);
  });

  it("sets shouldRefine when blockers exist", () => {
    const r = critiquePlan(wf([
      { actionType: "", payload: "", label: "x", toolName: "studio.notARealTool" },
    ]));
    expect(r.shouldRefine).toBe(true);
  });

  it("respects refineBelow threshold", () => {
    // One warning → score 92. With refineBelow=95 we expect refine.
    const r = critiquePlan(
      wf([
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ]),
      { refineBelow: 95 }
    );
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.shouldRefine).toBe(true);
  });
});

describe("buildCritiquePromptForLLM", () => {
  it("includes the score and at least one issue line", () => {
    const plan = wf([
      { actionType: "", payload: "", label: "x", toolName: "studio.notARealTool" },
    ]);
    const result = critiquePlan(plan);
    const prompt = buildCritiquePromptForLLM(plan, result);
    expect(prompt).toMatch(/分數：/);
    expect(prompt).toMatch(/UNKNOWN-TOOL|unknown-tool/i);
    expect(prompt).toMatch(/原始計畫/);
  });
});
