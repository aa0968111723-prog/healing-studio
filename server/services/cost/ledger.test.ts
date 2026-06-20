/**
 * ledger.test.ts — AIDV-153 成本帳本服務測試
 * ──────────────────────────────────────────────────────────────────────────
 * 覆蓋驗收項：
 *   - postEntry 冪等（重複 idempotencyKey 不重複入帳）
 *   - computeBalance 由 log 正確加總（SUM(credit) - SUM(debit)，只計 posted）
 *   - 旗標 OFF（isCostLedgerEnabled）— 控制接線端是否寫 ledger
 *   - demo/無 DB 安全 skip（db=null 永不 throw）
 *   - normalizeAmount / makeAccountKey 純函式正確
 *   - hold 生命週期（pending 不計入餘額）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  postEntry,
  postTransaction,
  holdEntry,
  postHold,
  archiveHold,
  computeBalance,
  summarizeBalance,
  assertGlobalBalanced,
  hashIdempotencyKey,
  EXPENSE_AI_COST_ACCOUNT,
  normalizeAmount,
  makeAccountKey,
  isCostLedgerEnabled,
  type LedgerDb,
  type LedgerEntryType,
  type LedgerStatus,
} from "./ledger";

// ─── In-memory fake DB（實作 LedgerDb 結構型別，含 UNIQUE 冪等模擬）──────────

interface FakeRow {
  accountKey: string;
  entryType: LedgerEntryType;
  amount: string;
  status: LedgerStatus;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
}

/**
 * 建一個 fake LedgerDb：以 idempotencyKey 為 UNIQUE 鍵的記憶體陣列。
 * - insert().values() 撞重複 idempotencyKey → throw ER_DUP_ENTRY（模擬 DB UNIQUE）。
 * - select().from().where() 依 where 條件粗略過濾（測試只用到兩種 where）。
 * lastWhere 由 service 傳入的 drizzle 條件無法在 fake 端解析，故我們改用
 * service 對 fake 的呼叫順序 + 一個可控的 where matcher。
 */
function makeFakeDb(opts?: { failSelect?: boolean }) {
  const rows: FakeRow[] = [];
  // 由測試設定當前查詢要套用的過濾條件。
  let selectFilter: (r: FakeRow) => boolean = () => true;

  const db: LedgerDb & {
    _rows: FakeRow[];
    _setSelectFilter: (f: (r: FakeRow) => boolean) => void;
  } = {
    _rows: rows,
    _setSelectFilter(f) {
      selectFilter = f;
    },
    insert() {
      return {
        async values(v: FakeRow | FakeRow[]) {
          // 支援單列或多列（複式分錄成對寫入）。整批 atomic：任一腳撞鍵則整批 throw。
          const batch = Array.isArray(v) ? v : [v];
          for (const row of batch) {
            if (
              rows.some(r => r.idempotencyKey === row.idempotencyKey) ||
              batch.filter(b => b.idempotencyKey === row.idempotencyKey).length > 1
            ) {
              const err = new Error("Duplicate entry") as Error & {
                code: string;
                errno: number;
              };
              err.code = "ER_DUP_ENTRY";
              err.errno = 1062;
              throw err;
            }
          }
          for (const row of batch) rows.push({ ...row });
          return undefined;
        },
      };
    },
    select() {
      return {
        from() {
          return {
            async where() {
              if (opts?.failSelect) throw new Error("select boom");
              return rows.filter(selectFilter);
            },
          };
        },
      };
    },
  };
  return db;
}

const ORIGINAL_FLAG = process.env.ENABLE_COST_LEDGER;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.ENABLE_COST_LEDGER;
  else process.env.ENABLE_COST_LEDGER = ORIGINAL_FLAG;
  vi.restoreAllMocks();
});

// ─── normalizeAmount ─────────────────────────────────────────────────────────

describe("normalizeAmount", () => {
  it("正常數字 → 定點 6 位字串", () => {
    expect(normalizeAmount(0.0024)).toBe("0.002400");
    expect(normalizeAmount("1.5")).toBe("1.500000");
  });
  it("負值 / NaN / 非法字串 / 物件 → '0'", () => {
    expect(normalizeAmount(-1)).toBe("0");
    expect(normalizeAmount(Number.NaN)).toBe("0");
    expect(normalizeAmount("free")).toBe("0");
    expect(normalizeAmount({} as unknown)).toBe("0");
    expect(normalizeAmount("1,234.56")).toBe("0");
  });
  it("溢位 clamp 到 DECIMAL(12,6) 上限", () => {
    expect(normalizeAmount(1e12)).toBe("999999.999999");
  });
});

