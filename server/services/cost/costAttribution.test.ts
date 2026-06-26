/**
 * costAttribution.test.ts — AIDV-14 內部成本歸屬可視測試
 * ──────────────────────────────────────────────────────────────────────────
 * 覆蓋驗收項：
 *   - 真實價換算 TWD 正確（匯率可設：TWD_PER_USD→USD_TO_TWD_RATE→default）
 *   - 歸屬正確（member 必有；project/workflow 拿得到才有、拿不到誠實留空）
 *   - outbox 補帳（enqueue 冪等、drain 成功標 done、失敗 attempts++/超上限 dead）
 *   - $0.00 修好（彙總用真實 USD 換 TWD，非 $0）
 *   - 彙總正確（依 project/member/workflow 加總，以 TWD）
 *   - demo/無 DB 跳過（db=null 永不 throw）
 *   - 旗標預設 ON
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isCostAttributionEnabled,
  getTwdPerUsd,
  buildAttributionEntries,
  postAttributedCost,
  enqueueAttribution,
  drainAttributionOutbox,
  summarizeAttribution,
  OUTBOX_MAX_ATTEMPTS,
  type UsageAttributionInput,
  type OutboxDb,
  type LedgerRowForSummary,
} from "./costAttribution";

// ─── In-memory fake DB（ledger + outbox 共用一個記憶體陣列模型）────────────────

interface LedgerRow {
  accountKey: string;
  entryType: "debit" | "credit";
  amount: string;
  status: string;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
  amountTwd?: string | null;
  exchangeRate?: string | null;
  sourceCurrency?: string | null;
  provider?: string | null;
  model?: string | null;
  costSource?: string | null;
  skillId?: string | null;
}

interface OutboxRow {
  id: number;
  idempotencyKey: string;
  status: "pending" | "done" | "dead";
  payloadJson: UsageAttributionInput;
  attempts: number;
  lastError?: string | null;
  updatedAt?: Date;
}

/**
 * 建一個同時實作 ledger（insert/select）與 outbox（insert/select.where.limit/update）
 * 的 fake。以「最近一次 insert/select/update 的 table 物件」粗略判斷打哪張表——這裡靠
 * 呼叫順序與 where 條件分流，足夠覆蓋本測試用到的路徑。
 *
 * failLedgerInsert：讓 ledger 的 postTransaction insert throw（測 drain 重試/dead）。
 */
