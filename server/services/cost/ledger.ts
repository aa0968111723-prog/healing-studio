/**
 * ledger.ts — AIDV-153 append-only 雙分錄成本帳本服務（基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 * 現況反型樣：餘額＝users.remainingGenerations 單一可變整數，扣款/退款都「就地
 * mutate」（server/db.ts deductUserPoints/refundUserPoints），無不可變交易 log。
 * 本服務提供「log 即真相、餘額由 log 算出來」的基礎：
 *
 *   - postEntry(db, entry)        : 寫一筆 append-only 帳目；idempotencyKey 重複
 *                                   入帳被擋（冪等不重複入帳）。永不 UPDATE/DELETE
 *                                   既有列。
 *   - computeBalance(db, account) : 由 log 加總算餘額（不就地改任何欄位）。
 *                                   約定：posted 的 SUM(credit) - SUM(debit)。
 *   - hold 生命週期                : holdEntry → postHold / archiveHold
 *                                   （pending → posted / archived）。
 *
 * 純函式區（normalizeAmount / makeAccountKey / isCostLedgerEnabled / summarize）
 * 不碰 DB，可單測；DB 操作一律以「傳入的 db」執行（依賴注入），無 db＝demo/無 DB
 * 安全 skip（回安全空值，永不 throw）。
 *
 * HARD SAFETY：本服務只在旗標 ENABLE_COST_LEDGER=ON 時被接線端呼叫；OFF 時接線端
 * 完全不進入本模組，故零行為變化。本服務並行於 cost_aggregations、不改既有餘額。
 */
import { sql, and, eq } from "drizzle-orm";
import { costLedger } from "../../../drizzle/schema";

/** 帳戶鍵維度（科目維度）。雙分錄正式科目定義待 Bruce 拍板，先存自由字串鍵。 */
export type LedgerAccountType = "project" | "member" | "workflow";
/** 借（消耗成本）/ 貸（退款沖銷）。 */
export type LedgerEntryType = "debit" | "credit";
/** hold 生命週期狀態。 */
export type LedgerStatus = "pending" | "posted" | "archived";

/** DECIMAL(12,6) 上限：6 位整數 + 6 位小數。 */
const MAX_DECIMAL_12_6 = 999999.999999;
const SCALE = 6;

/**
 * 旗標：ENABLE_COST_LEDGER。預設 OFF（與 env.validated.ts 同名同預設）。
 * lazy 讀 process.env（與 postGenActions.isPromptAssetLinksEnabled 同模式）讓
 * 測試可在 runtime 重設 env 立即生效。
 *
 * 注意：本旗標只控制「接線端是否寫 ledger」。OFF 時接線端不呼叫 postEntry，
 * 現有成本流程（aiUsageEvents / cost_aggregations / remainingGenerations）位元相同。
 */
export function isCostLedgerEnabled(): boolean {
  const value = process.env.ENABLE_COST_LEDGER;
  if (value === undefined || value === null || value.trim() === "") return false;
  return !["0", "false", "off", "no", "disabled"].includes(
    value.trim().toLowerCase()
  );
}

/**
 * 把任意候選值正規化成合法的 DECIMAL(12,6) 定點字串（金額永遠 ≥ 0；方向由
 * entryType 表達，故這裡 clamp 負值/NaN/溢位）。沿用 usageCost.normalizeCostUsd
 * 的契約：永不 throw、永遠回合法定點字串、fallback "0"。
 */
export function normalizeAmount(value: unknown): string {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const s = value.trim();
    if (s.length === 0 || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      return "0";
    }
    n = Number(s);
  } else {
    return "0";
  }
  if (!Number.isFinite(n)) return "0";
  if (n <= 0) return "0";
  if (n > MAX_DECIMAL_12_6) n = MAX_DECIMAL_12_6;
  const fixed = n.toFixed(SCALE);
  if (Number(fixed) === 0) return "0";
  return fixed;
}

/** 組 accountKey："<type>:<id>"。id 會被 trim；空 id → "type:"（仍合法字串）。 */
export function makeAccountKey(type: LedgerAccountType, id: string | number): string {
  return `${type}:${String(id).trim()}`;
}

/** 最小 drizzle 介面：只用到 insert / select。用結構型別避免綁死 mysql2 具體型別。 */
export interface LedgerDb {
  insert: (table: typeof costLedger) => {
    values: (v: InsertLedgerInput) => Promise<unknown>;
  };
  select: (cols?: unknown) => {
    from: (table: typeof costLedger) => {
      where: (cond: unknown) => Promise<unknown[]>;
    };
  };
}

/** postEntry / holdEntry 的輸入。 */
export interface PostEntryInput {
  accountKey: string;
  entryType: LedgerEntryType;
  /** 金額（會被 normalizeAmount clamp 成合法 DECIMAL(12,6) ≥ 0）。 */
  amount: number | string;
  /** 唯一鍵 — 同 key 重複入帳被擋＝冪等。 */
  idempotencyKey: string;
  /** hold 生命週期：預設 posted（直接入帳）；holdEntry 走 pending。 */
  status?: LedgerStatus;
  refType?: string | null;
  refId?: string | null;
}

