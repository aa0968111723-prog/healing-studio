/**
 * page-agent-intent.test.ts — Phase 1.5 純邏輯測試
 *
 * 測試：
 *   - isDestructiveAction（哪些動作需要使用者確認）
 *   - summarizeAction（繁中摘要，確認卡片顯示用）
 *   - pushFeedback（feedback 歷史上限）
 *   - serializeFeedbackForPrompt（壓進 LLM prompt 的文字）
 *   - serializeSnapshotForPrompt（頁面能力 snapshot → LLM 看得懂的形式）
 *
 * 同 page-agent-bus.test.ts，僅 import shared/agent-actions.ts，node 環境可跑。
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_FEEDBACK_HISTORY_CAP,
  isDestructiveAction,
  pushFeedback,
  serializeFeedbackForPrompt,
  serializeSnapshotForPrompt,
  summarizeAction,
  type AgentAction,
  type AgentFeedbackEvent,
  type PageAgentSnapshot,
} from "../shared/agent-actions";

// ─── isDestructiveAction ─────────────────────────────────────────────────

describe("isDestructiveAction", () => {
  it("flags submit / reset / applyPreset / setModality as destructive", () => {
    expect(isDestructiveAction({ type: "submit" })).toBe(true);
    expect(isDestructiveAction({ type: "reset" })).toBe(true);
    expect(isDestructiveAction({ type: "applyPreset", presetId: "p" })).toBe(true);
    expect(isDestructiveAction({ type: "setModality", modality: "video" })).toBe(true);
  });

  it("treats fillPrompt / setModel / setTab / setParam as non-destructive", () => {
    expect(isDestructiveAction({ type: "fillPrompt", text: "a" })).toBe(false);
    expect(isDestructiveAction({ type: "setModel", modelId: "x" })).toBe(false);
    expect(isDestructiveAction({ type: "setTab", tabId: "t" })).toBe(false);
    expect(isDestructiveAction({ type: "setParam", key: "cfg", value: 3 })).toBe(false);
    expect(isDestructiveAction({ type: "navigate", path: "/x" })).toBe(false);
    expect(isDestructiveAction({ type: "focusElement", elementId: "e" })).toBe(false);
  });
});

// ─── summarizeAction ─────────────────────────────────────────────────────

describe("summarizeAction", () => {
  it("generates Chinese summaries that a user could read", () => {
    expect(summarizeAction({ type: "fillPrompt", text: "一隻貓" })).toContain("提示詞");
    expect(summarizeAction({ type: "fillPrompt", text: "黑色背景", append: true }))
      .toContain("補到");
    expect(
      summarizeAction({ type: "fillPrompt", text: "模糊", slot: "negativePrompt" })
    ).toContain("負面提示詞");
    expect(summarizeAction({ type: "setModel", modelId: "flux-pro" })).toContain("flux-pro");
    expect(summarizeAction({ type: "setTab", tabId: "i2i" })).toContain("i2i");
    expect(summarizeAction({ type: "setMode", modeId: "professional" })).toContain("professional");
    expect(summarizeAction({ type: "setModality", modality: "video" })).toContain("video");
    expect(summarizeAction({ type: "setParam", key: "cfg", value: 7 })).toContain("cfg");
    expect(summarizeAction({ type: "applyPreset", presetId: "calm" })).toContain("calm");
    expect(summarizeAction({ type: "submit" })).toContain("送出");
    expect(summarizeAction({ type: "reset" })).toContain("重置");
    expect(summarizeAction({ type: "navigate", path: "/studio" })).toContain("/studio");
    expect(
      summarizeAction({ type: "focusElement", elementId: "btn", message: "看這裡" })
    ).toBe("看這裡");
  });

  it("truncates very long fillPrompt text to keep the card compact", () => {
    const long = "一".repeat(80);
    const out = summarizeAction({ type: "fillPrompt", text: long });
    // 40 chars + "…"
    expect(out.includes("…")).toBe(true);
  });
});

// ─── pushFeedback ────────────────────────────────────────────────────────

describe("pushFeedback", () => {
  const make = (i: number, status: AgentFeedbackEvent["status"] = "accepted"): AgentFeedbackEvent => ({
    at: 1_700_000_000_000 + i * 1_000,
    status,
    actionType: "fillPrompt",
  });

  it("appends when under cap", () => {
    const out = pushFeedback([], make(1));
    expect(out).toHaveLength(1);
  });

  it("drops oldest when exceeding cap", () => {
    let list: AgentFeedbackEvent[] = [];
    for (let i = 0; i < AGENT_FEEDBACK_HISTORY_CAP + 3; i++) {
      list = pushFeedback(list, make(i));
    }
    expect(list).toHaveLength(AGENT_FEEDBACK_HISTORY_CAP);
    // 最舊三筆應該已被擠掉
    expect(list[0].at).toBe(1_700_000_000_000 + 3 * 1_000);
  });

  it("accepts a custom cap", () => {
    let list: AgentFeedbackEvent[] = [];
    for (let i = 0; i < 6; i++) list = pushFeedback(list, make(i), 3);
    expect(list).toHaveLength(3);
    expect(list[0].at).toBe(1_700_000_000_000 + 3 * 1_000);
  });
});

// ─── serializeFeedbackForPrompt ──────────────────────────────────────────

describe("serializeFeedbackForPrompt", () => {
  it("returns empty string for empty list", () => {
    expect(serializeFeedbackForPrompt([])).toBe("");
  });

  it("formats recent events with age, status, actionType", () => {
    const now = 2_000_000_000_000;
    const list: AgentFeedbackEvent[] = [
      { at: now - 5_000, status: "cancelled", actionType: "submit", note: "想改提示詞" },
      { at: now - 1_000, status: "accepted", actionType: "setModel" },
    ];
    const out = serializeFeedbackForPrompt(list, now);
    expect(out).toContain("submit: cancelled");
    expect(out).toContain("setModel: accepted");
    expect(out).toContain("想改提示詞");
    expect(out).toContain("s 前");
  });

  it("only keeps the last 5 events to save tokens", () => {
    const now = 3_000_000_000_000;
    const list: AgentFeedbackEvent[] = Array.from({ length: 10 }, (_, i) => ({
      at: now - (10 - i) * 1_000,
      status: "accepted" as const,
      actionType: `type${i}`,
    }));
    const out = serializeFeedbackForPrompt(list, now);
    // 最前面的 type0-type4 不該出現
    expect(out).not.toContain("type0:");
    expect(out).not.toContain("type4:");
    expect(out).toContain("type9:");
  });
});

// ─── serializeSnapshotForPrompt ──────────────────────────────────────────

describe("serializeSnapshotForPrompt", () => {
  it("returns empty string for null/undefined", () => {
    expect(serializeSnapshotForPrompt(null)).toBe("");
    expect(serializeSnapshotForPrompt(undefined)).toBe("");
  });

  it("includes page label, pageId, path, and capability list", () => {
    const snap: PageAgentSnapshot = {
      pageId: "image-studio",
      pageLabel: "圖片創作室",
      pagePath: "/image-studio",
      capabilities: [
        {
          action: "setModel",
          label: "模型",
          currentId: "flux-pro",
          options: [
            { id: "flux-pro", label: "Flux Pro" },
            { id: "flux-dev", label: "Flux Dev" },
          ],
        },
        { action: "setTab", label: "分頁" },
      ],
      state: { promptLength: 12, remainingCredits: 450 },
    };
    const out = serializeSnapshotForPrompt(snap);
    expect(out).toContain("圖片創作室");
    expect(out).toContain("/image-studio");
    expect(out).toContain("pageId=image-studio");
    expect(out).toContain("[setModel]");
    expect(out).toContain("目前=flux-pro");
    expect(out).toContain("flux-pro");
    expect(out).toContain("flux-dev");
    expect(out).toContain("promptLength=12");
  });

  it("truncates long option lists to keep prompt tight", () => {
    const options = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      label: `模型 ${i}`,
    }));
    const snap: PageAgentSnapshot = {
      pageId: "x",
      pageLabel: "x",
      pagePath: "/x",
      capabilities: [{ action: "setModel", label: "模型", options }],
    };
    const out = serializeSnapshotForPrompt(snap);
    expect(out).toContain("m0");
    expect(out).toContain("m11");
    expect(out).toContain("+18 個"); // 30 - 12 shown = 18 more
    expect(out).not.toContain("m29");
  });
});

// ─── End-to-end：LLM ACTION → 摘要 → 確認流程 ───────────────────────────

describe("scenario: LLM-issued destructive action becomes a confirmation card", () => {
  it("submit action is destructive and has a readable summary", () => {
    const action: AgentAction = { type: "submit" };
    expect(isDestructiveAction(action)).toBe(true);
    const summary = summarizeAction(action);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("送出");
  });

  it("fillPrompt is non-destructive and summary previews text", () => {
    const action: AgentAction = { type: "fillPrompt", text: "秋日森林小徑" };
    expect(isDestructiveAction(action)).toBe(false);
    expect(summarizeAction(action)).toContain("秋日森林小徑");
  });
});
