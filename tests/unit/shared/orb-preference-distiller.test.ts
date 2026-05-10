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

// ─── agent_model_picks integration ──────────────────────────────────────
//
// These pin the bridge that lets 導演 AI 與 全站光球 share a single model
// preference signal: picks the user makes anywhere on the site land in
// `agent_model_picks`, the chat router aggregates them once per turn, and
// the distiller folds them into the same `preferredModels` list it
// already builds from OrbMemory.

describe("distillPreferenceProfile — agent_model_picks merge", () => {
  it("includes a high-pickCount modelId in preferredModels even with no memory rows", () => {
    const profile = distillPreferenceProfile({
      agentModelPicks: [
        { modelId: "fal-ai/flux/schnell", pickCount: 6, acceptedCount: 4 },
        { modelId: "fal-ai/sdxl", pickCount: 2, acceptedCount: 1 },
      ],
    });
    expect(profile.preferredModels[0]).toBe("fal-ai/flux/schnell");
    expect(profile.preferredModels).toContain("fal-ai/sdxl");
  });

  it("weights acceptedCount more heavily than raw pickCount", () => {
    // Model A: high pickCount, zero acceptance → still a "tried, rejected"
    //   fallback, not the leader.
    // Model B: half the picks but every one accepted → should win.
    const profile = distillPreferenceProfile({
      agentModelPicks: [
        { modelId: "model-a", pickCount: 4, acceptedCount: 0 },
        { modelId: "model-b", pickCount: 3, acceptedCount: 3 },
      ],
    });
    // Score: A = 0*2 + (4-0)*1 = 4 ; B = 3*2 + 0 = 6 → B wins.
    expect(profile.preferredModels[0]).toBe("model-b");
    // Model A picked >=2 times but never accepted → drops into avoided list.
    expect(profile.avoidedModels).toContain("model-a");
  });

  it("keeps memories' model signals AND picks in the same ranked list", () => {
    const memories: OrbMemory[] = [
      memory({
        type: "model_preference",
        tags: ["fal-ai/legacy-model"],
      }),
    ];
    const profile = distillPreferenceProfile({
      memories,
      agentModelPicks: [
        { modelId: "fal-ai/flux/schnell", pickCount: 5, acceptedCount: 3 },
      ],
    });
    expect(profile.preferredModels).toContain("fal-ai/flux/schnell");
    expect(profile.preferredModels).toContain("fal-ai/legacy-model");
    expect(profile.preferredModels[0]).toBe("fal-ai/flux/schnell");
  });

  it("treats picks as evidence for confidence (no longer a cold start)", () => {
    const cold = distillPreferenceProfile({});
    expect(cold.confidence).toBe(0);
    const withPicks = distillPreferenceProfile({
      agentModelPicks: [
        { modelId: "x", pickCount: 8, acceptedCount: 5 },
      ],
    });
    expect(withPicks.confidence).toBeGreaterThan(0);
    expect(withPicks.totalMemoriesConsidered).toBe(8);
  });

  it("ignores empty modelId / zero pickCount entries", () => {
    const profile = distillPreferenceProfile({
      agentModelPicks: [
        { modelId: "", pickCount: 99, acceptedCount: 99 },
        { modelId: "junk", pickCount: 0, acceptedCount: 0 },
        { modelId: "fal-ai/flux/schnell", pickCount: 3, acceptedCount: 2 },
      ],
    });
    expect(profile.preferredModels).toEqual(["fal-ai/flux/schnell"]);
  });
});
