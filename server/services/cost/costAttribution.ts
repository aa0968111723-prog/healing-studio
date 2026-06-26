/**
 * costAttribution.ts — AIDV-14 內部成本歸屬可視（建在 #940 cost_ledger 上）
 * ──────────────────────────────────────────────────────────────────────────
 * 目標（內部用、不對使用者收費）：知道哪個 project / member / workflow 花了多少
 * API 成本，以「真實呼叫價（actual provider cost，非估算）」換算「台幣 TWD」呈現，
 * 並保留原始幣別＋所用匯率以利稽核回溯。
 *
 * 本服務提供四件事：
 *   1. 旗標/匯率（pure）：isCostAttributionEnabled（預設 ON）、getTwdPerUsd（讀 env
 *      TWD_PER_USD→USD_TO_TWD_RATE→default，每層防呆）。
 *   2. buildAttributionEntries（pure）：把一筆 usage 事件展開成「每個可得歸屬維度
 *      （member 必有；project/workflow 拿得到才有）各一筆平衡複式分錄」，每筆都帶
 *      凍結的 sourceCurrency=USD / exchangeRate / amountTwd / provider / model。
 *   3. enqueueAttribution（outbox 不漏帳）：把落帳意圖（payload）先原子寫入
 *      cost_attribution_outbox（pending），永不在請求熱路徑同步等待 ledger 寫入。
 *   4. drainAttributionOutbox（補帳/回沖可靠性）：重試 postTransaction，成功標 done、
 *      失敗 attempts++ 留 pending 等下輪，超上限標 dead（留人工查）。冪等鍵確保重送
 *      不雙重入帳。
 *
 * HARD SAFETY：
 *   - 旗標 ENABLE_COST_ATTRIBUTION 預設 ON（fallback=true）。
 *   - demo-safe-skip：db==null（getDb()===null）→ 整段跳過、回安全空值、永不 throw。
 *   - best-effort 後置：呼叫端在「生成/用量結果產出後」呼叫，try/catch 不阻塞、
 *     不在請求路徑同步等待（比照 #940 ledger / audit log 型樣）。
 *   - 不改既有扣款/餘額、不對使用者收費、並行於 cost_aggregations 不取代。
 */
import { eq } from "drizzle-orm";
import {
  costAttributionOutbox,
  type InsertCostAttributionOutbox,
} from "../../../drizzle/schema";
import {
  resolveTwdPerUsd,
  usdToTwd,
  DEFAULT_USD_TO_TWD_RATE,
} from "../../../shared/currency";
import {
  postTransaction,
  makeAccountKey,
  normalizeAmount,
  EXPENSE_AI_COST_ACCOUNT,
  type LedgerDb,
  type PostTransactionInput,
  type LedgerAccountType,
} from "./ledger";

// ─── 旗標 ───────────────────────────────────────────────────────────────────

/**
 * 旗標 ENABLE_COST_ATTRIBUTION：預設 ON（fallback=true）。
 * lazy 讀 process.env（測試可 runtime 重設立即生效）。只有顯式關閉值才回 false。
 */
export function isCostAttributionEnabled(): boolean {
  const value = process.env.ENABLE_COST_ATTRIBUTION;
  if (value === undefined || value === null || value.trim() === "") return true; // 預設 ON
  return !["0", "false", "off", "no", "disabled"].includes(
    value.trim().toLowerCase()
  );
}

// ─── 匯率 ───────────────────────────────────────────────────────────────────

/**
 * 解析當下生效的 TWD/USD 匯率：TWD_PER_USD → USD_TO_TWD_RATE → DEFAULT。pure（讀
 * 傳入 env 值，預設讀 process.env）。架構上保留日後接即時匯率：把此函式回傳值改
 * 由即時來源產出即可，落帳/彙總已凍結當下匯率寫稽核欄位。
 */
export function getTwdPerUsd(
  env: { TWD_PER_USD?: string; USD_TO_TWD_RATE?: string } = process.env
): number {
  return resolveTwdPerUsd(
    env.TWD_PER_USD,
    env.USD_TO_TWD_RATE,
    DEFAULT_USD_TO_TWD_RATE
  );
}

