/**
 * ledger.ts — AIDV-153 append-only 複式（雙分錄）成本帳本服務（基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 * 現況反型樣：餘額＝users.remainingGenerations 單一可變整數，扣款/退款都「就地
 * mutate」（server/db.ts deductUserPoints/refundUserPoints），無不可變交易 log。
 * 本服務提供「log 即真相、餘額由 log 算出來」的基礎：
 *
 *   - postEntry(db, entry)        : 寫【單腳】append-only 帳目（低階原語）；
 *                                   idempotencyKey 重複入帳被擋（冪等）。永不
 *                                   UPDATE/DELETE 既有列。
 *   - postTransaction(db, t)      : 寫【一對平衡的借＋貸】（真正的複式分錄）：
 *                                   debit fromAccount + credit toAccount，金額相等、
 *                                   共用 transactionId、同批寫入。這才是「全域
 *                                   SUM(credit)-SUM(debit)==0」不變式的來源。
 *   - computeBalance(db, account) : 由 log 加總算單一帳戶餘額（不改任何欄位）。
 *                                   約定：posted 的 SUM(credit) - SUM(debit)。
 *   - assertGlobalBalanced(db)    : 對帳完整性檢查——所有 posted 列的 SUM(credit)
 *                                   - SUM(debit) 應 ==0（複式分錄的核心不變式）。
 *   - hold 生命週期                : holdEntry → postHold / archiveHold
 *                                   （pending → posted / archived）。因表為
 *                                   append-only，轉態【不 UPDATE pending 列】，而是
 *                                   append 補償列（settle/cancel）達成狀態遷移。
 *
 * 純函式區（normalizeAmount / makeAccountKey / isCostLedgerEnabled / summarize）
 * 不碰 DB，可單測；DB 操作一律以「傳入的 db」執行（依賴注入），無 db＝demo/無 DB
 * 安全 skip（回安全空值，永不 throw）。
 *
 * HARD SAFETY：本服務只在旗標 ENABLE_COST_LEDGER=ON 時被接線端呼叫；OFF 時接線端
 * 完全不進入本模組，故零行為變化。本服務並行於 cost_aggregations、不改既有餘額。
 */
import { createHash } from "node:crypto";
import { sql, and, eq } from "drizzle-orm";
import { costLedger } from "../../../drizzle/schema";

/**
 * 對手科目（counter-account）：成本消耗的平衡貸方。每筆 member debit 的對手是
 * 一筆 expense:ai-cost credit，使全域 SUM(credit)-SUM(debit) 恆為 0（不變式＝
 * 對帳完整性檢查）。正式科目表待 Bruce 拍板，先以此固定字串作基準對手科目。
 */
export const EXPENSE_AI_COST_ACCOUNT = "expense:ai-cost";

/**
 * 把任意長度的組合字串雜湊成有界長度的 idempotencyKey（sha256 hex=64 字元），
 * 永遠安全落入 varchar(191)，避免使用者/endpoint 可控長度無界流入唯一鍵造成
 * MySQL 靜默截斷（非嚴格模式撞鍵丟帳）或報錯。前綴 prefix 便於人眼辨識來源。
 */
export function hashIdempotencyKey(prefix: string, composite: string): string {
  const digest = createHash("sha256").update(composite).digest("hex");
  return `${prefix}:${digest}`;
}

/** 帳戶鍵維度（科目維度）。雙分錄正式科目定義待 Bruce 拍板，先存自由字串鍵。 */
export type LedgerAccountType = "project" | "member" | "workflow" | "skill";
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

/** 最小 drizzle 介面：只用到 insert / select。用結構型別避免綁死 mysql2 具體型別。
 *  values 接受單列或多列（複式分錄的借＋貸成對同批寫入時傳陣列）。 */