describe("makeAccountKey", () => {
  it("組成 <type>:<id>", () => {
    expect(makeAccountKey("member", 42)).toBe("member:42");
    expect(makeAccountKey("project", " p1 ")).toBe("project:p1");
  });
});

// ─── isCostLedgerEnabled（旗標 OFF 預設）────────────────────────────────────

describe("isCostLedgerEnabled — 預設 OFF", () => {
  it("未設 / 空字串 / 0 / false / off → false", () => {
    delete process.env.ENABLE_COST_LEDGER;
    expect(isCostLedgerEnabled()).toBe(false);
    for (const v of ["", "0", "false", "off", "no", "disabled", " FALSE "]) {
      process.env.ENABLE_COST_LEDGER = v;
      expect(isCostLedgerEnabled()).toBe(false);
    }
  });
  it("1 / true / on → true", () => {
    for (const v of ["1", "true", "on", "yes"]) {
      process.env.ENABLE_COST_LEDGER = v;
      expect(isCostLedgerEnabled()).toBe(true);
    }
  });
});

// ─── demo / 無 DB 安全 skip ──────────────────────────────────────────────────

describe("demo/無 DB 安全 skip", () => {
  it("postEntry(null) → skipped，永不 throw", async () => {
    const r = await postEntry(null, {
      accountKey: "member:1",
      entryType: "debit",
      amount: 1,
      idempotencyKey: "k1",
    });
    expect(r.outcome).toBe("skipped");
  });
  it("computeBalance(null) → 0，永不 throw", async () => {
    expect(await computeBalance(null, "member:1")).toBe(0);
  });
  it("computeBalance(undefined) → 0", async () => {
    expect(await computeBalance(undefined, "member:1")).toBe(0);
  });
});

// ─── postEntry 冪等 ──────────────────────────────────────────────────────────

describe("postEntry — 冪等（重複 idempotencyKey 不重複入帳）", () => {
  it("同 key 第二次 → duplicate，且只入一筆", async () => {
    const db = makeFakeDb();
    // select 快路徑：以 idempotencyKey 過濾。
    const input = {
      accountKey: "member:1",
      entryType: "debit" as const,
      amount: 0.01,
      idempotencyKey: "dup-key",
    };
    db._setSelectFilter(r => r.idempotencyKey === "dup-key");

    const r1 = await postEntry(db, input);
    expect(r1.outcome).toBe("inserted");

    const r2 = await postEntry(db, input);
    expect(r2.outcome).toBe("duplicate");

    expect(db._rows.filter(r => r.idempotencyKey === "dup-key")).toHaveLength(1);
  });

  it("select 快路徑失敗時，UNIQUE 約束兜底仍冪等（duplicate）", async () => {
    // failSelect=true → 快路徑 select throw（被吞），靠 insert 撞 ER_DUP_ENTRY。
    const db = makeFakeDb({ failSelect: true });
    const input = {
      accountKey: "member:1",
      entryType: "debit" as const,
      amount: 0.01,
      idempotencyKey: "race-key",
    };
    const r1 = await postEntry(db, input);
    expect(r1.outcome).toBe("inserted");
    const r2 = await postEntry(db, input);
    expect(r2.outcome).toBe("duplicate");
    expect(db._rows).toHaveLength(1);
  });

  it("金額正規化為 0（負/非法）→ invalid，不入帳", async () => {
    const db = makeFakeDb();
    const r = await postEntry(db, {
      accountKey: "member:1",
      entryType: "debit",
      amount: -5,
      idempotencyKey: "neg",
    });
    expect(r.outcome).toBe("invalid");
    expect(db._rows).toHaveLength(0);
  });
});

// ─── computeBalance 由 log 加總 ──────────────────────────────────────────────

describe("summarizeBalance（純函式）", () => {
  it("balance = SUM(credit) - SUM(debit)", () => {
    expect(
      summarizeBalance([
        { entryType: "credit", amount: "10" },
        { entryType: "debit", amount: "3" },
        { entryType: "debit", amount: "2.5" },
      ])
    ).toBe(4.5);
  });
  it("負/NaN amount 被跳過", () => {
    expect(
      summarizeBalance([
        { entryType: "credit", amount: "10" },
        { entryType: "debit", amount: "-1" },
        { entryType: "debit", amount: "abc" as unknown as string },
      ])
    ).toBe(10);
  });
});

