/**
 * aidv-780-idor-race.test.ts — AIDV-780 項 11／12／13
 *
 * 釘住三項安全加固：
 *   11. IDOR：orbClarificationEngine.recordAnswer 以 userId 圈定擁有者 —
 *       非本人（或不存在）的 clarificationId 一律拒絕、不改資料。
 *   12. 競態：notesCuratorTools.tagAssets 的 read-modify-write 包進
 *       db.transaction ＋ SELECT ... FOR UPDATE 行鎖。
 *   13. 競態：showcase.promote 每日 5 件上限的 count＋insert 包進單一交易
 *       （count 走 FOR UPDATE），並發提交無法繞過上限。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 隔離 DB — 個別測試以 mockGetDb 控制回傳的 fluent mock db
const mockGetDb = vi.fn();
vi.mock("./db", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  escapeLikePattern: (raw: string) => raw.replace(/[\\%_]/g, s => `\\${s}`),
}));

import { orbClarificationEngine } from "./services/orbClarificationEngine";
import { tagAssets } from "./services/spiritTools/notesCuratorTools";
import { showcaseRouter } from "./routers/showcase";

/**
 * Fluent drizzle mock：所有鏈式方法回傳同一 chain（thenable），
 * 每次 await 依序從 queue 取一個結果；所有方法呼叫都記錄在 calls。
 */
function makeFluentDb(queue: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return chain;
    };
  for (const m of [
    "select",
    "from",
    "where",
    "limit",
    "for",
    "orderBy",
    "set",
    "values",
    "groupBy",
    "update",
    "insert",
  ]) {
    chain[m] = record(m);
  }
  (chain as any).then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown
  ) => {
    const next = queue.length ? queue.shift() : [];
    return Promise.resolve(next).then(resolve, reject);
  };

  const db: any = {
    select: record("select"),
    update: record("update"),
    insert: record("insert"),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return { db, calls };
}

beforeEach(() => {
  mockGetDb.mockReset();
});

// ─── 項 11：recordAnswer IDOR ────────────────────────────────────────────────

describe("orbClarificationEngine.recordAnswer — userId 擁有者圈定（AIDV-780）", () => {
  it("非本人／不存在的 clarificationId → 拒絕且不回傳他人資料", async () => {
    // owner-scoped select 查無資料（他人的紀錄被 userId 條件濾掉）
    const { db } = makeFluentDb([
      undefined, // update().set().where() — WHERE 含 userId，不中任何列
      [], // select().from().where() — owner-scoped 查無
    ]);
    mockGetDb.mockResolvedValue(db);

    await expect(
      orbClarificationEngine.recordAnswer("123", "attacker answer", 999)
    ).rejects.toThrow(/clarification-not-found-or-not-owned/);
  });

  it("本人紀錄 → 正常記錄答案（正常路徑零變化）", async () => {
    const ownRow = {
      id: 123,
      intentLogId: 1,
      userId: 7,
      conversationId: "conv-1",
      clarificationQuestion: "which style?",
      questionType: "choice",
      options: null,
      userAnswer: "answer-1",
      answeredAt: new Date(),
      resolvedIntent: null,
      resolutionConfidence: null,
      spiritAsked: null,
      createdAt: new Date(),
    };
    const { db } = makeFluentDb([
      undefined, // update — owner-scoped
      [ownRow], // select — owner-scoped 查到本人紀錄
      [], // updateAnswerPattern 內部 select
      undefined, // updateAnswerPattern 內部 insert
    ]);
    mockGetDb.mockResolvedValue(db);

    const result = await orbClarificationEngine.recordAnswer(
      "123",
      "answer-1",
      7
    );
    expect(result.id).toBe("123");
    expect(result.userId).toBe(7);
    expect(result.userAnswer).toBe("answer-1");
  });
});

// ─── 項 12：tagAssets 交易＋行鎖 ─────────────────────────────────────────────

describe("notesCuratorTools.tagAssets — 交易＋FOR UPDATE（AIDV-780）", () => {
  it("read-modify-write 走 db.transaction，select 帶 FOR UPDATE 行鎖", async () => {
    const { db, calls } = makeFluentDb([
      [{ id: 11, tags: ["existing"] }], // tx.select().where().for("update")
      undefined, // tx.update().set().where()
    ]);
    mockGetDb.mockResolvedValue(db);

    const result = await tagAssets({
      userId: 7,
      assetIds: [11],
      tags: ["new-tag"],
      action: "add",
    });

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    // 包在交易內
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // SELECT ... FOR UPDATE 行鎖
    expect(calls.for).toBeTruthy();
    expect(calls.for[0][0]).toBe("update");
    // 合併寫回（existing + new-tag，不覆寫既有標籤）
    const setArg = calls.set[0][0] as { tags: string[] };
    expect(setArg.tags).toEqual(["existing", "new-tag"]);
  });
});

// ─── 項 13：showcase.promote 每日上限交易化 ──────────────────────────────────

describe("showcase.promote — 每日上限 count＋insert 單一交易（AIDV-780）", () => {
  const ctx: any = {
    user: { id: 7, role: "user" },
    req: { headers: {}, ip: "127.0.0.1" },
  };

  const historyItem = {
    id: 42,
    userId: 7,
    resultUrl: "https://cdn.example.com/art.png",
    thumbnailUrl: null,
    prompt: "a prompt",
    modality: "image",
  };

  it("今日已達 5 件 → 交易內 TOO_MANY_REQUESTS，且不 insert", async () => {
    const { db, calls } = makeFluentDb([
      [historyItem], // select generationHistory ... limit(1)
      [{ count: 5 }], // tx count ... for("update")
    ]);
    mockGetDb.mockResolvedValue(db);

    const caller = showcaseRouter.createCaller(ctx);
    await expect(
      caller.promote({ historyId: 42, title: "my art" })
    ).rejects.toThrow(/今日提交數量已達上限/);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // count 查詢帶 FOR UPDATE 行鎖
    expect(calls.for[0][0]).toBe("update");
    // 未達 insert
    expect(calls.insert ?? []).toHaveLength(0);
  });

  it("未達上限 → 同一交易內 insert 成功（正常路徑零變化）", async () => {
    const { db, calls } = makeFluentDb([
      [historyItem], // select generationHistory ... limit(1)
      [{ count: 2 }], // tx count ... for("update")
      undefined, // tx.insert().values()
    ]);
    mockGetDb.mockResolvedValue(db);

    const caller = showcaseRouter.createCaller(ctx);
    const result = await caller.promote({ historyId: 42, title: "my art" });

    expect(result).toEqual({ success: true });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(calls.insert).toHaveLength(1);
    const values = calls.values[0][0] as Record<string, unknown>;
    expect(values.curatorUserId).toBe(7);
    expect(values.generatedItemId).toBe(42);
  });
});