export interface LedgerDb {
  insert: (table: typeof costLedger) => {
    values: (v: InsertLedgerInput | InsertLedgerInput[]) => Promise<unknown>;
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

/**
 * AIDV-14：歸屬 + 稽核欄位（可選）。隨複式分錄一併凍結寫入，供「依 project/member/
 * workflow 彙總、以 TWD 呈現」且保留原始幣別＋匯率以利稽核回溯。全部 optional，
 * 不傳＝沿用 #940 既有行為（純 USD、無維度），故對既有 caller 完全向後相容。
 */
export interface LedgerEntryMeta {
  projectId?: string | null;
  workflowId?: string | null;
  /** AIDV-130：Skill 維度（格式 skillId@version），拿不到留 null。 */
  skillId?: string | null;
  /** 原始幣別（amount 的幣別），預設 "USD"。 */
  sourceCurrency?: string | null;
  /** 落帳當下凍結的 TWD/USD 匯率。 */
  exchangeRate?: number | string | null;
  /** amount × exchangeRate（換算後 TWD，落帳當下凍結）。 */
  amountTwd?: number | string | null;
  provider?: string | null;
  model?: string | null;
  /** 成本數字來源："provider"＝上游真實計費；"catalog"＝目錄真實單位價後援。 */
  costSource?: string | null;
  /** AIDV-130 S-5：Skill 成本維度。執行此分錄的 Skill manifest id + 版本。 */
  skillId?: string | null;
  skillVersion?: string | null;
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
  // AIDV-14 歸屬 + 稽核欄位（可選，不傳則 undefined＝drizzle 用欄位 default/null）。
  projectId?: string | null;
  workflowId?: string | null;
  skillId?: string | null;
  sourceCurrency?: string | null;
  exchangeRate?: string | null;
  amountTwd?: string | null;
  provider?: string | null;
  model?: string | null;
  costSource?: string | null;
  // AIDV-130 S-5：Skill 成本維度。
  skillId?: string | null;
  skillVersion?: string | null;
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

// ─── 複式分錄：成對借＋貸（postTransaction）────────────────────────────────────

/** postTransaction 的輸入：一筆交易＝從 fromAccount 借出、貸入 toAccount，金額相等。 */
export interface PostTransactionInput {
  /** 借方科目（debit）—— 例如 member:<userId>（成本歸屬到誰）。 */
  fromAccount: string;
  /** 貸方科目（credit）—— 例如 expense:ai-cost（對手科目）。 */
  toAccount: string;
  /** 金額（會被 normalizeAmount clamp 成合法 DECIMAL(12,6) ≥ 0）。 */
  amount: number | string;
  /** 交易冪等基準鍵 —— 借/貸兩腳由此衍生出各自的 idempotencyKey。 */
  idempotencyKey: string;
  status?: LedgerStatus;
  refType?: string | null;
  refId?: string | null;
  /** AIDV-14：歸屬 + 稽核欄位（可選），借/貸兩腳一併凍結寫入。 */
  meta?: LedgerEntryMeta;
}

export interface PostTransactionResult {
  /** "inserted"＝借＋貸成對入帳；"duplicate"＝此交易已入帳（冪等）；
   *  "skipped"＝無 db；"invalid"＝金額正規化後為 0、未入帳。 */
  outcome: "inserted" | "duplicate" | "skipped" | "invalid";
}

/**
 * 寫一筆【平衡的複式分錄】：debit fromAccount + credit toAccount，金額相等、共用
 * 衍生 transactionId、同批 insert（單一 .values([...]) 呼叫＝同一 SQL，原子）。
 *
 * 這是 ledger 之所以是「帳本」的核心：每筆交易借貸成對，故全域
 * SUM(credit)-SUM(debit) 恆 ==0，assertGlobalBalanced 可據此做完整性檢查。
 *
 * 冪等：兩腳各自帶 `${idempotencyKey}:debit` / `${idempotencyKey}:credit` 唯一鍵；
 * 重複呼叫整批 insert 撞 UNIQUE → 回 duplicate（不重複入帳）。先查快路徑避免多數
 * 重複的 insert 嘗試。無 db → skipped；金額為 0 → invalid（不入帳）。永不 throw 自身
 * 邏輯錯誤以外的東西（DB 非重複鍵錯誤仍上拋，交由呼叫端吞）。
 */
export async function postTransaction(
  db: LedgerDb | null | undefined,
  input: PostTransactionInput
): Promise<PostTransactionResult> {
  if (!db) return { outcome: "skipped" };

  const amount = normalizeAmount(input.amount);
  if (amount === "0") return { outcome: "invalid" };

  const status: LedgerStatus = input.status ?? "posted";
  const debitKey = `${input.idempotencyKey}:debit`;
  const creditKey = `${input.idempotencyKey}:credit`;

  // 快路徑：debit 腳已存在＝此交易已入帳。
  try {
    const existing = await db
      .select({ id: sql`1` })
      .from(costLedger)
      .where(eq(costLedger.idempotencyKey, debitKey));
    if (Array.isArray(existing) && existing.length > 0) {
      return { outcome: "duplicate" };
    }
  } catch {
    // 查詢失敗不致命 —— 交給 UNIQUE 約束兜底。
  }

  const refType = input.refType ?? null;
  const refId = input.refId ?? null;
  // AIDV-14：把 meta 正規化為 insert 欄位（數值欄轉字串，沿用 DECIMAL 定點字串約定）。
  const metaCols = normalizeLedgerMeta(input.meta);
  try {
    await db.insert(costLedger).values([
      {
        accountKey: input.fromAccount,
        entryType: "debit",
        amount,
        status,
        idempotencyKey: debitKey,
        refType,
        refId,
        ...metaCols,
      },
      {
        accountKey: input.toAccount,
        entryType: "credit",
        amount,
        status,
        idempotencyKey: creditKey,
        refType,
        refId,
        ...metaCols,
      },
    ]);
    return { outcome: "inserted" };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { outcome: "duplicate" };
    throw err;
  }
}

/**
 * 純函式：把 LedgerEntryMeta 正規化為 insert 欄位片段。數值（exchangeRate/amountTwd）
 * 轉為定點字串（與 amount 同約定，避免浮點漂移進 DECIMAL）；非法/空值留 undefined
 * （drizzle 不帶該欄＝用 DB default/null）。借＋貸兩腳共用同一份 meta（同一筆成本）。
 */
export function normalizeLedgerMeta(
  meta: LedgerEntryMeta | undefined
): Partial<InsertLedgerInput> {
  if (!meta) return {};
  const out: Partial<InsertLedgerInput> = {};
  if (meta.projectId != null && String(meta.projectId).trim() !== "") {
    out.projectId = String(meta.projectId).trim();
  }
  if (meta.workflowId != null && String(meta.workflowId).trim() !== "") {
    out.workflowId = String(meta.workflowId).trim();
  }
  if (meta.skillId != null && String(meta.skillId).trim() !== "") {
    out.skillId = String(meta.skillId).trim();
  }
  if (meta.sourceCurrency != null && String(meta.sourceCurrency).trim() !== "") {
    out.sourceCurrency = String(meta.sourceCurrency).trim().toUpperCase();
  }
  const rate = toDecimalStringOrNull(meta.exchangeRate, 6);
  if (rate !== null) out.exchangeRate = rate;
  const twd = toDecimalStringOrNull(meta.amountTwd, 4);
  if (twd !== null) out.amountTwd = twd;
  if (meta.provider != null && String(meta.provider).trim() !== "") {
    out.provider = String(meta.provider).trim();
  }
  if (meta.model != null && String(meta.model).trim() !== "") {
    out.model = String(meta.model).trim();
  }
  if (meta.costSource != null && String(meta.costSource).trim() !== "") {
    out.costSource = String(meta.costSource).trim();
  }
  if (meta.skillId != null && String(meta.skillId).trim() !== "") {
    out.skillId = String(meta.skillId).trim();
  }
  if (meta.skillVersion != null && String(meta.skillVersion).trim() !== "") {
    out.skillVersion = String(meta.skillVersion).trim();
  }
  return out;
}

/** 把候選值轉成 scale 位定點字串；非有限/≤0 → null（不寫該欄）。 */
function toDecimalStringOrNull(
  value: number | string | null | undefined,
  scale: number
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(scale);
}

// ─── hold 生命週期轉態（append-only 補償列）──────────────────────────────────

/**
 * postHold：把一筆 pending hold 結算為 posted。因表 append-only，【不 UPDATE pending
 * 列】，而是 append 一筆 posted 列（正式入帳）。idempotencyKey 由 hold 的 key 衍生
 * （`${holdKey}:posted`）確保冪等。原 pending 列保留為歷史軌跡（computeBalance 只計
 * posted，故 pending 自然不計、posted 開始計入）。
 *
 * @param holdKey 原 holdEntry 用的 idempotencyKey
 */
export async function postHold(
  db: LedgerDb | null | undefined,
  input: {
    accountKey: string;
    entryType: LedgerEntryType;
    amount: number | string;
    holdKey: string;
    refType?: string | null;
    refId?: string | null;
  }
): Promise<PostEntryResult> {
  return postEntry(db, {
    accountKey: input.accountKey,
    entryType: input.entryType,
    amount: input.amount,
    idempotencyKey: `${input.holdKey}:posted`,
    status: "posted",
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  });
}

/**
 * archiveHold：把一筆 pending hold 作廢。因表 append-only，append 一筆 archived 列
 * 標記取消（idempotencyKey `${holdKey}:archived`）。archived 不計入餘額，故等效於
 * 釋放預留額度。原 pending 列保留為歷史。
 */
export async function archiveHold(
  db: LedgerDb | null | undefined,
  input: {
    accountKey: string;
    entryType: LedgerEntryType;
    amount: number | string;
    holdKey: string;
    refType?: string | null;
    refId?: string | null;
  }
): Promise<PostEntryResult> {
  return postEntry(db, {
    accountKey: input.accountKey,
    entryType: input.entryType,
    amount: input.amount,
    idempotencyKey: `${input.holdKey}:archived`,
    status: "archived",
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  });
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

// ─── 複式分錄完整性不變式：全域 SUM(credit)-SUM(debit) == 0 ────────────────────

/**
 * 純函式：對【全部 posted 列、不分帳戶】加總，回 SUM(credit)-SUM(debit)。
 * 複式分錄下每筆交易借貸成對、金額相等，故此全域和應恆 ==0；非 0 即帳本破損
 * （遺漏單腳/手動單腳寫入），本身就是一個對帳完整性檢查。
 */
export function summarizeGlobalBalance(
  rows: Array<{ entryType: LedgerEntryType; amount: string | number }>
): number {
  return summarizeBalance(rows);
}

/**
 * 對帳完整性檢查：讀所有 posted 列，驗證 SUM(credit)-SUM(debit) ≈ 0。
 * 回 { balanced, delta }。無 db → 回 balanced（demo/無 DB 安全），永不 throw。
 * 注意：本檢查只在「全部交易皆以 postTransaction 成對寫入」時為真；若仍有歷史
 * 單腳 postEntry（基礎版接線升級前），delta 會反映尚未配對的單腳，屬已知預期。
 */
export async function assertGlobalBalanced(
  db: LedgerDb | null | undefined,
  epsilon = 1e-6
): Promise<{ balanced: boolean; delta: number }> {
  if (!db) return { balanced: true, delta: 0 };
  try {
    const rows = (await db
      .select({
        entryType: costLedger.entryType,
        amount: costLedger.amount,
      })
      .from(costLedger)
      .where(eq(costLedger.status, "posted"))) as Array<{
      entryType: LedgerEntryType;
      amount: string;
    }>;
    const delta = summarizeGlobalBalance(rows);
    return { balanced: Math.abs(delta) <= epsilon, delta };
  } catch {
    return { balanced: true, delta: 0 };
  }
}