function makeFakeDb(opts?: { failLedgerInsert?: boolean }): OutboxDb & {
  _ledger: LedgerRow[];
  _outbox: OutboxRow[];
} {
  const ledger: LedgerRow[] = [];
  const outbox: OutboxRow[] = [];
  let outboxSeq = 1;

  // 用 table 物件的 Symbol 標記區分兩張表。drizzle table 物件不易在 fake 端辨識，
  // 故改用「插入列的形狀」分流：outbox row 帶 payloadJson，ledger row 帶 entryType。
  const db = {
    _ledger: ledger,
    _outbox: outbox,
    insert() {
      return {
        async values(v: unknown) {
          const batch = Array.isArray(v) ? v : [v];
          const first = batch[0] as Record<string, unknown>;
          if (first && "payloadJson" in first) {
            // outbox insert（單列）
            for (const row of batch as Array<Record<string, unknown>>) {
              if (
                outbox.some(o => o.idempotencyKey === row.idempotencyKey)
              ) {
                const err = new Error("Duplicate entry") as Error & {
                  code: string;
                  errno: number;
                };
                err.code = "ER_DUP_ENTRY";
                err.errno = 1062;
                throw err;
              }
              outbox.push({
                id: outboxSeq++,
                idempotencyKey: String(row.idempotencyKey),
                status: (row.status as OutboxRow["status"]) ?? "pending",
                payloadJson: row.payloadJson as UsageAttributionInput,
                attempts: Number(row.attempts ?? 0),
              });
            }
            return undefined;
          }
          // ledger insert（成對借貸）
          if (opts?.failLedgerInsert) {
            throw new Error("ledger insert boom");
          }
          for (const row of batch as Array<Record<string, unknown>>) {
            if (ledger.some(l => l.idempotencyKey === row.idempotencyKey)) {
              const err = new Error("Duplicate entry") as Error & {
                code: string;
                errno: number;
              };
              err.code = "ER_DUP_ENTRY";
              err.errno = 1062;
              throw err;
            }
          }
          for (const row of batch as Array<Record<string, unknown>>) {
            ledger.push(row as unknown as LedgerRow);
          }
          return undefined;
        },
      };
    },
    select(cols?: Record<string, unknown>) {
      const isOutboxSelect = !!cols && "payloadJson" in cols;
      return {
        from() {
          const whereResult = (_cond: unknown) => {
            // ledger 的 postTransaction 快路徑 select 是「依 idempotencyKey 查重」；
            // fake 端無法解析 drizzle eq() 條件，故一律回 []（不命中快路徑），讓真正的
            // 查重交給 insert 的 UNIQUE 模擬（撞鍵 throw ER_DUP_ENTRY）兜底——這與真 DB
            // 行為等價（非重複→insert 成功；重複→insert throw→postTransaction 回 duplicate）。
            // outbox 的 drain select 才需要回實際 pending 列。
            const base = isOutboxSelect
              ? outbox.filter(o => o.status === "pending")
              : [];
            const promise = Promise.resolve(base as unknown[]);
            return Object.assign(promise, {
              limit: (n: number) =>
                Promise.resolve((base as unknown[]).slice(0, n)),
            });
          };
          return { where: whereResult };
        },
      };
    },
    update() {
      return {
        set(v: Record<string, unknown>) {
          return {
            async where(cond: unknown) {
              // cond 是 drizzle eq(id, X)；fake 端解析不到，改用「最後一筆 pending」
              // 不可靠，故我們改在 drain 端逐列處理時用 id 對應：這裡掃 outbox 找出
              // 尚未被本次更新標記的 pending 列。簡化：用 v 裡帶的識別不可得，故改
              // 由呼叫端保證一次只更新一列——我們用 _pendingUpdateId 傳遞。
              const id = (db as unknown as { _updId?: number })._updId;
              const target =
                id != null
                  ? outbox.find(o => o.id === id)
                  : outbox.find(o => o.status === "pending");
              if (target) {
                if (v.status) target.status = v.status as OutboxRow["status"];
                if (v.attempts != null) target.attempts = Number(v.attempts);
                if (v.lastError != null)
                  target.lastError = String(v.lastError);
              }
              void cond;
              return undefined;
            },
          };
        },
      };
    },
  };
  return db as unknown as OutboxDb & { _ledger: LedgerRow[]; _outbox: OutboxRow[] };
}

const ORIG_FLAG = process.env.ENABLE_COST_ATTRIBUTION;
const ORIG_TWD = process.env.TWD_PER_USD;
const ORIG_USD_RATE = process.env.USD_TO_TWD_RATE;

afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_COST_ATTRIBUTION;
  else process.env.ENABLE_COST_ATTRIBUTION = ORIG_FLAG;
  if (ORIG_TWD === undefined) delete process.env.TWD_PER_USD;
  else process.env.TWD_PER_USD = ORIG_TWD;
  if (ORIG_USD_RATE === undefined) delete process.env.USD_TO_TWD_RATE;
  else process.env.USD_TO_TWD_RATE = ORIG_USD_RATE;
  vi.restoreAllMocks();
});

// ─── 旗標（預設 ON）─────────────────────────────────────────────────────────

describe("isCostAttributionEnabled — 預設 ON", () => {
  it("未設 env → 預設 true（ON）", () => {
    delete process.env.ENABLE_COST_ATTRIBUTION;
    expect(isCostAttributionEnabled()).toBe(true);
  });
  it("空字串 → 預設 true", () => {
    process.env.ENABLE_COST_ATTRIBUTION = "";
    expect(isCostAttributionEnabled()).toBe(true);
  });
  it("false/0/off → 關閉", () => {
    for (const v of ["false", "0", "off", "no", "disabled"]) {
      process.env.ENABLE_COST_ATTRIBUTION = v;
      expect(isCostAttributionEnabled()).toBe(false);
    }
  });
  it("true/1/on → 開啟", () => {
    for (const v of ["true", "1", "on", "yes"]) {
      process.env.ENABLE_COST_ATTRIBUTION = v;
      expect(isCostAttributionEnabled()).toBe(true);
    }
  });
});

