/**
 * multiAgentDetector.test.ts — Unit tests for multi-agent detection heuristics
 */

import { describe, it, expect } from "vitest";
import { detectMultiAgentNeed, isObviouslySingleAgentTask } from "../multiAgentDetector";

describe("detectMultiAgentNeed", () => {
  it("should detect multi-modality tasks (video + music)", () => {
    const result = detectMultiAgentNeed({
      userMessage: "製作一個10秒的貓咪影片，配上歡快的音樂",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.suggestedAgents).toContain("director");
    expect(result.suggestedAgents).toContain("video-specialist");
    expect(result.suggestedAgents).toContain("music-specialist");
  });

  it("should detect image + 3D combination", () => {
    const result = detectMultiAgentNeed({
      userMessage: "生成一張角色圖片，然後做成3D模型",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.suggestedAgents).toContain("image-specialist");
  });

  it("should detect video + voice combination", () => {
    const result = detectMultiAgentNeed({
      userMessage: "Create a video with voice narration",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.suggestedAgents).toContain("video-specialist");
    expect(result.suggestedAgents).toContain("voice-specialist");
  });

  it("should detect explicit collaboration keywords", () => {
    const result = detectMultiAgentNeed({
      userMessage: "生成一張圖片，然後再加上音效",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.reason).toContain("協作");
  });

  it("should detect multi-step workflow", () => {
    const result = detectMultiAgentNeed({
      userMessage: "第一步生成圖片，第二步生成影片",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.reason).toContain("步驟");
  });

  it("should detect complex creation patterns", () => {
    const result = detectMultiAgentNeed({
      userMessage: "製作一個短影片，加上背景音樂和配音",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("should detect training + generation workflow", () => {
    const result = detectMultiAgentNeed({
      userMessage: "訓練一個LoRA模型，然後用它生成圖片",
    });

    expect(result.shouldCollaborate).toBe(true);
    expect(result.suggestedAgents).toContain("training-specialist");
  });

  it("should NOT trigger collaboration for simple single-modality tasks", () => {
    const result = detectMultiAgentNeed({
      userMessage: "生成一張貓咪的圖片",
    });

    expect(result.shouldCollaborate).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("should NOT trigger collaboration for simple video generation", () => {
    const result = detectMultiAgentNeed({
      userMessage: "生成一個10秒的風景影片",
    });

    expect(result.shouldCollaborate).toBe(false);
  });

  it("should NOT trigger collaboration for pure music generation", () => {
    const result = detectMultiAgentNeed({
      userMessage: "生成一首歡快的背景音樂",
    });

    expect(result.shouldCollaborate).toBe(false);
  });
});

describe("isObviouslySingleAgentTask", () => {
  it("should detect very short simple requests", () => {
    expect(isObviouslySingleAgentTask("生成圖")).toBe(true);
  });

  it("should detect simple image generation patterns", () => {
    expect(isObviouslySingleAgentTask("產生一張圖片")).toBe(true);
    expect(isObviouslySingleAgentTask("generate an image")).toBe(true);
  });

  it("should NOT classify complex requests as obviously simple", () => {
    expect(isObviouslySingleAgentTask("生成一張圖片，然後做成影片")).toBe(false);
    expect(isObviouslySingleAgentTask("製作帶音樂的影片")).toBe(false);
  });

  it("should NOT classify long messages as obviously simple", () => {
    const longMessage = "請幫我生成一張高品質的貓咪圖片，要有陽光灑落的感覺";
    expect(isObviouslySingleAgentTask(longMessage)).toBe(false);
  });
});
