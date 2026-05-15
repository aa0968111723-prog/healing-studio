import { describe, it, expect } from "vitest";
import {
  composeWorkflow,
  estimateWorkflowBudget,
  suggestHandoff,
  refineWorkflowMechanically,
  getDirectorHandoffCatalog,
} from "./services/spiritTools/directorTools";
import type { RunWorkflowAction } from "../shared/agent-actions";

/**
 * Regression-style tests for the 4 new director.* agent tools.
 *
 * These cover the pure-data primitives that turn 導導 into a real AI agent
 * (composeWorkflow / estimateBudget / suggestHandoff / refineWorkflow). The
 * LLM-driven dispatch wrapper around them is exercised separately via the
 * tool registry tests in director-orb-tool.test.ts.
 */

describe("directorTools.composeWorkflow", () => {
  it("infers short_video kind for video-leaning briefs and produces 4 steps", () => {
    const out = composeWorkflow({ brief: "幫我做一支 30s IG Reels 短影音" });
    expect(out.kind).toBe("short_video");
    expect(out.workflow.type).toBe("runWorkflow");
    expect(out.workflow.steps.length).toBe(4);
    // 步驟序：image → video → voice → music（video 必須 dependsOn image）
    const stepIds = out.workflow.steps.map(s => s.id);
    expect(stepIds).toEqual(["step_image", "step_video", "step_voice", "step_music"]);
    const videoStep = out.workflow.steps.find(s => s.id === "step_video");
    expect(videoStep?.dependsOn).toEqual(["step_image"]);
    // i2v 必須引用 step_image 的 image_url
    expect(videoStep?.toolArgs?.image_url).toBe("${step_image.image_url}");
  });

  it("infers image_only for image-leaning briefs", () => {
    const out = composeWorkflow({ brief: "幫我畫一張電影感的海報" });
    expect(out.kind).toBe("image_only");
    expect(out.workflow.steps).toHaveLength(1);
    expect(out.workflow.steps[0].toolName).toBe("studio.generateImage");
  });

  it("infers music_only for music-leaning briefs", () => {
    const out = composeWorkflow({ brief: "我需要一段 30 秒 BGM" });
    expect(out.kind).toBe("music_only");
    expect(out.workflow.steps[0].toolName).toBe("studio.generateAudio");
  });

  it("infers tiktok platform from brief and sets 9:16 aspect", () => {
    const out = composeWorkflow({ brief: "幫我做一支 TikTok 抖音影片" });
    const imageStep = out.workflow.steps.find(s => s.id === "step_image");
    expect(imageStep?.toolArgs?.aspect_ratio).toBe("9:16");
    const videoStep = out.workflow.steps.find(s => s.id === "step_video");
    expect(videoStep?.toolArgs?.aspect_ratio).toBe("9:16");
    // tiktok 預設 15s
    expect(videoStep?.toolArgs?.duration).toBe(15);
  });

  it("cheap budgetMode swaps to draft-tier models (schnell / wan / stable-audio / kokoro)", () => {
    const out = composeWorkflow({
      brief: "幫我做一支 30s 短影音",
      budgetMode: "cheap",
    });
    const models = out.workflow.steps.map(s => s.toolArgs?.modelId).filter(Boolean);
    expect(models).toContain("fal-ai/flux/schnell");
    expect(models).toContain("fal-ai/wan-i2v");
    expect(models).toContain("fal-ai/stable-audio");
    expect(models).toContain("fal-ai/kokoro/american-english");
  });

  it("annotates handoffs to the right specialist per step", () => {
    const out = composeWorkflow({ brief: "幫我做一支短影片" });
    const map = Object.fromEntries(out.handoffs.map(h => [h.stepId, h.spirit]));
    expect(map.step_image).toBe("image-specialist");
    expect(map.step_video).toBe("video-specialist");
    expect(map.step_voice).toBe("voice-specialist");
    expect(map.step_music).toBe("music-specialist");
  });

  it("stepByStep=true sets confirmationMode for the user-approval gate", () => {
    const out = composeWorkflow({ brief: "幫我做一張圖", stepByStep: true });
    expect(out.workflow.confirmationMode).toBe("step-by-step");
  });
});

describe("directorTools.estimateWorkflowBudget", () => {
  it("sums points across all steps with known models", () => {
    const composed = composeWorkflow({
      brief: "幫我做一支 30s 短影音",
      budgetMode: "balanced",
    });
    const report = estimateWorkflowBudget({ steps: composed.workflow.steps });
    expect(report.totalPoints).toBeGreaterThan(0);
    expect(report.stepBudgets).toHaveLength(4);
    expect(report.totalUsd).toMatch(/^\$\d+\.\d+$/);
    // 每步都有 estimate（包含 breakdown 字串）
    for (const step of report.stepBudgets) {
      expect(typeof step.estimate.breakdown).toBe("string");
    }
  });

  it("suggests draft-tier substitutes for premium models (FLUX Pro → schnell, Kling Pro → Wan)", () => {
    const composed = composeWorkflow({
      brief: "幫我做一支 30s 短影音",
      budgetMode: "balanced",
    });
    const report = estimateWorkflowBudget({ steps: composed.workflow.steps });
    const fromModels = report.savingsSuggestions.map(s => s.fromModel);
    // 至少 image / video 應有替代建議
    expect(fromModels).toContain("fal-ai/flux-pro/v1.1");
    expect(fromModels).toContain("fal-ai/kling-video/v2.1/standard/image-to-video");
    for (const s of report.savingsSuggestions) {
      expect(s.savedPoints).toBeGreaterThan(0);
    }
  });

  it("cheap budgetMode produces no further savings suggestions (already cheapest tier)", () => {
    const composed = composeWorkflow({
      brief: "幫我做一支 30s 短影音",
      budgetMode: "cheap",
    });
    const report = estimateWorkflowBudget({ steps: composed.workflow.steps });
    expect(report.savingsSuggestions).toHaveLength(0);
  });

  it("handles steps with no modelId (UI-only steps) as 0 pts", () => {
    const steps: RunWorkflowAction["steps"] = [
      {
        id: "step_nav",
        path: "/image-studio",
        actionType: "navigate",
        payload: "",
        label: "帶到圖像工作室",
      },
    ];
    const report = estimateWorkflowBudget({ steps });
    expect(report.totalPoints).toBe(0);
    expect(report.stepBudgets[0].modelId).toBeNull();
  });
});