// ─── 匯率可設 ───────────────────────────────────────────────────────────────

describe("getTwdPerUsd — 匯率可設、來源優先序", () => {
  it("TWD_PER_USD 優先（規格名，預設約 32）", () => {
    expect(getTwdPerUsd({ TWD_PER_USD: "32", USD_TO_TWD_RATE: "31.5" })).toBe(32);
  });
  it("TWD_PER_USD 未設 → 退回 USD_TO_TWD_RATE", () => {
    expect(getTwdPerUsd({ USD_TO_TWD_RATE: "30" })).toBe(30);
  });
  it("兩者皆未設 → 退回 default 31.5", () => {
    expect(getTwdPerUsd({})).toBe(31.5);
  });
  it("非法值（0 / 天文數字 / 非數字）→ 往下退防呆", () => {
    expect(getTwdPerUsd({ TWD_PER_USD: "0", USD_TO_TWD_RATE: "33" })).toBe(33);
    expect(getTwdPerUsd({ TWD_PER_USD: "abc" })).toBe(31.5);
    expect(getTwdPerUsd({ TWD_PER_USD: "99999" })).toBe(31.5);
  });
});

// ─── 真實價 → TWD 換算 + 歸屬維度 ───────────────────────────────────────────

describe("buildAttributionEntries — 真實價換 TWD + 歸屬維度", () => {
  it("member 必有；project/workflow 拿得到才有；TWD = usd×rate 凍結於 meta", () => {
    const entries = buildAttributionEntries(
      {
        costUsd: "0.10",
        userId: 42,
        projectId: "proj-1",
        workflowId: "wf-9",
        provider: "fal_ai",
        model: "fal-ai/flux",
        idempotencyKey: "aue:100",
      },
      32
    );
    // 三維各一筆複式分錄
    expect(entries.map(e => e.fromAccount).sort()).toEqual([
      "member:42",
      "project:proj-1",
      "workflow:wf-9",
    ]);
    // TWD = 0.10 × 32 = 3.2，凍結在 meta.amountTwd
    for (const e of entries) {
      expect(e.toAccount).toBe("expense:ai-cost");
      expect(e.amount).toBe("0.100000");
      expect(e.meta?.sourceCurrency).toBe("USD");
      expect(e.meta?.exchangeRate).toBe(32);
      expect(Number(e.meta?.amountTwd)).toBeCloseTo(3.2, 6);
      expect(e.meta?.provider).toBe("fal_ai");
      expect(e.meta?.model).toBe("fal-ai/flux");
    }
    // 不同維度用不同子鍵（避免撞鍵）
    expect(entries.map(e => e.idempotencyKey).sort()).toEqual([
      "aue:100:member",
      "aue:100:project",
      "aue:100:workflow",
    ]);
  });

  it("userId 拿不到 → 歸 member:anon；project/workflow 缺 → 不產該維度（誠實留空）", () => {
    const entries = buildAttributionEntries(
      { costUsd: "0.05", idempotencyKey: "aue:200" },
      32
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].fromAccount).toBe("member:anon");
  });

  it("真實價 0（無 cost）→ 回空陣列（不落 $0 髒列）", () => {
    expect(
      buildAttributionEntries({ costUsd: "0", idempotencyKey: "x" }, 32)
    ).toEqual([]);
    expect(
      buildAttributionEntries({ costUsd: "free", idempotencyKey: "x" }, 32)
    ).toEqual([]);
  });
});

// ─── 直接落帳 + demo/無 DB 跳過 ─────────────────────────────────────────────

