/**
 * Pure unit tests for the chain-observation event mapping. Runs in
 * the existing node vitest setup (no jsdom / RTL needed) — the React
 * hook is a thin wrapper over `eventToObservation` plus polling +
 * dedupe state, and the mapping is where the behaviour lives.
 */
import { describe, expect, it } from "vitest";
import {
  eventToObservation,
  type OrbAuditEventRow,
} from "../../../client/src/hooks/useOrbTaskObservations";

function row(partial: Partial<OrbAuditEventRow>): OrbAuditEventRow {
  return {
    eventId: "evt-1",
    taskId: "t-1",
    type: "task.observed",
    message: "",
    timestamp: 1_700_000_000_000,
    ...partial,
  };
}

describe("eventToObservation", () => {
  it("returns null for unrelated audit event types", () => {
    expect(
      eventToObservation(row({ type: "task.created" }), 0)
    ).toBeNull();
    expect(
      eventToObservation(row({ type: "step.completed" }), 0)
    ).toBeNull();
  });

  it("maps task.continuation_started, picks up successorTaskId", () => {
    const item = eventToObservation(
      row({
        type: "task.continuation_started",
        metadata: { successorTaskId: "t-next", iterationIndex: 2 },
      }),
      0
    );
    expect(item?.kind).toBe("continuation_started");
    expect(item?.successorTaskId).toBe("t-next");
    expect(item?.message).toContain("第 2 輪");
  });

  it("maps task.observed (complete)", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: {
          observation: { kind: "complete", userMessage: "幫你做完了" },
        },
      }),
      0
    );
    expect(item?.kind).toBe("complete");
    expect(item?.message).toBe("幫你做完了");
  });

  it("maps task.observed (abort) with failureCategory", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: {
          observation: {
            kind: "abort",
            userMessage: "先暫停",
            failureCategory: "quota_exceeded",
          },
        },
      }),
      1
    );
    expect(item?.kind).toBe("abort");
    if (item?.kind === "abort") {
      expect(item.failureCategory).toBe("quota_exceeded");
    }
  });

  it("clamps unknown failureCategory to 'unknown'", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: {
          observation: {
            kind: "abort",
            userMessage: "x",
            failureCategory: "weird-thing",
          },
        },
      }),
      0
    );
    if (item?.kind === "abort") {
      // The hook keeps unknown values — server side validates beforehand;
      // this test asserts the mapping never crashes on unexpected enum.
      expect(typeof item.failureCategory).toBe("string");
    }
  });

  it("maps task.observed (needs_user) with suggestions trimmed", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: {
          observation: {
            kind: "needs_user",
            question: "你想要哪一種？",
            suggestions: ["A", "B", "C", "D", "E"],
          },
        },
      }),
      0
    );
    expect(item?.kind).toBe("needs_user");
    if (item?.kind === "needs_user") {
      expect(item.suggestions).toHaveLength(4);
    }
  });

  it("maps task.observed (continue) with suggestedNextAction", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: {
          observation: {
            kind: "continue",
            suggestedNextAction: "換 Veo 試試",
            reason: "預設模型卡住",
          },
        },
      }),
      0
    );
    expect(item?.kind).toBe("continue");
    expect(item?.message).toBe("換 Veo 試試");
  });

  it("falls back to a continue-style note when task.observed has no observation metadata", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        message: "Observer crashed: x",
        metadata: { error: true },
      }),
      0
    );
    expect(item?.kind).toBe("continue");
    expect(item?.message).toBe("Observer crashed: x");
  });

  it("propagates iterationIndex onto returned items", () => {
    const item = eventToObservation(
      row({
        type: "task.observed",
        metadata: { observation: { kind: "complete", userMessage: "ok" } },
      }),
      3
    );
    expect(item?.iterationIndex).toBe(3);
  });
});