// ─── 歸屬維度展開（pure）─────────────────────────────────────────────────────

/** 一筆 AI 用量事件的歸屬輸入（呼叫端從 usage event / 生成上下文蒐集後傳入）。 */
export interface UsageAttributionInput {
  /** 真實呼叫價（USD，非估算）。沿用 #940 約定的 DECIMAL(12,6) 字串或 number。 */
  costUsd: number | string;
  /** 成本歸屬到的 member（user id）。拿不到傳 null/undefined → 用 "anon"。 */
  userId?: number | string | null;
  /** 歸屬到的 project（拿不到誠實留空）。 */
  projectId?: number | string | null;
  /** 歸屬到的 workflow / run（拿不到誠實留空）。 */
  workflowId?: number | string | null;
  /** AIDV-130：歸屬到的 Skill（格式 skillId@version，拿不到誠實留空）。 */
  skillId?: string | null;
  provider?: string | null;
  model?: string | null;
  /** 成本數字來源："provider"＝上游真實計費；"catalog"＝目錄真實單位價後援。稽核用。 */
  costSource?: string | null;
  /**
   * AIDV-14：成本發生（呼叫/enqueue）當下凍結的 TWD/USD 匯率。enqueueAttribution
   * 會自動把當下 rate 寫入；drain 重放時優先用此凍結值，而非 drain 當下匯率，確保
   * ledger 的 exchangeRate/amountTwd 反映成本發生當下而非補帳當下（稽核回溯正確）。
   */
  frozenRate?: number | null;
  /** 冪等基準鍵（通常 = aue:<usageEventId>）。各維度由此衍生不同子鍵。 */
  idempotencyKey: string;
  refType?: string | null;
  refId?: string | null;
  /** AIDV-130 S-5：Skill 成本維度（有 Skill 上下文時傳入）。 */
  skillId?: string | null;
  skillVersion?: string | null;
}

/**
 * pure：把一筆 usage 事件展開成「每個可得歸屬維度各一筆平衡複式分錄」的
 * PostTransactionInput 陣列。
 *
 *   - member：必有（userId 拿不到 → "anon"）。
 *   - project / workflow：只有拿得到 id 時才產出（誠實留空＝不產該維度腳）。
 *
 * 每筆借（fromAccount=<dim>:<id>）/ 貸（toAccount=expense:ai-cost）金額相等＝USD 真實
 * 價；meta 帶凍結的 sourceCurrency=USD / exchangeRate / amountTwd（=usd×rate）/
 * provider / model，以利「以 TWD 彙總」且「稽核回溯原始幣別與匯率」。
 *
 * 冪等：不同維度用不同子鍵（`${key}:member` / `${key}:project` / `${key}:workflow`），
 * 故同一事件多維落帳彼此不撞鍵、重送也不雙重入帳。
 *
 * costUsd 正規化後為 0（無真實價）→ 回空陣列（不落帳，避免 $0 髒列）。
 */
