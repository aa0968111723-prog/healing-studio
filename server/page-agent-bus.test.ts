/**
 * page-agent-bus.test.ts — Phase 1 光球代理人動作 bus 的純邏輯測試
 *
 * 僅測 shared/agent-actions.ts 暴露的純函式：
 *   - coerceAgentAction（LLM / 舊事件 detail → 嚴格 AgentAction）
 *   - parseLLMActions（過濾無效項）
 *   - enqueueAction / drainActionsForPage（pending queue 行為）
 *
 * 不依賴 React / DOM，因此可直接在 server vitest 環境執行。
 */
import { describe, it, expect } from "vitest";
import {
  coerceAgentAction,
  drainActionsForPage,
  enqueueAction,
  parseLLMActions,
  PENDING_ACTION_TTL_MS,
  type AgentAction,
  type PendingAction,
} from "../shared/agent-actions";

// ─── coerceAgentAction ───────────────────────────────────────────────────

describe("coerceAgentAction", () => {
  it("parses fillPrompt with required text", () => {
    const out = coerceAgentAction({ type: "fillPrompt", text: "一隻貓" });
    expect(out).toEqual({
      type: "fillPrompt",
      text: "一隻貓",
      append: false,
      slot: undefined,
    });
  });

  it("rejects fillPrompt without text", () => {
    expect(coerceAgentAction({ type: "fillPrompt" })).toBeNull();
  });

  it("accepts append flag and slot for fillPrompt", () => {
    const out = coerceAgentAction({
      type: "fillPrompt",
      text: "尾段補充",
      append: true,
      slot: "negativePrompt",
    });
    expect(out).toMatchObject({ append: true, slot: "negativePrompt" });
  });

  it("parses setModel with modelId", () => {
    expect(coerceAgentAction({ type: "setModel", modelId: "nanoBanana2" }))
      .toEqual({ type: "setModel", modelId: "nanoBanana2" });
  });

  it("parses setModel using legacy payload field (LLM fallback)", () => {
    expect(coerceAgentAction({ type: "setModel", payload: "fluxKontext" }))
      .toEqual({ type: "setModel", modelId: "fluxKontext" });
  });

  it("parses setModality and legacy 'modality' type alias", () => {
    expect(coerceAgentAction({ type: "setModality", modality: "video" }))
      .toEqual({ type: "setModality", modality: "video" });
    expect(coerceAgentAction({ type: "modality", payload: "voice" }))
      .toEqual({ type: "setModality", modality: "voice" });
  });

  it("rejects setModality with unknown value", () => {
    expect(
      coerceAgentAction({ type: "setModality", modality: "hologram" })
    ).toBeNull();
  });

  it("parses legacy 'generate' → submit", () => {
    expect(coerceAgentAction({ type: "generate" })).toEqual({ type: "submit" });
  });

  it("parses legacy 'preset' → applyPreset", () => {
    expect(coerceAgentAction({ type: "preset", payload: "寧靜森林" }))
      .toEqual({ type: "applyPreset", presetId: "寧靜森林" });
  });

  it("parses legacy 'focus' → focusElement", () => {
    expect(coerceAgentAction({ type: "focus", payload: "generate-button" }))
      .toEqual({ type: "focusElement", elementId: "generate-button", message: undefined });
  });

  it("returns null for unknown type", () => {
    expect(coerceAgentAction({ type: "launchRockets" })).toBeNull();
  });

  it("returns null for non-object inputs", () => {
    expect(coerceAgentAction(null)).toBeNull();
    expect(coerceAgentAction("string")).toBeNull();
    expect(coerceAgentAction(42)).toBeNull();
  });
});

// ─── parseLLMActions ─────────────────────────────────────────────────────

describe("parseLLMActions", () => {
  it("returns [] for non-array input", () => {
    expect(parseLLMActions(null)).toEqual([]);
    expect(parseLLMActions("not an array")).toEqual([]);
    expect(parseLLMActions({ type: "fillPrompt", text: "hi" })).toEqual([]);
  });

  it("filters out invalid entries but keeps valid ones", () => {
    const raw = [
      { type: "fillPrompt", text: "hello" },
      { type: "unknownKind" },
      { type: "setModel", modelId: "flux" },
      null,
      { type: "setModality", modality: "invalid" },
      { type: "submit" },
    ];
    const out = parseLLMActions(raw);
    expect(out).toHaveLength(3);
    expect(out.map(a => a.type)).toEqual(["fillPrompt", "setModel", "submit"]);
  });
});

// ─── enqueueAction ───────────────────────────────────────────────────────

