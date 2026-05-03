import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetOrbTaskMemoryForTests,
  getRecentOrbTaskMemory,
  getRecentOrbTaskMemoryForUser,
  loadRecentChainMemoryFromDb,
  persistOrbTaskMemoryEvent,
  recordOrbTaskMemory,
  type OrbTaskMemoryEvent,
} from "../orbTaskMemory";

// ── Stub the db module so persistOrbTaskMemoryEvent /
//    loadRecentChainMemoryFromDb don't actually open a DB connection.
//    Both functions lazy-import "../db", so the mock applies via the
//    real import path.

const dbAppendCalls: Array<Record<string, unknown>> = [];
let dbReadRows: Array<{
  id: number;
  actionType: string;
  status: string;
  note: string | null;
  actionSummary: string | null;
  createdAt: Date;
}> = [];

vi.mock("../../db", () => ({
  appendOrbFeedback: async (data: Record<string, unknown>) => {
    dbAppendCalls.push(data);
    return 1;
  },
  getRecentOrbFeedback: async (_userId: number, _limit?: number) => dbReadRows,
}));

const PERSIST_FLAG = "ORB_CHAIN_MEMORY_PERSIST";

beforeEach(() => {
  _resetOrbTaskMemoryForTests();
  dbAppendCalls.length = 0;
  dbReadRows = [];
  delete process.env[PERSIST_FLAG];
});

afterEach(() => {
  delete process.env[PERSIST_FLAG];
});

function makeEvent(
  partial: Partial<OrbTaskMemoryEvent> = {}
): OrbTaskMemoryEvent {
  return {
    taskId: "t-1",
    planId: "p-1",
    traceId: "tr-1",
    userId: 42,
    userIntent: "做一張圖",
    outcome: "success",
    usedEngine: "fal",
    usedMultimodalPlanner: false,
    actionTypes: ["fillPrompt", "submit"],
    createdAt: 1_700_000_000_000,
    ...partial,
  };
}

describe("orbTaskMemory in-memory ring", () => {
  it("records and reads back via getRecentOrbTaskMemory", () => {
    recordOrbTaskMemory(makeEvent({ taskId: "a" }));
    recordOrbTaskMemory(makeEvent({ taskId: "b" }));
    const recent = getRecentOrbTaskMemory(10);
    expect(recent[0].taskId).toBe("b"); // newest first
    expect(recent[1].taskId).toBe("a");
  });

  it("getRecentOrbTaskMemoryForUser filters by userId and excludes legacy events", () => {
    recordOrbTaskMemory(makeEvent({ taskId: "a", userId: 1 }));
    recordOrbTaskMemory(makeEvent({ taskId: "b", userId: 2 }));
    recordOrbTaskMemory(
      makeEvent({ taskId: "legacy", userId: undefined as unknown as number })
    );
    const u1 = getRecentOrbTaskMemoryForUser(1, 10);
    const u2 = getRecentOrbTaskMemoryForUser(2, 10);
    expect(u1.map(r => r.taskId)).toEqual(["a"]);
    expect(u2.map(r => r.taskId)).toEqual(["b"]);
  });
});

describe("orbTaskMemory DB persistence (opt-in)", () => {
  it("is a no-op when ORB_CHAIN_MEMORY_PERSIST is unset", async () => {
    await persistOrbTaskMemoryEvent(makeEvent());
    expect(dbAppendCalls).toHaveLength(0);
  });

  it("is a no-op when userId is missing even with the flag on", async () => {
    process.env[PERSIST_FLAG] = "1";
    await persistOrbTaskMemoryEvent(
      makeEvent({ userId: undefined as unknown as number })
    );
    expect(dbAppendCalls).toHaveLength(0);
  });

  it("mirrors the event to DB with mapped status and chain.* actionType", async () => {
    process.env[PERSIST_FLAG] = "1";
    await persistOrbTaskMemoryEvent(makeEvent({ outcome: "success" }));
    expect(dbAppendCalls).toHaveLength(1);
    const call = dbAppendCalls[0];
    expect(call.userId).toBe(42);
    expect(call.actionType).toBe("chain.success");
    expect(call.status).toBe("completed");
    expect(call.note).toBe("做一張圖");
    expect(typeof call.actionSummary).toBe("string");
    const summary = JSON.parse(String(call.actionSummary));
    expect(summary.taskId).toBe("t-1");
  });

  it("maps blocked / cancelled / failure to the right feedback status", async () => {
    process.env[PERSIST_FLAG] = "1";
    await persistOrbTaskMemoryEvent(makeEvent({ outcome: "blocked" }));
    await persistOrbTaskMemoryEvent(makeEvent({ outcome: "cancelled" }));
    await persistOrbTaskMemoryEvent(makeEvent({ outcome: "failure" }));
    expect(dbAppendCalls.map(c => c.status)).toEqual([
      "cancelled",
      "cancelled",
      "failed",
    ]);
  });

  it("loadRecentChainMemoryFromDb returns [] when flag is off", async () => {
    dbReadRows = [
      {
        id: 1,
        actionType: "chain.success",
        status: "completed",
        note: "x",
        actionSummary: JSON.stringify({ taskId: "t-x" }),
        createdAt: new Date(),
      },
    ];
    expect(await loadRecentChainMemoryFromDb(42, 10)).toEqual([]);
  });

  it("loadRecentChainMemoryFromDb reconstructs OrbTaskMemoryEvent[] from rows", async () => {
    process.env[PERSIST_FLAG] = "1";
    dbReadRows = [
      {
        id: 1,
        actionType: "chain.failure",
        status: "failed",
        note: "做一張圖",
        actionSummary: JSON.stringify({
          taskId: "t-x",
          planId: "p-x",
          traceId: "tr-x",
          usedEngine: "fal",
          usedMultimodalPlanner: false,
          actionTypes: ["submit"],
          failedReason: "tool-broke",
        }),
        createdAt: new Date(1_700_000_001_000),
      },
      // Mixed in a non-chain row to verify it gets filtered out.
      {
        id: 2,
        actionType: "submit",
        status: "completed",
        note: "n",
        actionSummary: null,
        createdAt: new Date(1_700_000_002_000),
      },
    ];
    const events = await loadRecentChainMemoryFromDb(42, 10);
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe("t-x");
    expect(events[0].outcome).toBe("failure");
    expect(events[0].failedReason).toBe("tool-broke");
    expect(events[0].userId).toBe(42);
  });

  it("skips rows with un-parseable summary instead of crashing", async () => {
    process.env[PERSIST_FLAG] = "1";
    dbReadRows = [
      {
        id: 3,
        actionType: "chain.success",
        status: "completed",
        note: "x",
        actionSummary: "not-json",
        createdAt: new Date(),
      },
    ];
    const events = await loadRecentChainMemoryFromDb(42, 10);
    expect(events).toEqual([]);
  });
});