export function buildAttributionEntries(
  input: UsageAttributionInput,
  rate: number
): PostTransactionInput[] {
  const amountUsd = normalizeAmount(input.costUsd);
  if (amountUsd === "0") return [];

  const usd = Number(amountUsd);
  const amountTwd = usdToTwd(usd, rate);
  const meta = {
    sourceCurrency: "USD",
    exchangeRate: rate,
    amountTwd,
    provider: input.provider ?? null,
    model: input.model ?? null,
    costSource: input.costSource ?? null,
    skillId: input.skillId ?? null,
    skillVersion: input.skillVersion ?? null,
  };

  const dims: Array<{
    type: LedgerAccountType;
    id: string | number;
    suffix: string;
    extraMeta: { projectId?: string; workflowId?: string; skillId?: string };
  }> = [];

  // member：必有。
  const memberId =
    input.userId != null && String(input.userId).trim() !== ""
      ? input.userId
      : "anon";
  dims.push({ type: "member", id: memberId, suffix: "member", extraMeta: {} });

  // project：拿得到才有。
  if (input.projectId != null && String(input.projectId).trim() !== "") {
    const pid = String(input.projectId).trim();
    dims.push({
      type: "project",
      id: pid,
      suffix: "project",
      extraMeta: { projectId: pid },
    });
  }

  // workflow：拿得到才有。
  if (input.workflowId != null && String(input.workflowId).trim() !== "") {
    const wid = String(input.workflowId).trim();
    dims.push({
      type: "workflow",
      id: wid,
      suffix: "workflow",
      extraMeta: { workflowId: wid },
    });
  }

  // skill：AIDV-130，拿得到才有（格式 skillId@version）。
  if (input.skillId != null && String(input.skillId).trim() !== "") {
    const sid = String(input.skillId).trim();
    dims.push({
      type: "skill",
      id: sid,
      suffix: "skill",
      extraMeta: { skillId: sid },
    });
  }

  // 每個維度都把 projectId/workflowId/skillId（若有）一併寫進 meta，方便彙總查詢交叉維度。
  const sharedDimMeta = {
    projectId:
      input.projectId != null && String(input.projectId).trim() !== ""
        ? String(input.projectId).trim()
        : null,
    workflowId:
      input.workflowId != null && String(input.workflowId).trim() !== ""
        ? String(input.workflowId).trim()
        : null,
    skillId:
      input.skillId != null && String(input.skillId).trim() !== ""
        ? String(input.skillId).trim()
        : null,
  };

  return dims.map(d => ({
    fromAccount: makeAccountKey(d.type, d.id),
    toAccount: EXPENSE_AI_COST_ACCOUNT,
    amount: amountUsd,
    idempotencyKey: `${input.idempotencyKey}:${d.suffix}`,
    refType: input.refType ?? "ai_usage_event",
    refId: input.refId ?? null,
    meta: { ...meta, ...sharedDimMeta },
  }));
}

// ─── 直接落帳（drain 與測試用）───────────────────────────────────────────────

export interface PostAttributedCostResult {
  outcome: "posted" | "skipped" | "empty";
  /** 各維度 postTransaction 的結果（posted 時才有）。 */
  posted: number;
}

/**
 * 把一筆 usage 事件的多維歸屬「直接」寫進 cost_ledger（不經 outbox）。drain job 與
 * 單測用。db==null → skipped；無真實價 → empty。各維度 postTransaction 冪等，故重放
 * 安全。任一維度 throw（非重複鍵）會上拋給 caller（drain 會據此 attempts++ 重試）。
 *
 * AIDV-14：匯率優先用 input.frozenRate（成本發生當下凍結，由 enqueueAttribution 寫入），
 * 拿不到才退回傳入 rate（drain 當下）。確保稽核欄位反映成本發生當下而非補帳當下。
 */
export async function postAttributedCost(
  db: LedgerDb | null | undefined,
  input: UsageAttributionInput,
  rate: number
): Promise<PostAttributedCostResult> {
  if (!db) return { outcome: "skipped", posted: 0 };
  const effectiveRate =
    input.frozenRate != null && Number.isFinite(input.frozenRate)
      ? input.frozenRate
      : rate;
  const entries = buildAttributionEntries(input, effectiveRate);
  if (entries.length === 0) return { outcome: "empty", posted: 0 };
  let posted = 0;
  for (const entry of entries) {
    const r = await postTransaction(db, entry);
    if (r.outcome === "inserted" || r.outcome === "duplicate") posted++;
  }
  return { outcome: "posted", posted };
}

// ─── Outbox：不漏帳 ─────────────────────────────────────────────────────────

