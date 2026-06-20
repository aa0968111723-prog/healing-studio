/**
 * auditLog.test.ts — AIDV-123 全站操作稽核軌跡服務測試
 *
 * 驗證 best-effort 鐵則：
 *   • recordAuditEvent 成功寫入（有 DB 時）。
 *   • 無 DB（getDb → null）安全 skip，不寫、不 throw。
 *   • 寫入拋錯時被吞掉，呼叫端永不見到例外。
 *   • extractRequestSource 取 IP / UA。
 *   • queryAuditEvents / countAuditEvents 在無 DB 時回空/0，且依條件過濾。
 *
 * 透過 vitest mock 把 getDb 換成 in-memory stub，不需真 MySQL。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// ── In-memory DB stub ───────────────────────────────────────────────────────
// 模擬 drizzle 的 insert(...).values(...) 與 select(...).from(...).where(...)
//   .orderBy(...).limit(...).offset(...) 鏈。

type Row = Record<string, unknown>;

const state: {
  db: unknown;
  inserted: Row[];
  insertShouldThrow: boolean;
} = {
  db: null,
  inserted: [],
  insertShouldThrow: false,
};

function makeFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: async (row: Row) => {
        if (state.insertShouldThrow) {
          throw new Error("simulated DB write failure");
        }
        state.inserted.push(row);
        return undefined;
      },
    }),
    select: (_cols?: unknown) => {
      const builder: any = {
        _where: undefined as unknown,
        from() {
          return builder;
        },
        where(w: unknown) {
          builder._where = w;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        offset() {
          return Promise.resolve(state.inserted);
        },
        // count 路徑：select({total}).from().where() 直接 await
        then(resolve: (v: unknown) => void) {
          resolve([{ total: state.inserted.length }]);
        },
      };
      return builder;
    },
  };
}

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => state.db),
}));

import {
  recordAuditEvent,
  extractRequestSource,
  queryAuditEvents,
  countAuditEvents,
} from "../audit/auditLog";

/** recordAuditEvent 用 setImmediate，等一拍讓寫入完成。 */
function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(() => setImmediate(resolve)));
}

beforeEach(() => {
  state.db = makeFakeDb();
  state.inserted = [];
  state.insertShouldThrow = false;
  vi.clearAllMocks();
});

describe("recordAuditEvent（best-effort 寫入）", () => {
  it("有 DB 時寫入一筆稽核事件", async () => {
    recordAuditEvent({
      actorUserId: 7,
      actorRole: "user",
      action: "project.create",
      targetType: "project",
      targetId: 42,
      metadata: { title: "X" },
    });
    await flush();
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row.actorUserId).toBe(7);
    expect(row.action).toBe("project.create");
    expect(row.targetType).toBe("project");
    // targetId 轉成字串儲存
    expect(row.targetId).toBe("42");
    expect(row.result).toBe("success"); // 預設 success
  });

  it("無 DB（getDb → null）時安全 skip，不寫、不 throw", async () => {
    state.db = null;
    expect(() =>
      recordAuditEvent({ action: "auth.login", actorUserId: 1 })
    ).not.toThrow();
    await flush();
    expect(state.inserted).toHaveLength(0);
  });

  it("寫入拋錯時被吞掉，呼叫端永不見到例外", async () => {
    state.insertShouldThrow = true;
    expect(() =>
      recordAuditEvent({ action: "asset.delete", targetId: 1 })
    ).not.toThrow();
    await flush();
    // 沒有寫進去，但也沒有炸出來
    expect(state.inserted).toHaveLength(0);
  });

  it("null targetId 保持 null（不變成 'null' 字串）", async () => {
    recordAuditEvent({ action: "auth.login", targetId: null });
    await flush();
    expect(state.inserted[0].targetId).toBeNull();
  });
});

describe("extractRequestSource", () => {
  it("從 x-forwarded-for 取首段 IP、user-agent 取 UA", () => {
    const src = extractRequestSource({
      headers: {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "user-agent": "Mozilla/5.0",
      },
      ip: "9.9.9.9",
    } as never);
    expect(src.ipAddress).toBe("1.2.3.4");
    expect(src.userAgent).toBe("Mozilla/5.0");
  });

  it("無 x-forwarded-for 時退回 req.ip", () => {
    const src = extractRequestSource({
      headers: { "user-agent": "UA" },
      ip: "9.9.9.9",
    } as never);
    expect(src.ipAddress).toBe("9.9.9.9");
  });

  it("無 req 時回空物件", () => {
    expect(extractRequestSource(undefined)).toEqual({});
  });
});

describe("queryAuditEvents / countAuditEvents", () => {
  it("無 DB 時 queryAuditEvents 回空陣列、countAuditEvents 回 0", async () => {
    state.db = null;
    expect(await queryAuditEvents({})).toEqual([]);
    expect(await countAuditEvents({})).toBe(0);
  });

  it("有 DB 時回傳查詢結果", async () => {
    state.inserted = [{ id: 1, action: "project.create" }];
    const events = await queryAuditEvents({ action: "project.create" });
    expect(events).toHaveLength(1);
    const total = await countAuditEvents({ action: "project.create" });
    expect(total).toBe(1);
  });
});