describe("computeBalance — 由 log 正確加總（只計 posted）", () => {
  it("加總 posted credit - debit，忽略 pending/archived", async () => {
    const db = makeFakeDb();
    // 直接塞 row（模擬已入帳的 log）。
    db._rows.push(
      { accountKey: "member:7", entryType: "credit", amount: "100.000000", status: "posted", idempotencyKey: "c1", refType: null, refId: null },
      { accountKey: "member:7", entryType: "debit", amount: "30.000000", status: "posted", idempotencyKey: "d1", refType: null, refId: null },
      { accountKey: "member:7", entryType: "debit", amount: "5.000000", status: "pending", idempotencyKey: "h1", refType: null, refId: null },
      { accountKey: "member:7", entryType: "debit", amount: "9.000000", status: "archived", idempotencyKey: "a1", refType: null, refId: null }
    );
    // computeBalance 的 where＝accountKey=member:7 AND status=posted。
    db._setSelectFilter(
      r => r.accountKey === "member:7" && r.status === "posted"
    );
    const bal = await computeBalance(db, "member:7");
    expect(bal).toBe(70); // 100 - 30；pending(5)/archived(9) 不計
  });
});

// ─── hold 生命週期 ───────────────────────────────────────────────────────────

describe("hold 生命週期", () => {
  it("holdEntry 寫入 status=pending", async () => {
    const db = makeFakeDb();
    db._setSelectFilter(r => r.idempotencyKey === "hold-1");
    const r = await holdEntry(db, {
      accountKey: "workflow:9",
      entryType: "debit",
      amount: 2,
      idempotencyKey: "hold-1",
    });
    expect(r.outcome).toBe("inserted");
    expect(db._rows[0].status).toBe("pending");
  });

  it("pending → posted（postHold append posted 列，pending 保留為歷史；餘額前後反映）", async () => {
    const db = makeFakeDb();
    const acct = "member:hold-flow";
    // 起點：pending hold（不計入餘額）。
    db._setSelectFilter(r => r.idempotencyKey === "hk-1");
    await holdEntry(db, {
      accountKey: acct,
      entryType: "debit",
      amount: 5,
      idempotencyKey: "hk-1",
    });
    // 結算前 balance（只計 posted）＝0。
    db._setSelectFilter(r => r.accountKey === acct && r.status === "posted");
    expect(await computeBalance(db, acct)).toBe(0);

    // postHold：append posted 列（idempotencyKey 衍生為 hk-1:posted）。
    db._setSelectFilter(r => r.idempotencyKey === "hk-1:posted");
    const posted = await postHold(db, {
      accountKey: acct,
      entryType: "debit",
      amount: 5,
      holdKey: "hk-1",
    });
    expect(posted.outcome).toBe("inserted");

    // pending 列仍在（append-only，未被 UPDATE）。
    expect(db._rows.filter(r => r.status === "pending")).toHaveLength(1);
    // 結算後 balance＝ -5（debit posted）。
    db._setSelectFilter(r => r.accountKey === acct && r.status === "posted");
    expect(await computeBalance(db, acct)).toBe(-5);
  });

  it("pending → archived（archiveHold append archived 列，不計入餘額）", async () => {
    const db = makeFakeDb();
    const acct = "member:hold-cancel";
    db._setSelectFilter(r => r.idempotencyKey === "hk-2");
    await holdEntry(db, {
      accountKey: acct,
      entryType: "debit",
      amount: 8,
      idempotencyKey: "hk-2",
    });
    db._setSelectFilter(r => r.idempotencyKey === "hk-2:archived");
    const archived = await archiveHold(db, {
      accountKey: acct,
      entryType: "debit",
      amount: 8,
      holdKey: "hk-2",
    });
    expect(archived.outcome).toBe("inserted");
    // archived 不計入 posted 餘額 → 仍 0（額度等效釋放）。
    db._setSelectFilter(r => r.accountKey === acct && r.status === "posted");
    expect(await computeBalance(db, acct)).toBe(0);
    expect(db._rows.filter(r => r.status === "archived")).toHaveLength(1);
  });
});

// ─── postTransaction：複式分錄成對借＋貸 ─────────────────────────────────────

