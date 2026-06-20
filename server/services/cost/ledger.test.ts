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
  holdEntry,
  computeBalance,
  summarizeBalance,
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
        async values(v: FakeRow) {
          if (rows.some(r => r.idempotencyKey === v.idempotencyKey)) {
            const err = new Error("Duplicate entry") as Error & {
              code: string;
              errno: number;
            };
            err.code = "ER_DUP_ENTRY";
            err.errno = 1062;
            throw err;
          }
          rows.push({ ...v });
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
});
