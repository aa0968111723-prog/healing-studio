import { describe, expect, it } from "vitest";
import {
  inferStudioModelCandidatesFromPrompt,
  STUDIO_MODEL_KNOWLEDGE_REGISTRY,
  summarizeStudioModelKnowledgeForAgent,
} from "../shared/studioModelIntelligence";

describe("studio model intelligence registry", () => {
  it("builds a non-empty registry from fal catalog", () => {
    expect(STUDIO_MODEL_KNOWLEDGE_REGISTRY.length).toBeGreaterThan(0);
  });

  it("infers video-aligned models from video-like prompts", () => {
    const candidates = inferStudioModelCandidatesFromPrompt("幫我做 30 秒 cinematic video 預告片", 5);
    expect(candidates.some(item => item.category === "text-to-video")).toBe(true);
  });

  it("falls back to text-to-image when no hints are found", () => {
    const candidates = inferStudioModelCandidatesFromPrompt("zzqv-non-sense", 3);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(item => item.category === "text-to-image")).toBe(true);
  });

  it("summary is valid json", () => {
    expect(() => JSON.parse(summarizeStudioModelKnowledgeForAgent())).not.toThrow();
  });
});