/** outbox 表的最小結構型 DB 介面（避免綁死 mysql2 具體型別，利於單測注入）。 */
export interface OutboxDb extends LedgerDb {
  insert: (table: unknown) => {
    values: (v: unknown) => Promise<unknown>;
  };
  select: (cols?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit?: (n: number) => Promise<unknown[]>;
      } & Promise<unknown[]>;
    };
  };
  update: (table: unknown) => {
    set: (v: unknown) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; message?: string };
  if (e.code === "ER_DUP_ENTRY") return true;
  if (e.errno === 1062) return true;
  if (typeof e.message === "string" && /duplicate entry/i.test(e.message))
    return true;
  return false;
}

export interface EnqueueResult {
  outcome: "enqueued" | "duplicate" | "skipped";
}

/**
 * 把落帳意圖原子寫入 outbox（pending）。這是「不漏帳」的關鍵：呼叫端在熱路徑外
 * 只做這一次輕量 insert（永不同步等待 ledger 寫入），ledger 實際落帳交給 drain 重試。
 *
 * AIDV-14：在此「成本發生當下」就把生效匯率凍進 payload（frozenRate）。drain 重放
 * 時優先用此凍結值，而非補帳當下的 getTwdPerUsd()，確保 ledger 的 exchangeRate/
 * amountTwd 反映成本發生當下而非 drain 當下（即使 admin 期間調整 TWD_PER_USD 也不漂）。
 * 若呼叫端已自帶 input.frozenRate 則沿用，否則用傳入 rate（預設 getTwdPerUsd()）。
 *
 * db==null → skipped（demo/無 DB 安全）；idempotencyKey 已存在 → duplicate（冪等）。
 * 永不 throw 非預期錯誤以外的東西（DB 非重複鍵錯誤上拋，由呼叫端 try/catch 吞）。
 */
export async function enqueueAttribution(
  db: OutboxDb | null | undefined,
  input: UsageAttributionInput,
  rate: number = getTwdPerUsd()
): Promise<EnqueueResult> {
  if (!db) return { outcome: "skipped" };
  // 凍結成本發生當下的匯率（已自帶就沿用，避免覆寫呼叫端更精準的值）。
  const frozen =
    input.frozenRate != null && Number.isFinite(input.frozenRate)
      ? input.frozenRate
      : rate;
  const payload: UsageAttributionInput = { ...input, frozenRate: frozen };
  const row: InsertCostAttributionOutbox = {
    idempotencyKey: input.idempotencyKey,
    status: "pending",
    payloadJson: payload as unknown as Record<string, unknown>,
    attempts: 0,
  };
  try {
    await db.insert(costAttributionOutbox).values(row);
    return { outcome: "enqueued" };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { outcome: "duplicate" };
    throw err;
  }
}

/** drain 設定：重試上限（超過標 dead），與單次 drain 批量上限。 */
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_DRAIN_BATCH = 100;

export interface DrainResult {
  status: "ok" | "skipped";
  scanned: number;
  posted: number;
  failed: number;
  dead: number;
}

/**
 * drain outbox：撈 pending 列，逐筆重放 postAttributedCost；成功標 done、失敗
 * attempts++ 留 pending（下輪重試），達 OUTBOX_MAX_ATTEMPTS 標 dead（留人工查）。
 *
 * 不漏帳保證：ledger 寫入失敗時 outbox 列維持 pending，下一輪 drain 會再試，直到
 * 成功或標 dead；冪等鍵確保重送不雙重入帳。db==null → skipped（永不 throw）。
 */