/** 實際 insert 進 DB 的 row（amount 已正規化為字串）。 */
interface InsertLedgerInput {
  accountKey: string;
  entryType: LedgerEntryType;
  amount: string;
  status: LedgerStatus;
  idempotencyKey: string;
  refType: string | null;
  refId: string | null;
}

export interface PostEntryResult {
  /** "inserted"＝新入帳；"duplicate"＝idempotencyKey 已存在、未重複入帳；
   *  "skipped"＝無 db（demo/無 DB）；"invalid"＝金額正規化後為 0、未入帳。 */
  outcome: "inserted" | "duplicate" | "skipped" | "invalid";
}

/**
 * MySQL 重複鍵錯誤判斷（ER_DUP_ENTRY = 1062）。drizzle/mysql2 會把 driver error
 * 透傳，這裡用寬鬆嗅探（code / errno / 訊息）以對不同包裝層皆成立。
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; message?: string };
  if (e.code === "ER_DUP_ENTRY") return true;
  if (e.errno === 1062) return true;
  if (typeof e.message === "string" && /duplicate entry/i.test(e.message)) return true;
  return false;
}

/**
 * 寫一筆 append-only 帳目。冪等：同 idempotencyKey 重複呼叫只入帳一次。
 *
 * 冪等保證雙保險：
 *   (1) 先查 idempotencyKey 是否已存在（快路徑，避免大多數重複的 insert 嘗試）。
 *   (2) DB 層 UNIQUE INDEX cl_idempotencyKey_unique 為最終真相 —— 並發雙寫時
 *       其中一筆會撞 ER_DUP_ENTRY，我們捕捉並回 "duplicate"（不重複入帳）。
 *
 * 無 db（demo/無 DB）→ 回 { outcome: "skipped" }，永不 throw。
 * 金額正規化後為 "0"（非法/負/NaN）→ 回 { outcome: "invalid" }，不入帳。
 */
export async function postEntry(
  db: LedgerDb | null | undefined,
  input: PostEntryInput
): Promise<PostEntryResult> {
  if (!db) return { outcome: "skipped" };

  const amount = normalizeAmount(input.amount);
  if (amount === "0") return { outcome: "invalid" };

  const status: LedgerStatus = input.status ?? "posted";
  const key = input.idempotencyKey;

  // (1) 快路徑：已存在就不再嘗試 insert。
  try {
    const existing = await db
      .select({ id: sql`1` })
      .from(costLedger)
      .where(eq(costLedger.idempotencyKey, key));
    if (Array.isArray(existing) && existing.length > 0) {
      return { outcome: "duplicate" };
    }
  } catch {
    // 查詢失敗不致命 —— 交給 (2) 的 UNIQUE 約束兜底。
  }

  // (2) insert；撞唯一鍵＝冪等回 duplicate。
  try {
    await db.insert(costLedger).values({
      accountKey: input.accountKey,
      entryType: input.entryType,
      amount,
      status,
      idempotencyKey: key,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    });
    return { outcome: "inserted" };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { outcome: "duplicate" };
    throw err;
  }
}

/**
 * hold：以 pending 預留一筆帳目（hold 生命週期起點）。等同 postEntry status=pending。
 */
export async function holdEntry(
  db: LedgerDb | null | undefined,
  input: Omit<PostEntryInput, "status">
): Promise<PostEntryResult> {
  return postEntry(db, { ...input, status: "pending" });
}

/**
 * 餘額由 log 加總算出（不就地改任何欄位）。
 * 約定：只計 status=posted；balance = SUM(credit.amount) - SUM(debit.amount)。
 * pending（hold 預留）與 archived（沖銷作廢）都不計入正式餘額。
 *
 * 回 number（USD）。無 db → 回 0（demo/無 DB 安全），永不 throw。
 */
export async function computeBalance(
  db: LedgerDb | null | undefined,
  accountKey: string
): Promise<number> {
  if (!db) return 0;
  try {
    const rows = (await db
      .select({
        entryType: costLedger.entryType,
        amount: costLedger.amount,
      })
      .from(costLedger)
      .where(
        and(
          eq(costLedger.accountKey, accountKey),
          eq(costLedger.status, "posted")
        )
      )) as Array<{ entryType: LedgerEntryType; amount: string }>;
    return summarizeBalance(rows);
  } catch {
    return 0;
  }
}

/**
 * 純函式：把 posted 帳目列表加總成餘額。balance = SUM(credit) - SUM(debit)。
 * 抽出來可單測（不需 DB），也讓 computeBalance 的 SQL 結果好驗證。
 */
export function summarizeBalance(
  rows: Array<{ entryType: LedgerEntryType; amount: string | number }>
): number {
  let credit = 0;
  let debit = 0;
  for (const r of rows) {
    const n = Number(r.amount);
    if (!Number.isFinite(n) || n < 0) continue;
    if (r.entryType === "credit") credit += n;
    else if (r.entryType === "debit") debit += n;
  }
  // 以 6 位小數收斂浮點誤差。
  return Number((credit - debit).toFixed(SCALE));
}
