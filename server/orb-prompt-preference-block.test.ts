/**
 * server/orb-prompt-preference-block.test.ts
 *
 * Integration: `buildOrbSystemPrompt` injects the distilled-preference
 * block from `recentFeedback` + `recentMemories` (Phase B wiring).
 */
import { describe, expect, it } from "vitest";
import type { OrbMemory } from "../shared/orb-memory";
import { buildOrbSystemPrompt } from "./services/siteKnowledge";

function feedbackEvents(count: number, status: "accepted" | "cancelled" = "accepted") {
  return Array.from({ length: count }, (_, i) => ({
    at: i * 10_000,
    actionType: "fillPrompt" as const,
    status,
    note: undefined,
  }));
}

describe("buildOrbSystemPrompt — distilled preference block", () => {
  it("omits the block when there is no signal", () => {
    const prompt = buildOrbSystemPrompt("creative");
    expect(prompt).not.toMatch(/蒸餾後的使用者偏好/);
  });

  it("includes the distilled block when feedback events are passed", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      recentFeedback: feedbackEvents(5, "accepted"),
    });
    expect(prompt).toMatch(/蒸餾後的使用者偏好/);
    expect(prompt).toMatch(/動作接受率/);
    expect(prompt).toMatch(/節奏/);
  });

  it("surfaces auto-approve hints when an action has ≥ 70% accept over ≥ 4 trials", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      recentFeedback: feedbackEvents(5, "accepted"),
    });
    expect(prompt).toMatch(/可自動接受/);
    expect(prompt).toMatch(/fillPrompt/);
  });

  it("includes preferred models from memory when present", () => {
    const memories: OrbMemory[] = [
      {
        memoryId: "m1",
        traceId: "t1",
        type: "model_preference",
        summary: "loves flux",
        source: "router",
        confidence: 0.9,
        tags: ["fal-ai/flux/dev"],
        createdAt: 1,
        metadata: {},
      },
      {
        memoryId: "m2",
        traceId: "t2",
        type: "successful_workflow",
        summary: "video pipeline",
        source: "router",
        confidence: 0.9,
        tags: ["fal-ai/flux/dev"],
        createdAt: 2,
        metadata: {},
      },
    ];
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      recentMemories: memories,
    });
    expect(prompt).toMatch(/偏好模型/);
    expect(prompt).toMatch(/fal-ai\/flux\/dev/);
  });
});