describe("postAttributedCost — 落帳 + demo/無 DB 安全", () => {
  it("db=null → skipped、永不 throw", async () => {
    const r = await postAttributedCost(
      null,
      { costUsd: "0.1", userId: 1, idempotencyKey: "aue:1" },
      32
    );
    expect(r.outcome).toBe("skipped");
  });

  it("有 DB → 寫進 ledger（每維度成對借貸）、含 TWD/provider 欄", async () => {
    const db = makeFakeDb();
    const r = await postAttributedCost(
      db,
      {
        costUsd: "0.10",
        userId: 7,
        projectId: "p1",
        provider: "gemini",
        model: "gemini-2.5",
        idempotencyKey: "aue:300",
      },
      32
    );
    expect(r.outcome).toBe("posted");
    // member + project 共 2 維 × 2 腳 = 4 列
    expect(db._ledger).toHaveLength(4);
    const debit = db._ledger.find(l => l.accountKey === "member:7");
    expect(debit?.amountTwd).toBe("3.2000");
    expect(debit?.exchangeRate).toBe("32.000000");
    expect(debit?.sourceCurrency).toBe("USD");
    expect(debit?.provider).toBe("gemini");
  });

  it("重放冪等（同 idempotencyKey 不雙重入帳）", async () => {
    const db = makeFakeDb();
    const input: UsageAttributionInput = {
      costUsd: "0.10",
      userId: 7,
      idempotencyKey: "aue:301",
    };
    await postAttributedCost(db, input, 32);
    const before = db._ledger.length;
    await postAttributedCost(db, input, 32); // 重放
    expect(db._ledger.length).toBe(before); // 無新增
  });
});

// ─── outbox：enqueue + drain 補帳 ───────────────────────────────────────────

describe("enqueueAttribution — outbox 不漏帳入口", () => {
  it("db=null → skipped", async () => {
    const r = await enqueueAttribution(null, {
      costUsd: "0.1",
      userId: 1,
      idempotencyKey: "aue:1",
    });
    expect(r.outcome).toBe("skipped");
  });

  it("寫 pending；同 key 第二次 → duplicate（冪等）", async () => {
    const db = makeFakeDb();
    const input: UsageAttributionInput = {
      costUsd: "0.1",
      userId: 1,
      idempotencyKey: "aue:400",
    };
    expect((await enqueueAttribution(db, input)).outcome).toBe("enqueued");
    expect(db._outbox).toHaveLength(1);
    expect(db._outbox[0].status).toBe("pending");
    expect((await enqueueAttribution(db, input)).outcome).toBe("duplicate");
    expect(db._outbox).toHaveLength(1);
  });
});

describe("drainAttributionOutbox — 補帳 / 重試 / dead", () => {
  it("db=null → skipped", async () => {
    const r = await drainAttributionOutbox(null, 32);
    expect(r.status).toBe("skipped");
  });

  it("pending → drain 成功落帳並標 done", async () => {
    const db = makeFakeDb();
    await enqueueAttribution(db, {
      costUsd: "0.10",
      userId: 5,
      projectId: "p2",
      idempotencyKey: "aue:500",
    });
    // 讓 update 對到正確列：drain 內部對每列呼叫 update，fake 用 _updId 對應。
    (db as unknown as { _updId?: number })._updId = db._outbox[0].id;
    const r = await drainAttributionOutbox(db, 32);
    expect(r.scanned).toBe(1);
    expect(r.posted).toBe(1);
    expect(db._outbox[0].status).toBe("done");
    // ledger 有真實落帳（member + project = 4 列）
    expect(db._ledger.length).toBe(4);
  });

  it("ledger 落帳失敗 → attempts++ 留 pending（不漏帳，下輪重試）", async () => {
    const db = makeFakeDb({ failLedgerInsert: true });
    await enqueueAttribution(db, {
      costUsd: "0.10",
      userId: 5,
      idempotencyKey: "aue:600",
    });
    (db as unknown as { _updId?: number })._updId = db._outbox[0].id;
    const r = await drainAttributionOutbox(db, 32);
    expect(r.failed).toBe(1);
    expect(db._outbox[0].status).toBe("pending"); // 仍 pending
    expect(db._outbox[0].attempts).toBe(1);
    expect(db._ledger.length).toBe(0); // 沒落帳＝沒漏（留著重試）
  });

  it("達重試上限 → 標 dead（留人工查）", async () => {
    const db = makeFakeDb({ failLedgerInsert: true });
    await enqueueAttribution(db, {
      costUsd: "0.10",
      userId: 5,
      idempotencyKey: "aue:700",
    });
    db._outbox[0].attempts = OUTBOX_MAX_ATTEMPTS - 1; // 再失敗一次就到上限
    (db as unknown as { _updId?: number })._updId = db._outbox[0].id;
    const r = await drainAttributionOutbox(db, 32);
    expect(r.dead).toBe(1);
    expect(db._outbox[0].status).toBe("dead");
  });
});

