/**
 * orb-chat-progress.test.ts
 *
 * Locks the contract for the in-flight progress tracker that powers the
 * orb's inline "thinking timeline". The chat handler pushes milestone
 * events here; the client polls via `ai.chatProgress`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __unsafe_resetOrbChatProgressForTests,
  clearOrbChatProgress,
  emitOrbChatProgress,
  readOrbChatProgress,
} from "./services/orbChatProgress";

describe("orbChatProgress", () => {
  beforeEach(() => {
    __unsafe_resetOrbChatProgressForTests();
  });

  it("records milestones in order with monotonic seq numbers", () => {
    emitOrbChatProgress("req-1", "received", "收到請求");
    emitOrbChatProgress("req-1", "planning", "規劃步驟中…");
    emitOrbChatProgress("req-1", "finalizing", "整理回應…");

    const events = readOrbChatProgress("req-1");
    expect(events.map(e => e.stage)).toEqual(["received", "planning", "finalizing"]);
    expect(events.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it("returns only events newer than the cursor", () => {
    emitOrbChatProgress("req-2", "received", "收到請求");
    emitOrbChatProgress("req-2", "planning", "規劃中");
    const first = readOrbChatProgress("req-2");
    const lastSeq = first[first.length - 1].seq;

    emitOrbChatProgress("req-2", "finalizing", "整理回應");
    const incremental = readOrbChatProgress("req-2", lastSeq);
    expect(incremental).toHaveLength(1);
    expect(incremental[0].stage).toBe("finalizing");
  });

  it("isolates events per request id", () => {
    emitOrbChatProgress("req-A", "received", "A");
    emitOrbChatProgress("req-B", "received", "B");
    expect(readOrbChatProgress("req-A").map(e => e.label)).toEqual(["A"]);
    expect(readOrbChatProgress("req-B").map(e => e.label)).toEqual(["B"]);
  });

  it("returns empty array for unknown request id", () => {
    expect(readOrbChatProgress("never-seen")).toEqual([]);
  });

  it("is a no-op when requestId is undefined / null / empty", () => {
    emitOrbChatProgress(undefined, "received", "ignored");
    emitOrbChatProgress(null, "received", "ignored");
    emitOrbChatProgress("", "received", "ignored");
    // None of the above should have created any bucket.
    expect(readOrbChatProgress("")).toEqual([]);
  });

  it("clearOrbChatProgress drops the bucket so subsequent polls return empty", () => {
    emitOrbChatProgress("req-3", "received", "x");
    expect(readOrbChatProgress("req-3")).toHaveLength(1);
    clearOrbChatProgress("req-3");
    expect(readOrbChatProgress("req-3")).toEqual([]);
  });

  it("caps events per request at 64 by dropping the oldest (no unbounded growth)", () => {
    for (let i = 0; i < 70; i += 1) {
      emitOrbChatProgress("req-4", "planning", `step ${i}`);
    }
    const events = readOrbChatProgress("req-4");
    expect(events).toHaveLength(64);
    // Oldest dropped — first remaining label should be "step 6" (70 - 64).
    expect(events[0].label).toBe("step 6");
    expect(events[events.length - 1].label).toBe("step 69");
  });

  it("preserves structured detail payloads", () => {
    emitOrbChatProgress("req-5", "selecting_provider", "選擇模型中", {
      routeIntent: "planner_text",
      spirit: "director",
    });
    const [event] = readOrbChatProgress("req-5");
    expect(event.detail).toEqual({
      routeIntent: "planner_text",
      spirit: "director",
    });
  });
});
