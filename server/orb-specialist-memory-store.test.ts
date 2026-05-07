/**
 * server/orb-specialist-memory-store.test.ts
 *
 * Regression — `specialized_agent_interactions` was a dead schema
 * (no production writers) until the deep-fix audit. These tests lock in
 * the activation contract:
 *
 *   1. recordToolAuditAsSpecialistInteraction only fires for tools
 *      that map to a SPECIALIST skill — generic-skill tools (e.g.
 *      `director.suggestPlan`) must not write to the specialist table.
 *   2. unknown / non-skill tools are ignored silently.
 *   3. when the DB is unavailable the helpers return safe defaults
 *      (empty array / empty string) instead of throwing.
 *
 * The DB calls themselves are mocked at the module boundary so these
 * tests don't need a live MySQL — they verify the *routing* logic that
 * decides when to write.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();

// Drizzle MySQL builder is a chain of methods that each return the same
// builder object — so we model it as a single Proxy whose terminal node
// (await) resolves via selectMock. .insert(...).values(row) returns
// insertMock's resolved value.
function makeQueryBuilder() {
  const builder: any = {};
  // chainable terminals
  builder.from = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.groupBy = () => builder;
  builder.limit = (...args: unknown[]) => selectMock(...args);
  return builder;
}

// vi.mock path is resolved relative to THIS test file. The store at
// server/services/specializedAgentMemoryStore.ts imports `../db` which
// resolves to server/db.ts; from this test file (server/<…>.test.ts)
// that same file is `./db`.
vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({ values: (...args: unknown[]) => insertMock(...args) }),
    select: () => makeQueryBuilder(),
  }),
}));

import {
  recordToolAuditAsSpecialistInteraction,
  recordSpecialistInteraction,
  getRecentSpecialistTools,
  getSpecialistMemoryHints,
} from "./services/specializedAgentMemoryStore";

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ insertId: 1 });
  selectMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordToolAuditAsSpecialistInteraction — specialist routing", () => {
  it("writes a row when the tool maps to a specialist", async () => {
    recordToolAuditAsSpecialistInteraction({
      userId: 7,
      toolName: "studio.generateImage",
      ok: true,
      startedAt: 1000,
      endedAt: 1500,
    });
    // recordSpecialistInteraction is fire-and-forget; flush microtasks.
    await new Promise(r => setTimeout(r, 5));
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.userId).toBe(7);
    expect(row.agentId).toBe("image-specialist");
    expect(row.interactionType).toBe("tool_used");
    expect(row.toolName).toBe("studio.generateImage");
    expect(row.durationMs).toBe(500);
  });

  it("uses interactionType=error when ok=false", async () => {
    recordToolAuditAsSpecialistInteraction({
      userId: 1,
      toolName: "studio.generateVoice",
      ok: false,
      startedAt: 0,
      endedAt: 100,
      error: "rate limited",
    });
    await new Promise(r => setTimeout(r, 5));
    const row = insertMock.mock.calls[0][0];
    expect(row.agentId).toBe("voice-specialist");
    expect(row.interactionType).toBe("error");
    expect(row.contextData).toEqual({ error: "rate limited" });
  });

  it("does NOT write a row for generic-skill tools", async () => {
    // director.suggestPlan now belongs to the director generic skill,
    // not a specialist. No row should be inserted.
    recordToolAuditAsSpecialistInteraction({
      userId: 1,
      toolName: "director.suggestPlan",
      ok: true,
      startedAt: 0,
      endedAt: 1,
    });
    await new Promise(r => setTimeout(r, 5));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does NOT write a row for unknown tools", async () => {
    recordToolAuditAsSpecialistInteraction({
      userId: 1,
      toolName: "totally.unknown.tool",
      ok: true,
      startedAt: 0,
      endedAt: 1,
    });
    await new Promise(r => setTimeout(r, 5));
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("recordSpecialistInteraction — direct API", () => {
  it("returns null and skips DB for non-specialist agentIds", async () => {
    const result = await recordSpecialistInteraction({
      userId: 1,
      agentId: "director", // generic, not specialist
      interactionType: "activated",
    });
    expect(result).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("persists for known specialists", async () => {
    const result = await recordSpecialistInteraction({
      userId: 9,
      agentId: "training-specialist",
      interactionType: "activated",
      sessionId: "sess-42",
    });
    expect(result).not.toBeNull();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].sessionId).toBe("sess-42");
  });
});

describe("getRecentSpecialistTools / getSpecialistMemoryHints — read path", () => {
  it("getRecentSpecialistTools returns tool names from rows", async () => {
    selectMock.mockResolvedValueOnce([
      { toolName: "studio.generateImage" },
      { toolName: "studio.generateVoice" },
      { toolName: null }, // null toolName must be filtered
    ]);
    const tools = await getRecentSpecialistTools(1, 5);
    expect(tools).toEqual(["studio.generateImage", "studio.generateVoice"]);
  });

  it("getSpecialistMemoryHints returns empty string when no rows", async () => {
    selectMock.mockResolvedValueOnce([]);
    const hints = await getSpecialistMemoryHints(1);
    expect(hints).toBe("");
  });

  it("getSpecialistMemoryHints renders a header + per-agent counts when rows exist", async () => {
    selectMock.mockResolvedValueOnce([
      { agentId: "image-specialist", interactionType: "tool_used", count: 14 },
      { agentId: "image-specialist", interactionType: "error", count: 2 },
      { agentId: "voice-specialist", interactionType: "tool_used", count: 3 },
    ]);
    const hints = await getSpecialistMemoryHints(1);
    expect(hints).toMatch(/使用者專精助手習慣/);
    expect(hints).toMatch(/image-specialist：14 次成功/);
    expect(hints).toMatch(/2 次失敗/);
    expect(hints).toMatch(/voice-specialist：3 次成功/);
  });
});