// ─── 彙總（以 TWD）+ $0.00 修好 ─────────────────────────────────────────────

describe("summarizeAttribution — 依維度彙總、以 TWD、非 $0", () => {
  const rows: LedgerRowForSummary[] = [
    { accountKey: "member:1", entryType: "debit", amount: "0.10", amountTwd: "3.2" },
    { accountKey: "member:1", entryType: "debit", amount: "0.05", amountTwd: "1.6" },
    { accountKey: "project:p1", entryType: "debit", amount: "0.10", amountTwd: "3.2" },
    // credit（退款沖銷）→ 從同維度 debit 扣除算淨額
    { accountKey: "member:1", entryType: "credit", amount: "0.10", amountTwd: "3.2" },
    // 對手科目不是歸屬維度，略過
    { accountKey: "expense:ai-cost", entryType: "debit", amount: "0.10" },
  ];

  it("依 accountKey 維度加總 USD + TWD（淨額＝debit − 退款 credit、非 $0）", () => {
    const all = summarizeAttribution(rows, 32);
    const member = all.find(r => r.id === "1" && r.type === "member");
    // 淨額 = (0.10 + 0.05) − 0.10 退款 = 0.05 USD
    expect(member?.costUsd).toBeCloseTo(0.05, 6);
    expect(member?.costTwd).toBeCloseTo(1.6, 4); // (3.2 + 1.6) − 3.2
    expect(member?.costTwd).toBeGreaterThan(0); // 修好 $0.00
    // entries 只計 debit 筆數（2 筆消耗）
    expect(member?.entries).toBe(2);
    const project = all.find(r => r.type === "project");
    expect(project?.costTwd).toBeCloseTo(3.2, 4);
    // expense:ai-cost 不出現
    expect(all.some(r => r.type === "expense")).toBe(false);
  });

  it("dimension 過濾只回該維度", () => {
    const onlyProject = summarizeAttribution(rows, 32, "project");
    expect(onlyProject).toHaveLength(1);
    expect(onlyProject[0].type).toBe("project");
  });

  it("列無 amountTwd（#940 舊資料）→ fallback 用 rate 現算（仍非 $0）", () => {
    const legacy: LedgerRowForSummary[] = [
      { accountKey: "member:2", entryType: "debit", amount: "0.10" },
    ];
    const out = summarizeAttribution(legacy, 32);
    expect(out[0].costTwd).toBeCloseTo(3.2, 4); // 0.10 × 32 現算
  });

  it("同維度退款 credit 從 debit 扣除算淨額（不再高估毛額）", () => {
    const withRefund: LedgerRowForSummary[] = [
      { accountKey: "project:px", entryType: "debit", amount: "0.10", amountTwd: "3.2" },
      { accountKey: "project:px", entryType: "debit", amount: "0.10", amountTwd: "3.2" },
      // 退款沖銷一筆
      { accountKey: "project:px", entryType: "credit", amount: "0.10", amountTwd: "3.2" },
    ];
    const out = summarizeAttribution(withRefund, 32, "project");
    expect(out).toHaveLength(1);
    // 淨額 = 0.20 − 0.10 = 0.10 USD；3.2 TWD
    expect(out[0].costUsd).toBeCloseTo(0.1, 6);
    expect(out[0].costTwd).toBeCloseTo(3.2, 4);
    // entries 只計 debit 筆數
    expect(out[0].entries).toBe(2);
  });

  it("退款 ≥ 消耗 → 淨額 clamp 至 0、不出現負成本污染前台", () => {
    const overRefund: LedgerRowForSummary[] = [
      { accountKey: "member:9", entryType: "debit", amount: "0.10", amountTwd: "3.2" },
      { accountKey: "member:9", entryType: "credit", amount: "0.10", amountTwd: "3.2" },
      { accountKey: "member:9", entryType: "credit", amount: "0.05", amountTwd: "1.6" },
    ];
    const out = summarizeAttribution(overRefund, 32);
    const member = out.find(r => r.id === "9");
    // 有消耗事件（entries=1）故列仍在，但淨額 clamp 至 0（不出現負數）
    expect(member?.entries).toBe(1);
    expect(member?.costUsd).toBe(0);
    expect(member?.costTwd).toBe(0);
    // 永不負數
    expect(member?.costUsd).toBeGreaterThanOrEqual(0);
    expect(member?.costTwd).toBeGreaterThanOrEqual(0);
  });
});