describe("directorTools.suggestHandoff", () => {
  it("defaults fromRole=director and returns a chain starting with director", () => {
    const out = suggestHandoff({ userIntent: "幫我規劃做一支短影音" });
    expect(out.chain[0]).toBe("director");
    expect(out.chain.length).toBeGreaterThan(1);
    expect(out.chainNicknames[0]).toBe("@導導");
  });

  it("hintTokens=video routes downstream chain through video specialist", () => {
    const out = suggestHandoff({
      fromRole: "director",
      userIntent: "幫我規劃影片",
      hintTokens: ["video", "plan"],
      maxDepth: 4,
    });
    expect(out.chain).toContain("video-specialist");
  });

  it("mutedRoles drops the target from the chain", () => {
    const baseline = suggestHandoff({
      userIntent: "幫我規劃影片",
      hintTokens: ["video"],
    });
    expect(baseline.chain).toContain("video-specialist");
    const muted = suggestHandoff({
      userIntent: "幫我規劃影片",
      hintTokens: ["video"],
      mutedRoles: ["video-specialist"],
    });
    expect(muted.chain).not.toContain("video-specialist");
  });

  it("returns a human-readable primaryRationale when a handoff is found", () => {
    const out = suggestHandoff({ userIntent: "排計畫" });
    expect(out.primaryRationale).toBeTruthy();
    expect(out.primaryRationale).toMatch(/@\S+/); // 點名某位精靈
  });
});

describe("directorTools.refineWorkflowMechanically", () => {
  function baselineWorkflow(): RunWorkflowAction {
    return composeWorkflow({ brief: "幫我做一支短影音" }).workflow;
  }

  it("remove_step deletes the target step and cleans dependent dependsOn", () => {
    const wf = baselineWorkflow();
    const result = refineWorkflowMechanically({
      workflow: wf,
      operations: [{ op: "remove_step", stepId: "step_image" }],
    });
    expect(result.applied[0].ok).toBe(true);
    expect(result.workflow.steps.find(s => s.id === "step_image")).toBeUndefined();
    // step_video 原本 dependsOn=[step_image] — 應被清空（避免拓撲死結）
    const videoStep = result.workflow.steps.find(s => s.id === "step_video");
    expect(videoStep?.dependsOn).toBeUndefined();
  });

  it("swap_model replaces modelId on the target step", () => {
    const wf = baselineWorkflow();
    const result = refineWorkflowMechanically({
      workflow: wf,
      operations: [
        { op: "swap_model", stepId: "step_video", modelId: "fal-ai/wan-i2v" },
      ],
    });
    expect(result.applied[0].ok).toBe(true);
    const videoStep = result.workflow.steps.find(s => s.id === "step_video");
    expect(videoStep?.toolArgs?.modelId).toBe("fal-ai/wan-i2v");
  });

  it("set_confirmation updates workflow-level confirmationMode", () => {
    const wf = baselineWorkflow();
    const result = refineWorkflowMechanically({
      workflow: wf,
      operations: [{ op: "set_confirmation", mode: "step-by-step" }],
    });
    expect(result.workflow.confirmationMode).toBe("step-by-step");
  });

  it("set_step_param merges into existing toolArgs without dropping others", () => {
    const wf = baselineWorkflow();
    const result = refineWorkflowMechanically({
      workflow: wf,
      operations: [
        { op: "set_step_param", stepId: "step_video", key: "duration", value: 10 },
      ],
    });
    const videoStep = result.workflow.steps.find(s => s.id === "step_video");
    expect(videoStep?.toolArgs?.duration).toBe(10);
    // modelId 不能被洗掉
    expect(typeof videoStep?.toolArgs?.modelId).toBe("string");
  });

  it("returns ok=false when target stepId does not exist (caller can fall back to LLM)", () => {
    const wf = baselineWorkflow();
    const result = refineWorkflowMechanically({
      workflow: wf,
      operations: [{ op: "remove_step", stepId: "no-such-step" }],
    });
    expect(result.applied[0].ok).toBe(false);
    expect(result.applied[0].reason).toContain("step not found");
  });

  it("does not mutate the original workflow object", () => {
    const wf = baselineWorkflow();
    const originalLength = wf.steps.length;
    refineWorkflowMechanically({
      workflow: wf,
      operations: [{ op: "remove_step", stepId: "step_image" }],
    });
    expect(wf.steps).toHaveLength(originalLength);
  });
});

describe("directorTools.getDirectorHandoffCatalog", () => {
  it("returns the protocol's full handoff catalog with nicknames", () => {
    const catalog = getDirectorHandoffCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry.nickname.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.when.length).toBeGreaterThan(0);
    }
    // 至少包含基礎協作鏈：plan-executor / composer / critic / accountant
    const targets = catalog.map(e => e.to);
    expect(targets).toContain("plan-executor");
    expect(targets).toContain("composer");
    expect(targets).toContain("critic");
    expect(targets).toContain("accountant");
  });
});
