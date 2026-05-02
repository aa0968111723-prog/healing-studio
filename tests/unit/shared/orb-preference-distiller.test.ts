/**
 * tests/unit/shared/orb-preference-distiller.test.ts
 *
 * Module 2 — preference distiller:
 *   1. Aggregates accept/reject ratios per actionType.
 *   2. Extracts model preferences from OrbMemory tags + metadata.
 *   3. Pacing tier reflects feedback timing (fast / slow).
 *   4. Confidence ramps logarithmically.
 *   5. serializePreferenceProfileForPrompt produces a compact prompt block.
 *   6. suggestAutoApproveActions uses the documented threshold.
 */
import { describe, expect, it } from "vitest";
import type { AgentFeedbackEvent } from "../../../shared/agent-actions";
import type { OrbMemory } from "../../../shared/orb-memory";
import {
  distillPreferenceProfile,
  serializePreferenceProfileForPrompt,
  suggestAutoApproveActions,
} from "../../../shared/orb-preference-distiller";

function ev(over: Partial<AgentFeedbackEvent> = {}): AgentFeedbackEvent {
  return {
    at: 0,
    status: "accepted",
    actionType: "fillPrompt",
    ...over,
  };
}

function memory(over: Partial<OrbMemory>): OrbMemory {
  return {
    memoryId: "m1",
    traceId: "t1",
    type: "model_preference",
    summary: "user likes flux",
    source: "router",
    confidence: 0.9,
    tags: [],
    createdAt: 0,
    metadata: {},
    ...over,
  };
}

describe("distillPreferenceProfile — action acceptance", () => {
  it("aggregates accepted vs rejected counts per actionType", () => {
    const events: AgentFeedbackEvent[] = [
      ev({ actionType: "fillPrompt", status: "accepted" }),
      ev({ actionType: "fillPrompt", status: "completed" }),
      ev({ actionType: "fillPrompt", status: "cancelled" }),
      ev({ actionType: "submit", status: "accepted" }),
      ev({ actionType: "submit", status: "failed" }),
    ];
    const p = distillPreferenceProfile({ feedbackEvents: events });
    expect(p.actionAcceptance.fillPrompt).toEqual({
      accepted: 2,
      rejected: 1,
      ratio: 2 / 3,
    });
    expect(p.actionAcceptance.submit).toEqual({
      accepted: 1,
      rejected: 1,
      ratio: 0.5,
    });
    expect(p.totalEvents).toBe(5);
  });

  it("treats 'edited' as a positive signal (the user kept the action's intent)", () => {
    // Distinct timestamps so the per-event dedup doesn't fold them.
    const p = distillPreferenceProfile({
      feedbackEvents: [
        ev({ at: 100, actionType: "fillPrompt", status: "edited" }),
        ev({ at: 200, actionType: "fillPrompt", status: "edited" }),
      ],
    });
    expect(p.actionAcceptance.fillPrompt.accepted).toBe(2);
    expect(p.actionAcceptance.fillPrompt.ratio).toBe(1);
  });

  it("dedups identical events that exist in both session + DB streams", () => {
    const e = ev({ at: 100, actionType: "submit", status: "accepted" });
    const p = distillPreferenceProfile({ feedbackEvents: [e, e, e] });
    expect(p.totalEvents).toBe(1);
  });
});

describe("distillPreferenceProfile — model preferences", () => {
  it("extracts preferred models from model_preference + successful_workflow tags", () => {
    const memories: OrbMemory[] = [
      memory({ type: "model_preference", tags: ["fal-ai/flux/dev"], memoryId: "1" }),
      memory({
        type: "successful_workflow",
        tags: ["fal-ai/flux/dev", "fal-ai/kling-video/v2.1"],
        memoryId: "2",
      }),
      memory({
        type: "model_preference",
        tags: [],
        metadata: { modelId: "fal-ai/flux/dev" },
        memoryId: "3",
      }),
    ];
    const p = distillPreferenceProfile({ memories });
    // Flux appears 3 times, kling once → flux first.
    expect(p.preferredModels[0]).toBe("fal-ai/flux/dev");
    expect(p.preferredModels).toContain("fal-ai/kling-video/v2.1");
  });

  it("records avoided models from failed_workflow", () => {
    const memories: OrbMemory[] = [
      memory({ type: "failed_workflow", tags: ["fal-ai/bad-model"], memoryId: "x" }),
    ];
    const p = distillPreferenceProfile({ memories });
    expect(p.avoidedModels).toContain("fal-ai/bad-model");
  });
});