// ─── 匯率凍結（成本發生當下，非 drain 當下）──────────────────────────────────

describe("匯率凍結 — enqueue 當下凍進 payload，drain 重放用之", () => {
  it("enqueueAttribution 把當下 rate 寫進 payload.frozenRate", async () => {
    const db = makeFakeDb();
    await enqueueAttribution(
      db,
      { costUsd: "0.10", userId: 1, idempotencyKey: "aue:rate1" },
      32
    );
    expect(db._outbox[0].payloadJson.frozenRate).toBe(32);
  });

  it("drain 用 payload 凍結匯率，而非 drain 當下傳入的 rate", async () => {
    const db = makeFakeDb();
    // 成本發生當下匯率 = 30，凍進 payload。
    await enqueueAttribution(
      db,
      { costUsd: "0.10", userId: 1, idempotencyKey: "aue:rate2" },
      30
    );
    (db as unknown as { _updId?: number })._updId = db._outbox[0].id;
    // drain 當下 admin 改了匯率到 99（傳入 rate=99）；落帳仍應用凍結的 30。
    await drainAttributionOutbox(db, 99);
    const debit = db._ledger.find(l => l.accountKey === "member:1");
    expect(debit?.exchangeRate).toBe("30.000000"); // 凍結值，非 99
    expect(debit?.amountTwd).toBe("3.0000"); // 0.10 × 30
  });

  it("postAttributedCost：payload 自帶 frozenRate 優先於傳入 rate", async () => {
    const db = makeFakeDb();
    await postAttributedCost(
      db,
      { costUsd: "0.10", userId: 2, frozenRate: 28, idempotencyKey: "aue:rate3" },
      99
    );
    const debit = db._ledger.find(l => l.accountKey === "member:2");
    expect(debit?.exchangeRate).toBe("28.000000");
  });
});

// ─── AIDV-130 skill 成本歸屬維度 ─────────────────────────────────────────────

