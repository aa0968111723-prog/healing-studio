/**
 * Unit tests for notesCuratorTools — 記記（notes-curator）的核心能力。
 *
 * 重點驗證：
 *   1. createNote 對 calendar_event 強制 scheduledDate
 *   2. updateNoteStatus 把訊息文案做對（todo / in_progress / done）
 *   3. tagAssets add / remove / replace 三種 action 都會走對的合併邏輯
 *   4. summarizeRecentActivity 把 rows 正確分類成 notes / tasks / calendar / scripts
 *   5. scheduleEvent 內部會轉發到 createNote 並標 calendar_event
 *
 * 透過 vi.mock 把 ../../../server/db 換成 chainable fake，
 * 不打真 DB；測試聚焦在工具的決策層 + 訊息格式，避免被 drizzle 的細節綁死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryRecord {
  type: "insert" | "select" | "update" | "delete";
  table?: unknown;
  values?: unknown;
  setPatch?: Record<string, unknown>;
}

let _rows: Array<Record<string, unknown>> = [];
let _affectedRows = 0;
let _insertId = 1;
let _queries: QueryRecord[] = [];

function chainable<T>(result: T) {
  // Every drizzle helper (from / where / orderBy / limit / groupBy)
  // returns the same proxy so we can keep chaining; awaiting any node
  // resolves to the configured rows. Captures the most recent call so
  // tests can assert on it.
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (rows: T) => void) => resolve(result);
      }
      if (prop === Symbol.toPrimitive) return () => "[chainable]";
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy as {
    from: (...args: unknown[]) => typeof proxy;
    where: (...args: unknown[]) => typeof proxy;
    orderBy: (...args: unknown[]) => typeof proxy;
    limit: (...args: unknown[]) => typeof proxy;
    groupBy: (...args: unknown[]) => typeof proxy;
    set: (...args: unknown[]) => typeof proxy;
    values: (...args: unknown[]) => typeof proxy;
  };
}

function makeFakeDb() {
  return {
    select() {
      _queries.push({ type: "select" });
      return chainable(_rows);
    },
    insert(table: unknown) {
      _queries.push({ type: "insert", table });
      return {
        values(payload: unknown) {
          _queries[_queries.length - 1].values = payload;
          return Promise.resolve([{ insertId: _insertId }]);
        },
      };
    },
    update(table: unknown) {
      _queries.push({ type: "update", table });
      return {
        set(patch: Record<string, unknown>) {
          _queries[_queries.length - 1].setPatch = patch;
          return {
            where: () =>
              Promise.resolve({ affectedRows: _affectedRows } as unknown),
          };
        },
      };
    },
    delete(table: unknown) {
      _queries.push({ type: "delete", table });
      return {
        where: () =>
          Promise.resolve({ affectedRows: _affectedRows } as unknown),
      };
    },
  };
}

vi.mock("../../../server/db", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../../server/_core/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createNote,
  updateNoteStatus,
  tagAssets,
  summarizeRecentActivity,
  scheduleEvent,
  scheduleTask,
} from "../../../server/services/spiritTools/notesCuratorTools";

beforeEach(() => {
  _rows = [];
  _affectedRows = 1;
  _insertId = 42;
  _queries = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createNote", () => {
  it("rejects calendar_event without scheduledDate", async () => {
    const result = await createNote({
      userId: 1,
      title: "直播試錄",
      content: "週四晚上",
      noteType: "calendar_event",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/scheduledDate/);
  });

  it("inserts with sensible defaults (noteType=note, status=todo)", async () => {
    const result = await createNote({
      userId: 7,
      title: "靈感卡",
      content: "下次試 anime LoRA",
    });
    expect(result.success).toBe(true);
    expect(result.noteId).toBe(42);
    const insertedValues = _queries.find(q => q.type === "insert")?.values as
      | Record<string, unknown>
      | undefined;
    expect(insertedValues?.noteType).toBe("note");
    expect(insertedValues?.status).toBe("todo");
    expect(insertedValues?.userId).toBe(7);
  });

  it("persists calendar_event with full schedule payload", async () => {
    const result = await createNote({
      userId: 3,
      title: "棚拍",
      content: "妝髮 + 服裝確認",
      noteType: "calendar_event",
      scheduledDate: "2026-06-01T10:00:00Z",
      endDate: "2026-06-01T14:00:00Z",
      reminderMinutes: 60,
      meetingUrl: "https://meet.example/abc",
    });
    expect(result.success).toBe(true);
    const inserted = _queries.find(q => q.type === "insert")?.values as
      | Record<string, unknown>
      | undefined;
    expect(inserted?.noteType).toBe("calendar_event");
    expect(inserted?.reminderMinutes).toBe(60);
    expect(inserted?.scheduledDate).toBeInstanceOf(Date);
    expect(inserted?.meetingUrl).toBe("https://meet.example/abc");
  });
});

describe("updateNoteStatus", () => {
  it("uses 進行中 wording for in_progress and 完成 for done", async () => {
    // Simulate the row read that happens after update completes.
    _rows = [
      {
        id: 5,
        userId: 1,
        title: "x",
        content: "",
        noteType: "note",
        status: "in_progress",
        tags: null,
        category: null,
        scheduledDate: null,
        endDate: null,
        reminderMinutes: null,
        location: null,
        meetingUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const inProgress = await updateNoteStatus({
      userId: 1,
      noteId: 5,
      status: "in_progress",
    });
    expect(inProgress.success).toBe(true);
    expect(inProgress.message).toMatch(/進行中/);

    const done = await updateNoteStatus({
      userId: 1,
      noteId: 5,
      status: "done",
    });
    expect(done.success).toBe(true);
    expect(done.message).toMatch(/完成/);
  });

  it("returns failure when row not owned by user", async () => {
    _affectedRows = 0;
    const result = await updateNoteStatus({
      userId: 1,
      noteId: 99999,
      status: "done",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/找不到/);
  });
});

describe("tagAssets", () => {
  it("rejects empty assetIds", async () => {
    const result = await tagAssets({
      userId: 1,
      assetIds: [],
      tags: ["x"],
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/assetIds/);
  });

  it("merges new tags into existing (add) without duplicates (case-insensitive)", async () => {
    _rows = [
      { id: 10, tags: ["Yoga", "瑜珈"] },
      { id: 11, tags: ["練習"] },
    ];
    const result = await tagAssets({
      userId: 1,
      assetIds: [10, 11],
      tags: ["yoga", "新增"],
      action: "add",
    });
    expect(result.success).toBe(true);
    expect(result.updated).toBe(2);

    const updates = _queries.filter(q => q.type === "update");
    expect(updates).toHaveLength(2);
    const first = updates[0].setPatch?.tags as string[];
    // "Yoga" already there (case-insensitive) so no dup; "新增" appended.
    expect(first).toEqual(["Yoga", "瑜珈", "新增"]);
  });

  it("replaces tag list when action=replace", async () => {
    _rows = [{ id: 5, tags: ["舊1", "舊2"] }];
    const result = await tagAssets({
      userId: 1,
      assetIds: [5],
      tags: ["全新"],
      action: "replace",
    });
    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    const tags = _queries.find(q => q.type === "update")?.setPatch?.tags;
    expect(tags).toEqual(["全新"]);
  });

  it("strips matching tags when action=remove (case-insensitive)", async () => {
    _rows = [{ id: 8, tags: ["yoga", "練習", "進階"] }];
    const result = await tagAssets({
      userId: 1,
      assetIds: [8],
      tags: ["YOGA"],
      action: "remove",
    });
    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    const tags = _queries.find(q => q.type === "update")?.setPatch?.tags;
    expect(tags).toEqual(["練習", "進階"]);
  });

  it("skips update for unchanged tag set (no-op)", async () => {
    _rows = [{ id: 8, tags: ["a", "b"] }];
    const result = await tagAssets({
      userId: 1,
      assetIds: [8],
      tags: ["a", "b"],
      action: "add",
    });
    expect(result.success).toBe(true);
    expect(result.updated).toBe(0);
    expect(_queries.filter(q => q.type === "update")).toHaveLength(0);
  });
});

describe("summarizeRecentActivity", () => {
  it("classifies rows into notes / tasks / calendar / scripts buckets", async () => {
    _rows = [
      // calendar event
      {
        id: 1,
        title: "棚拍",
        noteType: "calendar_event",
        status: "todo",
        updatedAt: new Date(),
      },
      // script
      {
        id: 2,
        title: "腳本草稿",
        noteType: "script",
        status: "todo",
        updatedAt: new Date(),
      },
      // task (note + todo / in_progress)
      {
        id: 3,
        title: "TODO 改主圖",
        noteType: "note",
        status: "todo",
        updatedAt: new Date(),
      },
      {
        id: 4,
        title: "進行中",
        noteType: "note",
        status: "in_progress",
        updatedAt: new Date(),
      },
      // done note → counted as note, not task
      {
        id: 5,
        title: "已歸檔",
        noteType: "note",
        status: "done",
        updatedAt: new Date(),
      },
    ];
    const result = await summarizeRecentActivity({ userId: 1 });
    expect(result.success).toBe(true);
    expect(result.counts.calendar).toBe(1);
    expect(result.counts.scripts).toBe(1);
    expect(result.counts.tasks).toBe(2);
    expect(result.counts.notes).toBe(1);
    expect(result.byStatus.todo).toBe(3);
    expect(result.byStatus.in_progress).toBe(1);
    expect(result.byStatus.done).toBe(1);
    expect(result.recentTitles).toHaveLength(5);
  });

  it("clamps sinceDays to [1, 90]", async () => {
    _rows = [];
    const tooHigh = await summarizeRecentActivity({ userId: 1, sinceDays: 9999 });
    expect(tooHigh.sinceDays).toBe(90);
    const tooLow = await summarizeRecentActivity({ userId: 1, sinceDays: 0 });
    expect(tooLow.sinceDays).toBe(1);
  });
});

describe("scheduleEvent", () => {
  it("creates a calendar_event with the supplied schedule fields", async () => {
    const result = await scheduleEvent({
      userId: 4,
      title: "直播",
      scheduledFor: "2026-07-04T20:00:00Z",
      reminderMinutes: 30,
      meetingUrl: "https://stream.example/live",
    });
    expect(result.success).toBe(true);
    expect(result.eventId).toBe(42);
    const inserted = _queries.find(q => q.type === "insert")?.values as
      | Record<string, unknown>
      | undefined;
    expect(inserted?.noteType).toBe("calendar_event");
    expect(inserted?.reminderMinutes).toBe(30);
  });
});

describe("scheduleTask (back-compat shim)", () => {
  it("forwards to scheduleEvent and returns jobId", async () => {
    const result = await scheduleTask({
      userId: 9,
      taskName: "舊版排程",
      scheduledFor: "2026-08-01T09:00:00Z",
      description: "舊版 API alias",
    });
    expect(result.success).toBe(true);
    expect(result.jobId).toBe(42);
    const inserted = _queries.find(q => q.type === "insert")?.values as
      | Record<string, unknown>
      | undefined;
    expect(inserted?.noteType).toBe("calendar_event");
    expect(inserted?.title).toBe("舊版排程");
  });
});