describe("enqueueAction", () => {
  const now = 1_700_000_000_000;

  it("appends when queue is empty", () => {
    const next = enqueueAction([], {
      action: { type: "fillPrompt", text: "a" },
      createdAt: now,
    });
    expect(next).toHaveLength(1);
  });

  it("dedups same-slot fillPrompt (last-write wins)", () => {
    const q1 = enqueueAction([], {
      action: { type: "fillPrompt", text: "first", slot: "prompt" },
      createdAt: now,
    });
    const q2 = enqueueAction(q1, {
      action: { type: "fillPrompt", text: "second", slot: "prompt" },
      createdAt: now + 10,
    });
    expect(q2).toHaveLength(1);
    expect((q2[0].action as { text: string }).text).toBe("second");
  });

  it("keeps fillPrompt with distinct slots separate", () => {
    const q1 = enqueueAction([], {
      action: { type: "fillPrompt", text: "main", slot: "prompt" },
      createdAt: now,
    });
    const q2 = enqueueAction(q1, {
      action: { type: "fillPrompt", text: "neg", slot: "negativePrompt" },
      createdAt: now + 10,
    });
    expect(q2).toHaveLength(2);
  });

  it("dedups setParam on same key", () => {
    const q1 = enqueueAction([], {
      action: { type: "setParam", key: "cfg", value: 3 },
      createdAt: now,
    });
    const q2 = enqueueAction(q1, {
      action: { type: "setParam", key: "cfg", value: 7 },
      createdAt: now + 10,
    });
    expect(q2).toHaveLength(1);
    expect((q2[0].action as { value: number }).value).toBe(7);
  });

  it("dedups setTab / setMode / setModel by type (only one pending at a time)", () => {
    const q1 = enqueueAction([], {
      action: { type: "setTab", tabId: "t2i" },
      createdAt: now,
    });
    const q2 = enqueueAction(q1, {
      action: { type: "setTab", tabId: "i2i" },
      createdAt: now + 10,
    });
    expect(q2).toHaveLength(1);
    expect((q2[0].action as { tabId: string }).tabId).toBe("i2i");
  });
});

// ─── drainActionsForPage ─────────────────────────────────────────────────

describe("drainActionsForPage", () => {
  const now = 2_000_000_000_000;

  const make = (
    action: AgentAction,
    opts: { targetPageId?: string; createdAt?: number } = {}
  ): PendingAction => ({
    action,
    targetPageId: opts.targetPageId,
    createdAt: opts.createdAt ?? now,
  });

  it("drains actions without targetPageId for any page", () => {
    const queue = [
      make({ type: "fillPrompt", text: "a" }),
      make({ type: "setTab", tabId: "t2i" }),
    ];
    const { drained, rest } = drainActionsForPage(queue, "image-studio", now);
    expect(drained).toHaveLength(2);
    expect(rest).toHaveLength(0);
  });

  it("drains actions whose targetPageId matches", () => {
    const queue = [
      make({ type: "setModel", modelId: "x" }, { targetPageId: "image-studio" }),
      make({ type: "setModel", modelId: "y" }, { targetPageId: "video-studio" }),
    ];
    const { drained, rest } = drainActionsForPage(queue, "image-studio", now);
    expect(drained).toHaveLength(1);
    expect((drained[0] as { modelId: string }).modelId).toBe("x");
    expect(rest).toHaveLength(1);
    expect(rest[0].targetPageId).toBe("video-studio");
  });

  it("silently drops expired actions", () => {
    const queue = [
      make({ type: "fillPrompt", text: "old" }, {
        createdAt: now - PENDING_ACTION_TTL_MS - 1,
      }),
      make({ type: "fillPrompt", text: "fresh" }, { createdAt: now }),
    ];
    const { drained, rest } = drainActionsForPage(queue, "image-studio", now);
    expect(drained).toHaveLength(1);
    expect((drained[0] as { text: string }).text).toBe("fresh");
    expect(rest).toHaveLength(0);
  });

  it("always drops navigate (orb layer owns navigation)", () => {
    const queue = [make({ type: "navigate", path: "/foo" })];
    const { drained, rest } = drainActionsForPage(queue, "any", now);
    expect(drained).toHaveLength(0);
    expect(rest).toHaveLength(0);
  });
});

// ─── End-to-end queue scenario ───────────────────────────────────────────

describe("full scenario: orb navigates before page mounts", () => {
  it("queues setTab + fillPrompt, drains on page register", () => {
    const now = 3_000_000_000_000;
    let queue: PendingAction[] = [];

    // 光球按下「帶我去圖像工作室」→ ProactiveOrbWidget 送出兩個動作
    queue = enqueueAction(queue, {
      action: { type: "setTab", tabId: "t2i" },
      createdAt: now,
    });
    queue = enqueueAction(queue, {
      action: {
        type: "fillPrompt",
        text: "calm photorealistic style, high quality, detailed",
      },
      createdAt: now + 1,
    });

    expect(queue).toHaveLength(2);

    // ImageStudio 掛載後 register → PageAgentContext drain
    const { drained, rest } = drainActionsForPage(queue, "image-studio", now + 50);
    expect(drained.map(a => a.type)).toEqual(["setTab", "fillPrompt"]);
    expect(rest).toHaveLength(0);
  });
});