describe("postTransaction — 平衡的複式分錄（debit from + credit to）", () => {
  it("寫成對 debit/credit，金額相等、全域 SUM(credit)-SUM(debit)==0", async () => {
    const db = makeFakeDb();
    db._setSelectFilter(r => r.idempotencyKey === "tx-1:debit");
    const r = await postTransaction(db, {
      fromAccount: "member:1",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 0.0024,
      idempotencyKey: "tx-1",
    });
    expect(r.outcome).toBe("inserted");
    expect(db._rows).toHaveLength(2);
    const debit = db._rows.find(x => x.entryType === "debit")!;
    const credit = db._rows.find(x => x.entryType === "credit")!;
    expect(debit.accountKey).toBe("member:1");
    expect(credit.accountKey).toBe(EXPENSE_AI_COST_ACCOUNT);
    expect(debit.amount).toBe(credit.amount);

    // 全域不變式：所有 posted 的 SUM(credit) - SUM(debit) == 0。
    db._setSelectFilter(r => r.status === "posted");
    const { balanced, delta } = await assertGlobalBalanced(db);
    expect(balanced).toBe(true);
    expect(delta).toBe(0);
  });

  it("同 idempotencyKey 第二次 → duplicate，不重複入帳（仍只 2 列）", async () => {
    const db = makeFakeDb();
    db._setSelectFilter(r => r.idempotencyKey === "tx-dup:debit");
    const input = {
      fromAccount: "member:1",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 1,
      idempotencyKey: "tx-dup",
    };
    expect((await postTransaction(db, input)).outcome).toBe("inserted");
    expect((await postTransaction(db, input)).outcome).toBe("duplicate");
    expect(db._rows).toHaveLength(2);
  });

  it("金額 0 → invalid（不入帳）；無 db → skipped", async () => {
    const db = makeFakeDb();
    const inv = await postTransaction(db, {
      fromAccount: "member:1",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 0,
      idempotencyKey: "tx-zero",
    });
    expect(inv.outcome).toBe("invalid");
    expect(db._rows).toHaveLength(0);
    expect(
      (
        await postTransaction(null, {
          fromAccount: "member:1",
          toAccount: EXPENSE_AI_COST_ACCOUNT,
          amount: 1,
          idempotencyKey: "tx-skip",
        })
      ).outcome
    ).toBe("skipped");
  });

  it(">191 字元 endpoint：用 hashIdempotencyKey 後兩個不同事件都成功入帳（不撞鍵丟帳）", async () => {
    const db = makeFakeDb();
    const longEndpoint = "fal-ai/" + "x".repeat(500); // 遠超 varchar(191)
    // 接線端應改用穩定事件鍵；此處驗證若必須含 endpoint，hash 後長度有界且唯一。
    const key1 = hashIdempotencyKey("aue", `${longEndpoint}:event-1`);
    const key2 = hashIdempotencyKey("aue", `${longEndpoint}:event-2`);
    expect(key1.length).toBeLessThanOrEqual(191);
    expect(key2.length).toBeLessThanOrEqual(191);
    expect(key1).not.toBe(key2);

    db._setSelectFilter(r => r.idempotencyKey === `${key1}:debit`);
    expect((await postTransaction(db, {
      fromAccount: "member:anon",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 0.01,
      idempotencyKey: key1,
    })).outcome).toBe("inserted");

    db._setSelectFilter(r => r.idempotencyKey === `${key2}:debit`);
    expect((await postTransaction(db, {
      fromAccount: "member:anon",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 0.01,
      idempotencyKey: key2,
    })).outcome).toBe("inserted");

    // 兩個不同事件都落帳（各 2 列）＝沒有靜默丟帳。
    expect(db._rows).toHaveLength(4);
  });
});

describe("assertGlobalBalanced — 完整性不變式", () => {
  it("成對交易 → balanced=true；混入單腳 postEntry → 偵測 delta≠0", async () => {
    const db = makeFakeDb();
    db._setSelectFilter(r => r.idempotencyKey === "bal-1:debit");
    await postTransaction(db, {
      fromAccount: "member:1",
      toAccount: EXPENSE_AI_COST_ACCOUNT,
      amount: 10,
      idempotencyKey: "bal-1",
    });
    db._setSelectFilter(r => r.status === "posted");
    expect((await assertGlobalBalanced(db)).balanced).toBe(true);

    // 故意寫一個未配對的單腳 debit → 破壞平衡。
    db._setSelectFilter(r => r.idempotencyKey === "orphan");
    await postEntry(db, {
      accountKey: "member:2",
      entryType: "debit",
      amount: 3,
      idempotencyKey: "orphan",
    });
    db._setSelectFilter(r => r.status === "posted");
    const after = await assertGlobalBalanced(db);
    expect(after.balanced).toBe(false);
    expect(after.delta).toBe(-3); // credit(10) - debit(10+3)
  });

  it("無 db → balanced=true（demo/無 DB 安全）", async () => {
    expect(await assertGlobalBalanced(null)).toEqual({
      balanced: true,
      delta: 0,
    });
  });
});