describe("distillPreferenceProfile — pacing tier", () => {
  it("flags impatient users when mean inter-event delta is short", () => {
    const events: AgentFeedbackEvent[] = [
      ev({ at: 0, status: "accepted" }),
      ev({ at: 1500, status: "accepted" }),
      ev({ at: 3000, status: "accepted" }),
    ];
    const p = distillPreferenceProfile({ feedbackEvents: events });
    expect(p.pacingTier).toBe("impatient");
  });

  it("flags patient users when mean delta is long", () => {
    const events: AgentFeedbackEvent[] = [
      ev({ at: 0, status: "accepted" }),
      ev({ at: 30_000, status: "accepted" }),
      ev({ at: 60_000, status: "accepted" }),
    ];
    const p = distillPreferenceProfile({ feedbackEvents: events });
    expect(p.pacingTier).toBe("patient");
  });

  it("returns balanced for sparse history", () => {
    const p = distillPreferenceProfile({ feedbackEvents: [ev({ at: 0 })] });
    expect(p.pacingTier).toBe("balanced");
  });
});

describe("distillPreferenceProfile — confidence", () => {
  it("returns 0 when there is no signal at all", () => {
    const p = distillPreferenceProfile({});
    expect(p.confidence).toBe(0);
  });

  it("ramps with sample size but never reaches 1.0", () => {
    const events: AgentFeedbackEvent[] = Array.from({ length: 30 }, (_, i) =>
      ev({ at: i * 10_000, actionType: "fillPrompt", status: "accepted" })
    );
    const p = distillPreferenceProfile({ feedbackEvents: events });
    expect(p.confidence).toBeGreaterThan(0.6);
    expect(p.confidence).toBeLessThan(1);
  });
});

describe("serializePreferenceProfileForPrompt", () => {
  it("returns empty string when there is no signal", () => {
    expect(
      serializePreferenceProfileForPrompt(distillPreferenceProfile({}))
    ).toBe("");
  });

  it("renders top action acceptance + model preferences", () => {
    const events: AgentFeedbackEvent[] = [
      ev({ actionType: "fillPrompt", status: "accepted" }),
      ev({ actionType: "fillPrompt", status: "accepted" }),
      ev({ actionType: "submit", status: "cancelled" }),
    ];
    const memories: OrbMemory[] = [
      memory({ type: "model_preference", tags: ["fal-ai/flux/dev"] }),
    ];
    const profile = distillPreferenceProfile({ feedbackEvents: events, memories });
    const block = serializePreferenceProfileForPrompt(profile);
    expect(block).toContain("動作接受率");
    expect(block).toContain("fillPrompt");
    expect(block).toContain("fal-ai/flux/dev");
    expect(block).toContain("節奏");
  });
});

describe("suggestAutoApproveActions", () => {
  it("returns actionTypes with >=70% acceptance and >=4 trials", () => {
    const events: AgentFeedbackEvent[] = [];
    // 5 accepted fillPrompt → ratio 1.0, total 5 → qualifies.
    for (let i = 0; i < 5; i++) events.push(ev({ at: i, actionType: "fillPrompt", status: "accepted" }));
    // 2 accepted submit → not enough trials.
    events.push(ev({ at: 100, actionType: "submit", status: "accepted" }));
    events.push(ev({ at: 101, actionType: "submit", status: "accepted" }));
    const p = distillPreferenceProfile({ feedbackEvents: events });
    const auto = suggestAutoApproveActions(p);
    expect(auto).toContain("fillPrompt");
    expect(auto).not.toContain("submit");
  });
});