export async function drainAttributionOutbox(
  db: OutboxDb | null | undefined,
  rate: number,
  batchSize: number = OUTBOX_DRAIN_BATCH
): Promise<DrainResult> {
  if (!db) return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };

  let rows: Array<{
    id: number;
    idempotencyKey: string;
    payloadJson: UsageAttributionInput;
    attempts: number;
  }> = [];
  try {
    const q = db
      .select({
        id: costAttributionOutbox.id,
        idempotencyKey: costAttributionOutbox.idempotencyKey,
        payloadJson: costAttributionOutbox.payloadJson,
        attempts: costAttributionOutbox.attempts,
      })
      .from(costAttributionOutbox)
      .where(eq(costAttributionOutbox.status, "pending"));
    const limited = typeof q.limit === "function" ? q.limit(batchSize) : q;
    rows = (await limited) as typeof rows;
  } catch {
    return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };
  }

  let posted = 0;
  let failed = 0;
  let dead = 0;
  for (const r of rows) {
    try {
      const res = await postAttributedCost(db, r.payloadJson, rate);
      if (res.outcome === "posted" || res.outcome === "empty") {
        await db
          .update(costAttributionOutbox)
          .set({ status: "done", updatedAt: new Date() })
          .where(eq(costAttributionOutbox.id, r.id));
        posted++;
      }
    } catch (err) {
      const nextAttempts = (r.attempts ?? 0) + 1;
      const nextStatus = nextAttempts >= OUTBOX_MAX_ATTEMPTS ? "dead" : "pending";
      if (nextStatus === "dead") dead++;
      else failed++;
      try {
        await db
          .update(costAttributionOutbox)
          .set({
            attempts: nextAttempts,
            status: nextStatus,
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(costAttributionOutbox.id, r.id));
      } catch {
        // 更新 outbox 失敗不致命：列維持 pending，下輪再試。
      }
    }
  }
  return { status: "ok", scanned: rows.length, posted, failed, dead };
}

// ─── 彙總查詢（唯讀，以 TWD）─────────────────────────────────────────────────

/** ledger 列子集，供彙總純函式（不需 DB，可單測）。 */
export interface LedgerRowForSummary {
  accountKey: string;
  entryType: "debit" | "credit";
  amount: string | number;
  amountTwd?: string | number | null;
  provider?: string | null;
  model?: string | null;
}

export interface AttributionSummaryRow {
  /** 維度型別（project/member/workflow）。 */
  type: string;
  /** 維度 id（accountKey 去掉 "type:" 前綴）。 */
  id: string;
  costUsd: number;
  costTwd: number;
  entries: number;
}

/**
 * pure：把 posted 列依「accountKey 的維度前綴」分組彙總成「淨額」USD/TWD 金額。
 *
 * AIDV-14：debit（消耗成本）加總、credit（退款沖銷）扣減，回「淨額」＝SUM(debit) −
 * SUM(同維度 credit)。故一旦有退款/回沖落帳，前台呈現的是淨成本而非毛額（不再高估）。
 * 淨額 clamp 到 ≥0（避免退款多於消耗時出現負成本污染前台；理論上同維度不該超扣）。
 *
 * dimension 過濾："project" / "member" / "workflow"（不傳＝全部維度）。
 *
 * costTwd 優先用列上凍結的 amountTwd（落帳當下匯率，稽核準）；該列無 amountTwd（如
 * #940 舊資料）時 fallback 用傳入 rate 現算，確保彙總永遠有 TWD 數字（不 $0）。
 * entries 只計 debit 筆數（消耗事件數；credit 是沖銷不另計筆）。
 */
export function summarizeAttribution(
  rows: LedgerRowForSummary[],
  rate: number,
  dimension?: "project" | "member" | "workflow" | "skill"
): AttributionSummaryRow[] {
  const acc = new Map<string, AttributionSummaryRow>();
  for (const r of rows) {
    if (r.entryType !== "debit" && r.entryType !== "credit") continue;
    const sep = r.accountKey.indexOf(":");
    if (sep < 0) continue;
    const type = r.accountKey.slice(0, sep);
    const id = r.accountKey.slice(sep + 1);
    if (dimension && type !== dimension) continue;
    // expense:ai-cost 等對手科目不是歸屬維度，略過。
    if (
      type !== "project" &&
      type !== "member" &&
      type !== "workflow" &&
      type !== "skill"
    )
      continue;

    const usd = Number(r.amount);
    if (!Number.isFinite(usd) || usd < 0) continue;
    const twdFrozen =
      r.amountTwd != null && Number.isFinite(Number(r.amountTwd))
        ? Number(r.amountTwd)
        : usdToTwd(usd, rate);

    const key = r.accountKey;
    const cur = acc.get(key) ?? { type, id, costUsd: 0, costTwd: 0, entries: 0 };
    // debit 加、credit（退款沖銷）減 → 淨額。
    const sign = r.entryType === "credit" ? -1 : 1;
    cur.costUsd = Number((cur.costUsd + sign * usd).toFixed(6));
    cur.costTwd = Number((cur.costTwd + sign * twdFrozen).toFixed(4));
    if (r.entryType === "debit") cur.entries += 1;
    acc.set(key, cur);
  }
  // 淨額 clamp 到 ≥0，並濾掉全額退掉（淨額為 0）的維度列。
  const out: AttributionSummaryRow[] = [];
  for (const cur of acc.values()) {
    cur.costUsd = Number(Math.max(0, cur.costUsd).toFixed(6));
    cur.costTwd = Number(Math.max(0, cur.costTwd).toFixed(4));
    if (cur.entries === 0 && cur.costUsd === 0 && cur.costTwd === 0) continue;
    out.push(cur);
  }
  return out.sort((a, b) => b.costTwd - a.costTwd);
}