describe("AIDV-130 skill 維度 — buildAttributionEntries + summarizeAttribution", () => {
  it("skillId 拿得到 → 產 skill:xxx 維度分錄（四維 member+project+workflow+skill）", () => {
    const entries = buildAttributionEntries(
      {
        costUsd: "0.20",
        userId: 10,
        projectId: "p9",
        workflowId: "wf-5",
        skillId: "translate@1.0.0",
        provider: "openai",
        model: "gpt-4o",
        idempotencyKey: "aue:sk1",
      },
      32
    );
    const accounts = entries.map(e => e.fromAccount).sort();
    expect(accounts).toEqual([
      "member:10",
      "project:p9",
      "skill:translate@1.0.0",
      "workflow:wf-5",
    ]);
    // 各維度冪等子鍵互不撞
    const keys = entries.map(e => e.idempotencyKey).sort();
    expect(keys).toEqual([
      "aue:sk1:member",
      "aue:sk1:project",
      "aue:sk1:skill",
      "aue:sk1:workflow",
    ]);
    // skill 維度也帶正確的共享 meta（skillId, projectId, workflowId）
    const skillEntry = entries.find(e => e.fromAccount.startsWith("skill:"));
    expect(skillEntry?.meta?.skillId).toBe("translate@1.0.0");
    expect(skillEntry?.meta?.projectId).toBe("p9");
  });

  it("skillId 缺 → 不產 skill 維度（誠實留空，僅 member）", () => {
    const entries = buildAttributionEntries(
      { costUsd: "0.05", userId: 11, idempotencyKey: "aue:sk2" },
      32
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].fromAccount).toBe("member:11");
    expect(entries.some(e => e.fromAccount.startsWith("skill:"))).toBe(false);
  });

  it("summarizeAttribution — skill 維度可彙總、可獨立過濾", () => {
    const rows: LedgerRowForSummary[] = [
      {
        accountKey: "skill:translate@1.0.0",
        entryType: "debit",
        amount: "0.20",
        amountTwd: "6.4",
      },
      {
        accountKey: "skill:translate@1.0.0",
        entryType: "debit",
        amount: "0.10",
        amountTwd: "3.2",
      },
      { accountKey: "member:10", entryType: "debit", amount: "0.20", amountTwd: "6.4" },
    ];
    // 全維度彙總：skill + member 都出現
    const all = summarizeAttribution(rows, 32);
    const skillRow = all.find(r => r.type === "skill");
    expect(skillRow?.id).toBe("translate@1.0.0");
    expect(skillRow?.costUsd).toBeCloseTo(0.3, 6);
    expect(skillRow?.costTwd).toBeCloseTo(9.6, 4);
    expect(skillRow?.entries).toBe(2);

    // 只要 skill 維度
    const onlySkill = summarizeAttribution(rows, 32, "skill");
    expect(onlySkill).toHaveLength(1);
    expect(onlySkill[0].type).toBe("skill");

    // 只要 member 維度不含 skill
    const onlyMember = summarizeAttribution(rows, 32, "member");
    expect(onlyMember).toHaveLength(1);
    expect(onlyMember[0].type).toBe("member");
  });

  it("postAttributedCost — skillId 維度落帳進 ledger", async () => {
    const db = makeFakeDb();
    await postAttributedCost(
      db,
      {
        costUsd: "0.20",
        userId: 12,
        skillId: "summarize@2.1.0",
        idempotencyKey: "aue:sk3",
      },
      32
    );
    // member + skill 兩維 × 2 腳 = 4 列
    expect(db._ledger).toHaveLength(4);
    const skillDebit = db._ledger.find(
      l => l.accountKey === "skill:summarize@2.1.0"
    );
    expect(skillDebit?.entryType).toBe("debit");
    expect(skillDebit?.amountTwd).toBe("6.4000");
  });
});

// ─── costSource 標記（稽核區分 provider vs catalog）──────────────────────────

describe("costSource — 來源標記凍入 ledger meta", () => {
  it("buildAttributionEntries 把 costSource 寫進 meta", () => {
    const entries = buildAttributionEntries(
      {
        costUsd: "0.04",
        userId: 1,
        provider: "fal_ai",
        model: "fal-ai/flux-pro/v1.1",
        costSource: "catalog",
        idempotencyKey: "aue:cs1",
      },
      32
    );
    expect(entries[0].meta?.costSource).toBe("catalog");
  });

  it("postAttributedCost 落帳時 costSource 進 ledger 欄", async () => {
    const db = makeFakeDb();
    await postAttributedCost(
      db,
      {
        costUsd: "0.04",
        userId: 3,
        provider: "fal_ai",
        costSource: "catalog",
        idempotencyKey: "aue:cs2",
      },
      32
    );
    const debit = db._ledger.find(l => l.accountKey === "member:3");
    expect(debit?.costSource).toBe("catalog");
  });
});
