import { describe, expect, it } from "vitest";
import {
  buildImageWorkflow,
  detectCreationIntent,
  sanitiseBriefForPrompt,
} from "../../../shared/global-agent-workflows";

describe("sanitiseBriefForPrompt", () => {
  it("strips a trailing '請逐步問我描述' meta-instruction", () => {
    const out = sanitiseBriefForPrompt(
      "我要打造一個原創角色：先生成正面立繪。請逐步問我描述。"
    );
    expect(out).not.toMatch(/逐步問我描述/);
    expect(out).toMatch(/原創角色/);
  });

  it("strips a trailing '請問我' tail", () => {
    const out = sanitiseBriefForPrompt("做一支冥想短片。請問我細節。");
    expect(out).not.toMatch(/請問我/);
    expect(out).toMatch(/冥想短片/);
  });

  it("strips an English step-by-step suffix", () => {
    const out = sanitiseBriefForPrompt(
      "Create an original character — step by step please"
    );
    expect(out.toLowerCase()).not.toMatch(/step by step/);
    expect(out).toMatch(/original character/i);
  });

  it("collapses a 先...再...最後 multi-stage chain back to the headline goal", () => {
    const out = sanitiseBriefForPrompt(
      "我要打造一個原創角色，先在圖片創作室生成三視圖，再用這些圖在角色鍛造所訓練 LoRA，最後我能用這個 LoRA 一致性產角色"
    );
    expect(out).not.toMatch(/角色鍛造所訓練/);
    expect(out).toMatch(/原創角色/);
  });

  it("returns the trimmed original when input is just plain creative text", () => {
    const out = sanitiseBriefForPrompt(
      "森林晨霧，柔和側光，寬幅構圖，療癒風格"
    );
    expect(out).toBe("森林晨霧，柔和側光，寬幅構圖，療癒風格");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(sanitiseBriefForPrompt("")).toBe("");
    expect(sanitiseBriefForPrompt("   \n  ")).toBe("");
  });
});

describe("detectCreationIntent: step-by-step / multi-stage guard", () => {
  it("returns needs-clarification when the user explicitly asks 請逐步問我描述", () => {
    const result = detectCreationIntent(
      "我要打造一個原創角色，生成一張圖片。請逐步問我描述。"
    );
    expect(result.kind).toBe("needs-clarification");
    if (result.kind !== "needs-clarification") return;
    expect(result.message).toMatch(/慢慢來|聚焦/);
    expect(result.options?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns needs-clarification on a 先...再...最後 multi-stage description", () => {
    const result = detectCreationIntent(
      "我要生成一張圖片：先做三視圖，再訓練 LoRA，最後產一致角色"
    );
    expect(result.kind).toBe("needs-clarification");
    if (result.kind !== "needs-clarification") return;
    expect(result.options?.some(o => /先聚焦|逐步/.test(o))).toBe(true);
  });

  it("still returns ready for a single-stage image request", () => {
    const result = detectCreationIntent(
      "幫我做一張森林晨霧的療癒風景圖片"
    );
    expect(result.kind).toBe("ready");
  });

  it("still returns ready for a single-stage music request without step-by-step markers", () => {
    const result = detectCreationIntent(
      "幫我做一段 60 秒的療癒背景音樂"
    );
    expect(result.kind).toBe("ready");
  });
});

describe("buildImageWorkflow: prompt cleanliness regression guard", () => {
  it("does NOT inline the 'please ask me step by step' tail into the fillPrompt step", () => {
    const wf = buildImageWorkflow(
      "我要打造一個原創角色，先生成三視圖。請逐步問我描述。"
    );
    const fillStep = wf.steps.find(s => s.actionType === "fillPrompt");
    expect(fillStep).toBeDefined();
    expect(fillStep?.payload).not.toMatch(/請逐步問我描述/);
    expect(fillStep?.payload).not.toMatch(/逐步問我描述/);
  });

  it("falls back to a sane default when the brief is pure noise", () => {
    const wf = buildImageWorkflow("請逐步問我描述");
    const fillStep = wf.steps.find(s => s.actionType === "fillPrompt");
    expect(fillStep?.payload).toMatch(/電影感|療癒|風景/);
  });
});