// ─── AIDV-130 S-5：依 Skill 維度彙總（唯讀，pure）────────────────────────────

/** ledger 列子集，含 Skill 維度欄位，供 summarizeSkillCost 使用。 */
export interface LedgerRowForSkillSummary extends LedgerRowForSummary {
  skillId?: string | null;
  skillVersion?: string | null;
}

export interface SkillCostRow {
  skillId: string;
  /** 最後一次落帳使用的 skillVersion（多版本同 id 時取最後一筆）。 */
  skillVersion: string | null;
  costUsd: number;
  costTwd: number;
  /** debit 次數（消耗事件數；credit 是沖銷不另計）。 */
  entries: number;
}

/**
 * pure：把 cost_ledger posted 列依 skillId 分組彙總成「淨額」USD/TWD 成本。
 *
 * 與 summarizeAttribution 邏輯一致：debit 加、credit 減 → 淨額 clamp ≥0。
 * 供「依 Skill 彙總成本報表、知道哪個 Skill 最燒錢」查詢（AIDV-130 完成定義）。
 *
 * 無 skillId 的列（舊資料或非 Skill 觸發）自動略過，不污染 Skill 視角。
 */
export function summarizeSkillCost(
  rows: LedgerRowForSkillSummary[],
  rate: number
): SkillCostRow[] {
  const acc = new Map<string, SkillCostRow>();
  for (const r of rows) {
    if (r.entryType !== "debit" && r.entryType !== "credit") continue;
    if (!r.skillId || String(r.skillId).trim() === "") continue;
    const sid = String(r.skillId).trim();
    const usd = Number(r.amount);
    if (!Number.isFinite(usd) || usd < 0) continue;
    const twdFrozen =
      r.amountTwd != null && Number.isFinite(Number(r.amountTwd))
        ? Number(r.amountTwd)
        : usdToTwd(usd, rate);
    const cur = acc.get(sid) ?? {
      skillId: sid,
      skillVersion: r.skillVersion ?? null,
      costUsd: 0,
      costTwd: 0,
      entries: 0,
    };
    const sign = r.entryType === "credit" ? -1 : 1;
    cur.costUsd = Number((cur.costUsd + sign * usd).toFixed(6));
    cur.costTwd = Number((cur.costTwd + sign * twdFrozen).toFixed(4));
    if (r.entryType === "debit") cur.entries += 1;
    if (r.skillVersion) cur.skillVersion = r.skillVersion;
    acc.set(sid, cur);
  }
  const out: SkillCostRow[] = [];
  for (const cur of acc.values()) {
    cur.costUsd = Number(Math.max(0, cur.costUsd).toFixed(6));
    cur.costTwd = Number(Math.max(0, cur.costTwd).toFixed(4));
    if (cur.entries === 0 && cur.costUsd === 0 && cur.costTwd === 0) continue;
    out.push(cur);
  }
  return out.sort((a, b) => b.costTwd - a.costTwd);
}
