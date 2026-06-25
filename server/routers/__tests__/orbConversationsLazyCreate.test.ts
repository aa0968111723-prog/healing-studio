/**
 * orbConversationsLazyCreate.test.ts — AIDV-157
 *
 * 鎖住 `orbConversations.appendMessages` 的根因修復:**conversation 列不存在
 * 時自動建立(lazy create),而非丟 500「Conversation not found」**。
 *
 * 背景(根因):client(GlobalOrbChatContext)在使用者尚無任何 server 對話時,
 * 會先用 client 端 `conv_*` id 樂觀建立本地 tab,但這個 id 從未跑過 server
 * `create`。隨後 persist effect 對這個「只存在本地」的 id 呼叫 appendMessages,
 * 舊版直接丟 NOT_FOUND → 使用者看到「導演對話送出後 AI 永遠不回 + console 連兩筆
 * 500」(載入一筆、送出一筆)。
 *
 * 本檔用「最小 in-memory 假 drizzle db」直接驅動 router handler,驗證四條不變式:
 *   1. 列不存在 → 自動建立並寫入訊息,不再 throw(不再 500)。
 *   2. Scoped:lazy-create 出來的列 userId 必為 caller;別人占用同 id → FORBIDDEN
 *      (防 IDOR,不附加到別人對話)。
 *   3. Idempotent:對同一(新)conversationId 連送兩批,只會有一列、訊息以 `at`
 *      去重,messageCount 不灌水。
 *   4. 既有正常路徑:列已存在且屬於 caller → 行為與改動前相同(更新計數 / auto-title)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-memory fake drizzle db ────────────────────────────────────────────
// 只實作 router 真正用到的 query chain:
//   select().from().where().limit() / orderBy()
//   insert().values()
//   update().set().where()
//   delete().where()
// where() 收到的是 drizzle SQL 物件;我們不解析它,改用「上一次 select/insert
// 寫入的資料 + 全表掃描 + 對應 predicate」模擬。為求精準,改成記錄欄位條件的
// 輕量 predicate 物件(下方 eq/and/... mock)。

interface ConvRow {
  conversationId: string;
  userId: number;
  title: string;
  pinned: boolean;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
interface MsgRow {
  messageId: number;
  conversationId: string;
  userId: number;
  role: "user" | "orb";
  text: string;
  at: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const store: {
  convs: ConvRow[];
  msgs: MsgRow[];
  nextMsgId: number;
  failNextInsertConv: boolean;
  onInsertConvFail: (() => void) | null;
} = {
  convs: [],
  msgs: [],
  nextMsgId: 1,
  failNextInsertConv: false,
  onInsertConvFail: null,
};

// Column markers — handler references e.g. orbConversations.conversationId.
// 我們用字串標記區分欄位。
type Col = { __table: "conv" | "msg"; __field: string };

// Predicate AST produced by the eq/and/inArray/isNull mocks below.
type Pred =
  | { kind: "eq"; col: Col; value: unknown }
  | { kind: "in"; col: Col; values: unknown[] }
  | { kind: "and"; parts: Pred[] }
  | { kind: "true" };

function rowMatches(row: Record<string, unknown>, p: Pred): boolean {
  switch (p.kind) {
    case "true":
      return true;
    case "eq":
      return row[p.col.__field] === p.value;
    case "in":
      return p.values.includes(row[p.col.__field]);
    case "and":
      return p.parts.every(part => rowMatches(row, part));
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (c: Col, value: unknown): Pred => ({ kind: "eq", col: c, value }),
  inArray: (c: Col, values: unknown[]): Pred => ({ kind: "in", col: c, values }),
  and: (...parts: Pred[]): Pred => ({ kind: "and", parts }),
  isNull: (): Pred => ({ kind: "true" }),
  asc: (c: Col) => ({ __order: "asc", col: c }),
  desc: (c: Col) => ({ __order: "desc", col: c }),
  lt: (): Pred => ({ kind: "true" }),
  // Supports tagged-template sql expressions used in .set() — evaluates at update time.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __isSql: true,
    evaluate(row: Record<string, unknown>) {
      // Pattern: sql`${col} + ${n}` — atomic numeric increment
      if (values.length === 2 && strings[1]?.trim() === "+") {
        const col = values[0] as Col;
        const n = Number(values[1]);
        return (Number(row[col.__field]) || 0) + n;
      }
      return strings.join("");
    },
  }),
}));

vi.mock("../../../drizzle/schema", () => {
  // Inline col() — vi.mock is hoisted, so it cannot reference outer-scope vars.
  const c = (table: "conv" | "msg", field: string) => ({
    __table: table,
    __field: field,
  });
  return {
    orbConversations: {
      __which: "conv",
      conversationId: c("conv", "conversationId"),
      userId: c("conv", "userId"),
      title: c("conv", "title"),
      pinned: c("conv", "pinned"),
      archivedAt: c("conv", "archivedAt"),
      lastMessageAt: c("conv", "lastMessageAt"),
      messageCount: c("conv", "messageCount"),
      createdAt: c("conv", "createdAt"),
      updatedAt: c("conv", "updatedAt"),
    },
    orbConversationMessages: {
      __which: "msg",
      messageId: c("msg", "messageId"),
      conversationId: c("msg", "conversationId"),
      userId: c("msg", "userId"),
      role: c("msg", "role"),
      text: c("msg", "text"),
      at: c("msg", "at"),
      metadata: c("msg", "metadata"),
      createdAt: c("msg", "createdAt"),
    },
  };
});

// Minimal chainable query builder over the in-memory store.
function makeDb() {
  return {
    select(_fields?: unknown) {
      let tableRows: Record<string, unknown>[] = [];
      let isCount = false;
      // detect COUNT(*) selection (handler passes { count: sql`COUNT(*)` })
      if (
        _fields &&
        typeof _fields === "object" &&
        "count" in (_fields as Record<string, unknown>)
      ) {
        isCount = true;
      }
      const api = {
        from(table: { __which?: string } | unknown) {
          tableRows = (table as { __which?: string }).__which === "msg"
            ? (store.msgs as unknown as Record<string, unknown>[])
            : (store.convs as unknown as Record<string, unknown>[]);
          return api;
        },
        where(pred: Pred) {
          tableRows = tableRows.filter(r => rowMatches(r, pred));
          return api;
        },
        orderBy() {
          return api;
        },
        limit(_n: number) {
          const rows = tableRows.slice(0, _n);
          return resolve(rows);
        },
        then(onF: (v: unknown) => unknown) {
          // for awaited selects without .limit (the COUNT path uses await + no limit chain? it does .where then await)
          return Promise.resolve(resolve(tableRows)).then(onF);
        },
      };
      function resolve(rows: Record<string, unknown>[]) {
        if (isCount) return [{ count: rows.length }];
        return rows;
      }
      return api;
    },
    insert(table: { __which?: string }) {
      return {
        async values(vals: Record<string, unknown> | Record<string, unknown>[]) {
          const arr = Array.isArray(vals) ? vals : [vals];
          if (table.__which === "msg") {
            for (const v of arr) {
              store.msgs.push({
                messageId: store.nextMsgId++,
                conversationId: String(v.conversationId),
                userId: Number(v.userId),
                role: v.role as "user" | "orb",
                text: String(v.text),
                at: Number(v.at),
                metadata: (v.metadata as Record<string, unknown>) ?? null,
                createdAt: new Date(),
              });
            }
          } else {
            for (const v of arr) {
              if (store.failNextInsertConv) {
                store.failNextInsertConv = false;
                store.onInsertConvFail?.();
                store.onInsertConvFail = null;
                throw new Error("ER_DUP_ENTRY: duplicate primary key");
              }
              if (
                store.convs.some(
                  c => c.conversationId === String(v.conversationId)
                )
              ) {
                throw new Error("ER_DUP_ENTRY: duplicate primary key");
              }
              store.convs.push({
                conversationId: String(v.conversationId),
                userId: Number(v.userId),
                title: String(v.title),
                pinned: Boolean(v.pinned),
                archivedAt: (v.archivedAt as Date | null) ?? null,
                lastMessageAt: (v.lastMessageAt as Date | null) ?? null,
                messageCount: Number(v.messageCount ?? 0),
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          }
        },
      };
    },
    update(_table: unknown) {
      return {
        set(updates: Record<string, unknown>) {
          return {
            async where(pred: Pred) {
              let affected = 0;
              for (const c of store.convs) {
                if (rowMatches(c as unknown as Record<string, unknown>, pred)) {
                  const resolved: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(updates)) {
                    if (v && typeof v === "object" && "__isSql" in (v as Record<string, unknown>)) {
                      resolved[k] = (v as { evaluate(r: Record<string, unknown>): unknown }).evaluate(
                        c as unknown as Record<string, unknown>
                      );
                    } else {
                      resolved[k] = v;
                    }
                  }
                  Object.assign(c, resolved);
                  affected++;
                }
              }
              return { affectedRows: affected };
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        async where() {
          return { affectedRows: 0 };
        },
      };
    },
  };
}

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

import { orbConversationsRouter } from "../orbConversationsRouter";

function callerFor(userId: number) {
  return orbConversationsRouter.createCaller({
    user: { id: userId, role: "user", name: "Tester" },
    req: { headers: {}, header: () => undefined },
    res: { setHeader: () => {} },
    orbTraceId: "test-trace",
  } as never);
}

beforeEach(() => {
  store.convs = [];
  store.msgs = [];
  store.nextMsgId = 1;
  store.failNextInsertConv = false;
  store.onInsertConvFail = null;
});

describe("AIDV-157 appendMessages — lazy create on missing conversation", () => {
  it("列不存在 → 自動建立並寫入訊息,不再丟 Conversation not found", async () => {
    const caller = callerFor(1);
    const conversationId = "conv_local_orphan_1";

    await expect(
      caller.appendMessages({
        conversationId,
        messages: [
          { role: "user", text: "幫我列第一鏡的分鏡", at: 1000 },
        ],
      })
    ).resolves.toMatchObject({ ok: true, messageCount: 1 });

    // 列已被建立且 scoped 到 caller
    const created = store.convs.find(c => c.conversationId === conversationId);
    expect(created).toBeDefined();
    expect(created!.userId).toBe(1);
    // auto-title 用第一則 user 訊息
    expect(created!.title).toBe("幫我列第一鏡的分鏡");
    // 訊息寫入
    expect(store.msgs.filter(m => m.conversationId === conversationId)).toHaveLength(1);
  });

  it("Scoped:別的 user 占用同 conversationId → FORBIDDEN,絕不附加到別人對話", async () => {
    // user 2 先擁有這個 id
    store.convs.push({
      conversationId: "conv_shared",
      userId: 2,
      title: "u2 的對話",
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const intruder = callerFor(1);
    await expect(
      intruder.appendMessages({
        conversationId: "conv_shared",
        messages: [{ role: "user", text: "想偷看別人對話", at: 2000 }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // user 2 的對話沒被污染
    const u2 = store.convs.find(c => c.conversationId === "conv_shared");
    expect(u2!.userId).toBe(2);
    expect(u2!.messageCount).toBe(0);
    expect(store.msgs).toHaveLength(0);
  });

  it("Idempotent:對同一新 id 連送兩批(at 重複)→ 只有一列、訊息去重、count 不灌水", async () => {
    const caller = callerFor(5);
    const conversationId = "conv_idem";
    const batch = {
      conversationId,
      messages: [
        { role: "user" as const, text: "第一句", at: 100 },
        { role: "orb" as const, text: "回覆", at: 101 },
      ],
    };
    await caller.appendMessages(batch);
    // 重送同一批(重試 / 雙擊)
    const res2 = await caller.appendMessages(batch);

    expect(store.convs.filter(c => c.conversationId === conversationId)).toHaveLength(1);
    expect(store.msgs.filter(m => m.conversationId === conversationId)).toHaveLength(2);
    expect(res2.messageCount).toBe(2);
  });

  it("Idempotent(競態):lazy-create insert 撞主鍵 → 吞掉並回讀,最終一列且屬於 caller", async () => {
    // 競態場景:本請求查無列 → 進 lazy-create;但在它 insert 之前,另一併發請求
    // 已搶先建立同列(屬於 caller)。本請求 insert 撞主鍵 → handler catch 後回讀
    // 到對手建立的那一列,正常完成 append。
    //
    // 用 phantomFirstRead 讓「第一次以 PK 查 conv」回空(模擬尚未建立),
    // 之後再放入「對手建立的列」,並用 failNextInsertConv 讓本請求 insert 撞鍵。
    const caller = callerFor(9);
    const conversationId = "conv_race";
    const opponentRow: ConvRow = {
      conversationId,
      userId: 9,
      title: "新對話",
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.failNextInsertConv = true; // 本請求的 conv insert 會撞鍵
    store.onInsertConvFail = () => {
      // insert 撞鍵的瞬間,讓對手建立的列「出現」,供 handler 回讀。
      store.convs.push(opponentRow);
    };

    await expect(
      caller.appendMessages({
        conversationId,
        messages: [{ role: "user", text: "競態訊息", at: 300 }],
      })
    ).resolves.toMatchObject({ ok: true });

    expect(store.convs.filter(c => c.conversationId === conversationId)).toHaveLength(1);
    expect(store.convs.find(c => c.conversationId === conversationId)!.userId).toBe(9);
    // 訊息有寫入(append 在回讀到列後正常進行)
    expect(store.msgs.filter(m => m.conversationId === conversationId)).toHaveLength(1);
  });

  it("既有正常路徑:列已存在且屬於 caller → 更新計數 + auto-title,行為不變", async () => {
    const caller = callerFor(3);
    const conversationId = "conv_existing";
    store.convs.push({
      conversationId,
      userId: 3,
      title: "新對話",
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await caller.appendMessages({
      conversationId,
      messages: [
        { role: "user", text: "既有對話的第一句話會變標題", at: 500 },
        { role: "orb", text: "好的", at: 501 },
      ],
    });
    expect(res.messageCount).toBe(2);
    const row = store.convs.find(c => c.conversationId === conversationId)!;
    // 沒有新增重複列
    expect(store.convs.filter(c => c.conversationId === conversationId)).toHaveLength(1);
    // auto-title 從預設占位符換成第一則 user 訊息
    expect(row.title).toBe("既有對話的第一句話會變標題");
    expect(row.messageCount).toBe(2);
  });
});
