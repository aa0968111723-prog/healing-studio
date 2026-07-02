/**
 * stripeFulfillment.ts — AIDV-167：Stripe webhook 事件真實落地（開通/續期/降級）
 * ──────────────────────────────────────────────────────────────────────────
 * AIDV-159 已把簽章驗證修真；本服務補上「收到通知後該幫使用者開通付費／續期／
 * 降級」的實際動作（寫入 user_subscriptions），取代 console.log stub。
 *
 * ── HARD 承諾 ────────────────────────────────────────────────────────────
 *   1. 旗標 STRIPE_FULFILLMENT 預設 OFF：OFF 時本模組完全不被進入，webhook
 *      行為與 AIDV-159 位元相同（stub log）。
 *   2. 冪等 + 重放安全：每顆事件先以 eventId UNIQUE claim 進
 *      stripe_webhook_events（雙保險：快路徑查詢 + DB UNIQUE 撞 ER_DUP_ENTRY）；
 *      重送同事件只落地一次。subscription 事件另做 event.created 亂序防護
 *      （已套用更新的 processed 事件 → 舊事件 skipped，不倒退狀態）。
 *   3. 計費嚴標「只入帳不扣款」：本服務對點數/帳本**只可能 credit（入帳）**
 *      （invoice.paid 成功收款 → cost_ledger 複式分錄 credit member），永不
 *      debit 使用者、永不扣 remainingGenerations、永不動 quotaJson。
 *   4. 裁決從嚴（hold 轉人審）：任何資訊不足（無法解析 userId、方案未對照、
 *      未知訂閱狀態、付款未完成）一律不自動變更權益，事件標 held +
 *      holdReason 轉人審（stripe_webhook_events 可查、稽核軌跡留痕）。
 *   5. 失敗安全：處理拋錯 → 事件標 failed、webhook 回 5xx 讓 Stripe 重試；
 *      因為一切落地皆冪等（upsert 到目標狀態 + ledger 冪等鍵），重試安全。
 *
 * ── 架構 ────────────────────────────────────────────────────────────────
 *   processStripeEvent(store, event)：主流程（claim → dispatch → settle）。
 *   BillingStore：語義化儲存介面（依賴注入）——單測用 in-memory fake、
 *   生產用 createDrizzleBillingStore(db)（薄接線層，直接寫 drizzle）。
 *   純函式（旗標/對照表解析、狀態映射、金額換算）獨立可單測。
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { serverEnv } from "../../_core/env.validated";
import {
  stripeWebhookEvents,
  userSubscriptions,
  users,
} from "../../../drizzle/schema";
import {
  hashIdempotencyKey,
  isCostLedgerEnabled,
  makeAccountKey,
  postTransaction,
  type LedgerDb,
} from "../cost/ledger";
import { recordAuditEvent } from "../audit/auditLog";
// type-only：編譯期抹除，單測（mock store）不會於 runtime 觸碰 db.ts。
import type { getDb } from "../../db";

// ─── 常數 ────────────────────────────────────────────────────────────────────

/** 合法 planId 白名單（對齊 subscription_plans.tier enum）。其外一律 hold。 */
export const VALID_PLAN_IDS = ["free", "starter", "pro", "enterprise"] as const;
export type ValidPlanId = (typeof VALID_PLAN_IDS)[number];

/** invoice.paid 入帳的複式分錄對手科目（debit 腳；member 為 credit 腳）。 */
export const STRIPE_REVENUE_ACCOUNT = "stripe:revenue";

/** 本服務接手的事件類型（其餘一律安全略過，不落表）。 */
export const HANDLED_STRIPE_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
export type HandledStripeEventType = (typeof HANDLED_STRIPE_EVENT_TYPES)[number];

/** processing 列超過此毫秒數視為孤兒（前次處理中途死亡），允許 re-claim。 */
export const RECLAIM_STALE_PROCESSING_MS = 10 * 60 * 1000;

/** Stripe zero-decimal 幣別（amount 已是主單位，不再 /100）。 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

// ─── 純函式（無 I/O，可單測）──────────────────────────────────────────────────

/**
 * 旗標：STRIPE_FULFILLMENT。預設 OFF（未設/空/其它值都 OFF）；
 * 只有明確 "1"/"true"/"on"/"yes"（大小寫/空白不拘）才啟用真實落地。
 */
export function isStripeFulfillmentEnabled(): boolean {
  const raw = serverEnv.STRIPE_FULFILLMENT;
  if (raw === undefined || raw === null) return false;
  return ["1", "true", "on", "yes"].includes(String(raw).trim().toLowerCase());
}

/**
 * 解析 STRIPE_PRICE_PLAN_MAP（JSON 物件 {priceId: planId}）。
 * 失敗安全：非法 JSON / 非物件 → {}；planId 不在白名單的條目被丟棄（絕不猜方案）。
 */
export function parsePricePlanMap(
  raw: string | undefined | null
): Record<string, ValidPlanId> {
  if (!raw || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, ValidPlanId> = {};
  for (const [price, plan] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = normalizePlanId(plan);
    if (price.trim() !== "" && normalized) out[price.trim()] = normalized;
  }
  return out;
}

/** planId 白名單驗證（trim + 小寫）。不在白名單 → null（從嚴）。 */
export function normalizePlanId(candidate: unknown): ValidPlanId | null {
  if (typeof candidate !== "string") return null;
  const v = candidate.trim().toLowerCase();
  return (VALID_PLAN_IDS as readonly string[]).includes(v)
    ? (v as ValidPlanId)
    : null;
}

/** user_subscriptions.status enum（drizzle schema 對齊）。 */
export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trialing";

/**
 * Stripe 訂閱狀態 → 本地 status enum。未知狀態（incomplete / paused / 其它）
 * 回 null → 呼叫端 hold 轉人審（從嚴，不自動變更）。
 */
export function mapStripeSubscriptionStatus(
  raw: unknown
): SubscriptionStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim().toLowerCase()) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "cancelled":
    case "unpaid":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null;
  }
}

/** Stripe 最小單位金額 → 主單位（zero-decimal 幣別不除 100）。非法 → 0。 */
export function toMajorUnits(minor: unknown, currency: unknown): number {
  const n = typeof minor === "number" ? minor : Number(minor);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const cur = typeof currency === "string" ? currency.trim().toLowerCase() : "";
  return ZERO_DECIMAL_CURRENCIES.has(cur) ? n : n / 100;
}

/** unix 秒 → Date；非法/非正 → null。 */
export function unixToDate(v: unknown): Date | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

/** 正整數解析（"42" / 42 → 42）；其餘 → null。 */
export function parsePositiveInt(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v > 0 ? v : null;
  }
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** 非空字串 → trim 後回傳；其餘 → null。 */
function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

type StripeObject = Record<string, unknown>;

/** 從 data.object 抽出關聯的 Stripe subscription id（亂序防護分組鍵）。 */
export function extractSubscriptionId(obj: StripeObject): string | null {
  // subscription 物件本身：object === "subscription" 時 id 即 sub_...
  if (strOrNull(obj.object) === "subscription") return strOrNull(obj.id);
  // checkout.session / invoice：subscription 欄位（string 或 expanded object）。
  const sub = obj.subscription;
  if (typeof sub === "string") return strOrNull(sub);
  if (sub && typeof sub === "object") {
    return strOrNull((sub as StripeObject).id);
  }
  return null;
}

/** 從 data.object 抽 customer id（string 或 expanded object 皆可）。 */
function extractCustomerId(obj: StripeObject): string | null {
  const c = obj.customer;
  if (typeof c === "string") return strOrNull(c);
  if (c && typeof c === "object") return strOrNull((c as StripeObject).id);
  return null;
}

/** 從 subscription.items / invoice.lines 抽出所有 price id（方案對照用）。 */
export function extractPriceIds(obj: StripeObject): string[] {
  const out: string[] = [];
  const collect = (container: unknown) => {
    if (!container || typeof container !== "object") return;
    const data = (container as StripeObject).data;
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const price = (item as StripeObject).price;
      if (typeof price === "string") {
        const p = strOrNull(price);
        if (p) out.push(p);
      } else if (price && typeof price === "object") {
        const p = strOrNull((price as StripeObject).id);
        if (p) out.push(p);
      }
    }
  };
  collect(obj.items); // customer.subscription.* → items.data[].price
  collect(obj.lines); // invoice.* → lines.data[].price
  return out;
}

export interface PlanResolution {
  planId: ValidPlanId | null;
  /** 有 price 但無對照時的第一個 price id（hold 原因用）。 */
  unresolvedPrice: string | null;
}

/**
 * 解析事件對應的 planId：metadata.planId（白名單驗證）優先，其次
 * STRIPE_PRICE_PLAN_MAP 的 price 對照。都對不上 → planId=null（呼叫端從嚴 hold）。
 */
export function resolvePlanForObject(
  obj: StripeObject,
  planMap: Record<string, ValidPlanId>
): PlanResolution {
  const metadata =
    obj.metadata && typeof obj.metadata === "object"
      ? (obj.metadata as StripeObject)
      : {};
  const metaPlan = normalizePlanId(metadata.planId);
  if (metaPlan) return { planId: metaPlan, unresolvedPrice: null };
  const priceIds = extractPriceIds(obj);
  for (const priceId of priceIds) {
    const mapped = planMap[priceId];
    if (mapped) return { planId: mapped, unresolvedPrice: null };
  }
  return { planId: null, unresolvedPrice: priceIds[0] ?? null };
}

// ─── 事件封包（route 解析 req.body 後傳入）────────────────────────────────────

export interface StripeEventEnvelope {
  id?: unknown;
  type?: unknown;
  /** Stripe event.created（unix 秒）。 */
  created?: unknown;
  data?: { object?: unknown };
}

// ─── BillingStore：語義化儲存介面（依賴注入）─────────────────────────────────

export type ClaimOutcome = "claimed" | "reclaimed" | "duplicate";

export interface WebhookEventClaim {
  eventId: string;
  eventType: string;
  objectId: string | null;
  subscriptionId: string | null;
  eventCreated: Date | null;
  payload: Record<string, unknown> | null;
}

export type SettledEventStatus = "processed" | "held" | "skipped" | "failed";

export interface SubscriptionPatch {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  planId?: ValidPlanId;
  status?: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface BillingStore {
  /** 事件級冪等 claim。duplicate＝已處理過（或處理中），呼叫端直接返回。 */
  claimEvent(claim: WebhookEventClaim): Promise<ClaimOutcome>;
  /** 處理結束落結果（processed/held/skipped/failed + 原因）。 */
  settleEvent(
    eventId: string,
    patch: { status: SettledEventStatus; holdReason?: string | null; error?: string | null }
  ): Promise<void>;
  /** 亂序防護：同 subscription 是否已有「更新的 processed」事件。 */
  hasNewerProcessedSubscriptionEvent(
    subscriptionId: string,
    eventCreated: Date
  ): Promise<boolean>;
  /** 該 subscription 是否已 processed 過 deleted 事件（terminal）。 */
  hasProcessedDeletion(subscriptionId: string): Promise<boolean>;
  userExists(userId: number): Promise<boolean>;
  getSubscriptionByUserId(
    userId: number
  ): Promise<{ planId: string; status: string | null } | null>;
  findUserIdByStripeSubscriptionId(subscriptionId: string): Promise<number | null>;
  findUserIdByStripeCustomerId(customerId: string): Promise<number | null>;
  /** 以 userId 為唯一鍵 upsert user_subscriptions（冪等：重放收斂到同一目標狀態）。 */
  upsertUserSubscription(userId: number, patch: SubscriptionPatch): Promise<void>;
  /**
   * 只入帳不扣款：invoice 收款 → cost_ledger 複式分錄
   * （debit stripe:revenue + credit member:<userId>），以 invoiceId 冪等。
   */
  postInvoiceCredit(input: {
    userId: number;
    invoiceId: string;
    amountMajor: number;
    currency: string;
  }): Promise<"inserted" | "duplicate" | "skipped" | "invalid">;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

export type FulfillOutcome =
  | { outcome: "processed"; detail?: string; userId?: number }
  | { outcome: "duplicate" }
  | { outcome: "held"; reason: string; userId?: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string };

/** handler 內部回傳（不含 duplicate/failed，主流程負責那兩種）。 */
type HandlerOutcome =
  | { outcome: "processed"; detail?: string; userId?: number }
  | { outcome: "held"; reason: string; userId?: number }
  | { outcome: "skipped"; reason: string };

/**
 * 處理一顆已通過簽章驗證的 Stripe 事件（旗標 ON 時由 route 呼叫）。
 * 冪等（事件級 claim）＋重放安全（亂序防護）＋從嚴裁決（不確定一律 held 人審）。
 * 拋錯不外洩：任何未預期錯誤 → 事件標 failed、回 { outcome: "failed" }，
 * route 依此回 5xx 讓 Stripe 重試。
 */
export async function processStripeEvent(
  store: BillingStore,
  event: StripeEventEnvelope
): Promise<FulfillOutcome> {
  const type = strOrNull(event.type) ?? "";
  if (!(HANDLED_STRIPE_EVENT_TYPES as readonly string[]).includes(type)) {
    // 未接手的事件：維持既有「已接收、略過」行為，不落表（避免表被灌爆）。
    return { outcome: "skipped", reason: `未接手的事件類型：${type || "(缺 type)"}` };
  }

  const rawObject = event.data?.object;
  const object: StripeObject | null =
    rawObject && typeof rawObject === "object" && !Array.isArray(rawObject)
      ? (rawObject as StripeObject)
      : null;

  // eventId：Stripe 一定有 evt_...；防禦性 fallback 用 payload 雜湊（同 payload
  // 重放仍冪等）。
  const eventId =
    strOrNull(event.id) ??
    hashIdempotencyKey("stripe-evt", `${type}:${JSON.stringify(rawObject ?? null)}`);
  const eventCreated = unixToDate(event.created);
  const subscriptionId = object ? extractSubscriptionId(object) : null;

  // ── (1) 事件級冪等 claim ──
  const claim = await store.claimEvent({
    eventId,
    eventType: type,
    objectId: object ? strOrNull(object.id) : null,
    subscriptionId,
    eventCreated,
    payload: object,
  });
  if (claim === "duplicate") return { outcome: "duplicate" };

  // ── (2) dispatch + settle ──
  try {
    let result: HandlerOutcome;
    if (!object) {
      result = { outcome: "held", reason: "payload 缺 data.object，無法落地，轉人審" };
    } else {
      const planMap = parsePricePlanMap(serverEnv.STRIPE_PRICE_PLAN_MAP);
      switch (type as HandledStripeEventType) {
        case "checkout.session.completed":
          result = await handleCheckoutSessionCompleted(store, object, planMap);
          break;
        case "invoice.paid":
          result = await handleInvoicePaid(store, object, planMap, eventId);
          break;
        case "invoice.payment_failed":
          result = await handleInvoicePaymentFailed(store, object);
          break;
        case "customer.subscription.updated":
          result = await handleSubscriptionUpdated(
            store,
            object,
            planMap,
            subscriptionId,
            eventCreated
          );
          break;
        case "customer.subscription.deleted":
          result = await handleSubscriptionDeleted(store, object);
          break;
      }
    }

    await store.settleEvent(eventId, {
      status: result.outcome,
      holdReason:
        result.outcome === "held" || result.outcome === "skipped"
          ? result.reason
          : null,
      error: null,
    });

    // 稽核軌跡（AIDV-123）：best-effort fire-and-forget，絕不影響主流程。
    recordAuditEvent({
      action: `billing.stripe.${type}`,
      targetType: "stripe_event",
      targetId: eventId,
      result: result.outcome === "processed" ? "success" : "failure",
      metadata: {
        outcome: result.outcome,
        userId: "userId" in result ? (result.userId ?? null) : null,
        reason: "reason" in result ? result.reason : null,
        detail: "detail" in result ? (result.detail ?? null) : null,
        subscriptionId,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await store.settleEvent(eventId, { status: "failed", error: message });
    } catch {
      // settle 失敗不掩蓋原錯誤；事件列留在 processing，逾時後可 re-claim。
    }
    recordAuditEvent({
      action: `billing.stripe.${type}`,
      targetType: "stripe_event",
      targetId: eventId,
      result: "failure",
      metadata: { outcome: "failed", error: message, subscriptionId },
    });
    return { outcome: "failed", reason: message };
  }
}

// ─── userId 解析（從嚴）──────────────────────────────────────────────────────

/**
 * 依序解析事件對應的本地 userId：
 *   1. metadata.userId（**存在即為權威**：使用者不存在→直接 null 轉人審，
 *      不 fallback 到其它線索——防錯綁）。
 *   2. client_reference_id（checkout session；需 users 存在）。
 *   3. user_subscriptions.stripeSubscriptionId 反查。
 *   4. user_subscriptions.stripeCustomerId 反查。
 * 全部落空 → null（呼叫端 hold 轉人審，絕不猜）。
 */
async function resolveUserId(
  store: BillingStore,
  obj: StripeObject
): Promise<number | null> {
  const metadata =
    obj.metadata && typeof obj.metadata === "object"
      ? (obj.metadata as StripeObject)
      : {};
  if (metadata.userId !== undefined && metadata.userId !== null) {
    const metaUserId = parsePositiveInt(metadata.userId);
    if (metaUserId === null) return null; // metadata 有 userId 但非法 → 從嚴
    return (await store.userExists(metaUserId)) ? metaUserId : null;
  }
  const clientRef = parsePositiveInt(obj.client_reference_id);
  if (clientRef !== null && (await store.userExists(clientRef))) return clientRef;

  const subId = extractSubscriptionId(obj);
  if (subId) {
    const bySub = await store.findUserIdByStripeSubscriptionId(subId);
    if (bySub !== null) return bySub;
  }
  const customerId = extractCustomerId(obj);
  if (customerId) {
    const byCustomer = await store.findUserIdByStripeCustomerId(customerId);
    if (byCustomer !== null) return byCustomer;
  }
  return null;
}

// ─── 各事件 handler ──────────────────────────────────────────────────────────

/**
 * checkout.session.completed → 開通。
 * 從嚴：payment_status 非 paid/no_payment_required → held（非同步付款未完成，
 * 待 invoice.paid）；userId 解析不到 → held；方案解析不到 → 記錄開通
 * （customer/subscription id + status=active）但 planId 不動，held 轉人審補方案。
 */
async function handleCheckoutSessionCompleted(
  store: BillingStore,
  session: StripeObject,
  planMap: Record<string, ValidPlanId>
): Promise<HandlerOutcome> {
  const userId = await resolveUserId(store, session);
  if (userId === null) {
    return {
      outcome: "held",
      reason:
        "無法解析對應使用者（metadata.userId / client_reference_id / customer 均無法對應既有帳號），不自動開通",
    };
  }

  const paymentStatus = strOrNull(session.payment_status);
  if (
    paymentStatus !== null &&
    paymentStatus !== "paid" &&
    paymentStatus !== "no_payment_required"
  ) {
    return {
      outcome: "held",
      reason: `payment_status=${paymentStatus} 非已付款，不自動開通（等 invoice.paid 或人工確認）`,
      userId,
    };
  }

  const { planId, unresolvedPrice } = resolvePlanForObject(session, planMap);
  const patch: SubscriptionPatch = { status: "active" };
  const customerId = extractCustomerId(session);
  const subId = extractSubscriptionId(session);
  if (customerId) patch.stripeCustomerId = customerId;
  if (subId) patch.stripeSubscriptionId = subId;
  if (planId) patch.planId = planId;

  await store.upsertUserSubscription(userId, patch);

  if (!planId) {
    return {
      outcome: "held",
      reason:
        `已記錄開通（userId=${userId} status=active、Stripe id 已綁定），但方案無法解析` +
        `${unresolvedPrice ? `（price=${unresolvedPrice} 未在 STRIPE_PRICE_PLAN_MAP）` : "（無 metadata.planId 亦無可對照 price）"}` +
        "——planId 不變，轉人審補開方案",
      userId,
    };
  }
  return {
    outcome: "processed",
    detail: `開通完成：userId=${userId} planId=${planId}`,
    userId,
  };
}

/**
 * invoice.paid → 續期。
 * 更新 currentPeriodStart/End + status=active；只入帳不扣款：收款金額在
 * ENABLE_COST_LEDGER=ON 時以複式分錄 credit member（invoiceId 冪等）。
 * 從嚴：userId 解析不到 → held；「首次由 invoice 建立訂閱列」且方案未解析 → held。
 */
async function handleInvoicePaid(
  store: BillingStore,
  invoice: StripeObject,
  planMap: Record<string, ValidPlanId>,
  eventId: string
): Promise<HandlerOutcome> {
  const userId = await resolveUserId(store, invoice);
  if (userId === null) {
    return {
      outcome: "held",
      reason: "invoice.paid 無法解析對應使用者，不自動續期，轉人審",
    };
  }

  const existing = await store.getSubscriptionByUserId(userId);
  const { planId, unresolvedPrice } = resolvePlanForObject(invoice, planMap);

  // 期間：優先 lines.data[0].period（該期訂閱區間），fallback invoice.period_*。
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  const lines = invoice.lines;
  if (lines && typeof lines === "object") {
    const data = (lines as StripeObject).data;
    if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
      const period = (data[0] as StripeObject).period;
      if (period && typeof period === "object") {
        periodStart = unixToDate((period as StripeObject).start);
        periodEnd = unixToDate((period as StripeObject).end);
      }
    }
  }
  if (!periodStart) periodStart = unixToDate(invoice.period_start);
  if (!periodEnd) periodEnd = unixToDate(invoice.period_end);

  const patch: SubscriptionPatch = { status: "active" };
  const customerId = extractCustomerId(invoice);
  const subId = extractSubscriptionId(invoice);
  if (customerId) patch.stripeCustomerId = customerId;
  if (subId) patch.stripeSubscriptionId = subId;
  if (periodStart) patch.currentPeriodStart = periodStart;
  if (periodEnd) patch.currentPeriodEnd = periodEnd;
  if (planId) patch.planId = planId;

  await store.upsertUserSubscription(userId, patch);

  // 只入帳不扣款：成功收款 → credit member（複式分錄，invoiceId 冪等）。
  // 僅在 cost ledger 旗標 ON 時寫（旗標 OFF＝零帳本行為變化）。
  let ledgerNote = "ledger=off";
  const amountMajor = toMajorUnits(invoice.amount_paid, invoice.currency);
  if (isCostLedgerEnabled() && amountMajor > 0) {
    const invoiceId = strOrNull(invoice.id) ?? eventId;
    const ledgerOutcome = await store.postInvoiceCredit({
      userId,
      invoiceId,
      amountMajor,
      currency:
        (strOrNull(invoice.currency) ?? "usd").toUpperCase(),
    });
    ledgerNote = `ledger=${ledgerOutcome}`;
  }

  if (!existing && !planId) {
    return {
      outcome: "held",
      reason:
        `invoice.paid 首次建立訂閱列（userId=${userId}，續期資訊已寫入，${ledgerNote}），但方案無法解析` +
        `${unresolvedPrice ? `（price=${unresolvedPrice}）` : ""}——planId 維持預設，轉人審補開方案`,
      userId,
    };
  }
  return {
    outcome: "processed",
    detail: `續期完成：userId=${userId}${planId ? ` planId=${planId}` : ""} ${ledgerNote}`,
    userId,
  };
}

/**
 * invoice.payment_failed → 標記 past_due（催繳中）。
 * 只標狀態、絕不降級 planId、絕不扣任何點數。查無訂閱列 → held（不無中生有）。
 */
async function handleInvoicePaymentFailed(
  store: BillingStore,
  invoice: StripeObject
): Promise<HandlerOutcome> {
  const userId = await resolveUserId(store, invoice);
  if (userId === null) {
    return {
      outcome: "held",
      reason: "invoice.payment_failed 無法解析對應使用者，轉人審",
    };
  }
  const existing = await store.getSubscriptionByUserId(userId);
  if (!existing) {
    return {
      outcome: "held",
      reason: `invoice.payment_failed 但 userId=${userId} 查無訂閱列，不自動建立，轉人審`,
      userId,
    };
  }
  await store.upsertUserSubscription(userId, { status: "past_due" });
  return {
    outcome: "processed",
    detail: `付款失敗標記：userId=${userId} status=past_due（不降級、不扣點）`,
    userId,
  };
}

/**
 * customer.subscription.updated → 同步狀態/期間/cancelAtPeriodEnd（+方案變更）。
 * 重放安全：已 processed 過「更新的」同訂閱事件或 deleted（terminal）→ skipped。
 * 從嚴：未知 Stripe 狀態 → held 不動；方案變更對照不到 → 狀態照常同步、方案 held。
 */
async function handleSubscriptionUpdated(
  store: BillingStore,
  subscription: StripeObject,
  planMap: Record<string, ValidPlanId>,
  subscriptionId: string | null,
  eventCreated: Date | null
): Promise<HandlerOutcome> {
  if (subscriptionId) {
    if (await store.hasProcessedDeletion(subscriptionId)) {
      return {
        outcome: "skipped",
        reason: `subscription=${subscriptionId} 已處理過 deleted（terminal），忽略較舊的 updated`,
      };
    }
    if (
      eventCreated &&
      (await store.hasNewerProcessedSubscriptionEvent(subscriptionId, eventCreated))
    ) {
      return {
        outcome: "skipped",
        reason: `subscription=${subscriptionId} 已套用更新的事件（out-of-order 重放防護），不倒退狀態`,
      };
    }
  }

  const userId = await resolveUserId(store, subscription);
  if (userId === null) {
    return {
      outcome: "held",
      reason: "customer.subscription.updated 無法解析對應使用者，轉人審",
    };
  }

  const mappedStatus = mapStripeSubscriptionStatus(subscription.status);
  if (mappedStatus === null) {
    return {
      outcome: "held",
      reason: `未知的 Stripe 訂閱狀態「${String(subscription.status)}」，不自動變更權益，轉人審`,
      userId,
    };
  }

  const { planId, unresolvedPrice } = resolvePlanForObject(subscription, planMap);
  const patch: SubscriptionPatch = { status: mappedStatus };
  const customerId = extractCustomerId(subscription);
  if (customerId) patch.stripeCustomerId = customerId;
  if (subscriptionId) patch.stripeSubscriptionId = subscriptionId;
  if (typeof subscription.cancel_at_period_end === "boolean") {
    patch.cancelAtPeriodEnd = subscription.cancel_at_period_end;
  }
  const periodStart = unixToDate(subscription.current_period_start);
  const periodEnd = unixToDate(subscription.current_period_end);
  if (periodStart) patch.currentPeriodStart = periodStart;
  if (periodEnd) patch.currentPeriodEnd = periodEnd;
  if (planId) patch.planId = planId;

  await store.upsertUserSubscription(userId, patch);

  if (!planId && unresolvedPrice) {
    // 狀態已同步，但偵測到 price 變更無法對照 → 方案部分轉人審（從嚴）。
    return {
      outcome: "held",
      reason:
        `訂閱狀態已同步（userId=${userId} status=${mappedStatus}），但 price=${unresolvedPrice} ` +
        "未在 STRIPE_PRICE_PLAN_MAP／metadata 無 planId——方案變更轉人審",
      userId,
    };
  }
  return {
    outcome: "processed",
    detail:
      `訂閱同步：userId=${userId} status=${mappedStatus}` +
      `${planId ? ` planId=${planId}` : ""}` +
      `${typeof subscription.cancel_at_period_end === "boolean" ? ` cancelAtPeriodEnd=${subscription.cancel_at_period_end}` : ""}`,
    userId,
  };
}

/**
 * customer.subscription.deleted → 降級落地（terminal）。
 * status=cancelled + planId=free + cancelAtPeriodEnd=false。降級是安全方向
 * （收回權益），terminal 事件不做亂序 skip。查無使用者 → held；查無訂閱列 →
 * 本來就無權益，processed（no-op）。
 */
async function handleSubscriptionDeleted(
  store: BillingStore,
  subscription: StripeObject
): Promise<HandlerOutcome> {
  const userId = await resolveUserId(store, subscription);
  if (userId === null) {
    return {
      outcome: "held",
      reason: "customer.subscription.deleted 無法解析對應使用者，轉人審",
    };
  }
  const existing = await store.getSubscriptionByUserId(userId);
  if (!existing) {
    return {
      outcome: "processed",
      detail: `userId=${userId} 無訂閱列，無可降級（no-op）`,
      userId,
    };
  }
  await store.upsertUserSubscription(userId, {
    status: "cancelled",
    planId: "free",
    cancelAtPeriodEnd: false,
  });
  return {
    outcome: "processed",
    detail: `降級落地：userId=${userId} status=cancelled planId=free`,
    userId,
  };
}

// ─── Drizzle 接線層（生產 store）──────────────────────────────────────────────

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** MySQL 重複鍵錯誤判斷（ER_DUP_ENTRY=1062；比照 ledger.ts 的寬鬆嗅探）。 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number; message?: string };
  if (e.code === "ER_DUP_ENTRY") return true;
  if (e.errno === 1062) return true;
  if (typeof e.message === "string" && /duplicate entry/i.test(e.message)) return true;
  return false;
}

/**
 * 生產用 BillingStore：直接寫 drizzle（user_subscriptions / stripe_webhook_events /
 * cost_ledger）。所有寫入皆冪等（claim 靠 UNIQUE、訂閱靠 userId upsert、帳本靠
 * idempotencyKey）。
 */
export function createDrizzleBillingStore(db: DrizzleDb): BillingStore {
  return {
    async claimEvent(claim) {
      // 快路徑：已存在 → 依 status 決定 duplicate / re-claim。
      const rows = await db
        .select({
          status: stripeWebhookEvents.status,
          updatedAt: stripeWebhookEvents.updatedAt,
        })
        .from(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.eventId, claim.eventId))
        .limit(1);
      const existing = rows[0];
      if (existing) {
        const stale =
          existing.status === "processing" &&
          existing.updatedAt instanceof Date &&
          Date.now() - existing.updatedAt.getTime() > RECLAIM_STALE_PROCESSING_MS;
        if (existing.status === "failed" || stale) {
          // 前次失敗（或處理中途死亡逾時）→ 允許重試：attempts+1、回到 processing。
          await db
            .update(stripeWebhookEvents)
            .set({
              status: "processing",
              attempts: sql`${stripeWebhookEvents.attempts} + 1`,
              error: null,
            })
            .where(eq(stripeWebhookEvents.eventId, claim.eventId));
          return "reclaimed";
        }
        return "duplicate";
      }
      // 最終真相：UNIQUE(eventId)。併發雙寫其一撞 ER_DUP_ENTRY → duplicate。
      try {
        await db.insert(stripeWebhookEvents).values({
          eventId: claim.eventId,
          eventType: claim.eventType,
          objectId: claim.objectId,
          subscriptionId: claim.subscriptionId,
          eventCreated: claim.eventCreated,
          status: "processing",
          payload: claim.payload,
        });
        return "claimed";
      } catch (err) {
        if (isDuplicateKeyError(err)) return "duplicate";
        throw err;
      }
    },

    async settleEvent(eventId, patch) {
      await db
        .update(stripeWebhookEvents)
        .set({
          status: patch.status,
          holdReason: patch.holdReason ?? null,
          error: patch.error ?? null,
        })
        .where(eq(stripeWebhookEvents.eventId, eventId));
    },

    async hasNewerProcessedSubscriptionEvent(subscriptionId, eventCreated) {
      const rows = await db
        .select({ id: stripeWebhookEvents.id })
        .from(stripeWebhookEvents)
        .where(
          and(
            eq(stripeWebhookEvents.subscriptionId, subscriptionId),
            eq(stripeWebhookEvents.status, "processed"),
            gt(stripeWebhookEvents.eventCreated, eventCreated)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async hasProcessedDeletion(subscriptionId) {
      const rows = await db
        .select({ id: stripeWebhookEvents.id })
        .from(stripeWebhookEvents)
        .where(
          and(
            eq(stripeWebhookEvents.subscriptionId, subscriptionId),
            eq(stripeWebhookEvents.eventType, "customer.subscription.deleted"),
            eq(stripeWebhookEvents.status, "processed")
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async userExists(userId) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows.length > 0;
    },

    async getSubscriptionByUserId(userId) {
      const rows = await db
        .select({
          planId: userSubscriptions.planId,
          status: userSubscriptions.status,
        })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, userId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findUserIdByStripeSubscriptionId(subscriptionId) {
      const rows = await db
        .select({ userId: userSubscriptions.userId })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.stripeSubscriptionId, subscriptionId))
        .orderBy(desc(userSubscriptions.updatedAt))
        .limit(1);
      return rows[0]?.userId ?? null;
    },

    async findUserIdByStripeCustomerId(customerId) {
      const rows = await db
        .select({ userId: userSubscriptions.userId })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.stripeCustomerId, customerId))
        .orderBy(desc(userSubscriptions.updatedAt))
        .limit(1);
      return rows[0]?.userId ?? null;
    },

    async upsertUserSubscription(userId, patch) {
      // userId 有 UNIQUE 約束 → insert...onDuplicateKeyUpdate＝原子 upsert。
      // 只 set 傳入的欄位（部分更新），未傳欄位不動（絕不清空既有值）。
      const insertRow: Record<string, unknown> = { userId, ...patch };
      const updateSet: Record<string, unknown> = { ...patch };
      if (Object.keys(updateSet).length === 0) {
        // 全空 patch：無事可做（防禦性；正常流程不會發生）。
        return;
      }
      await db
        .insert(userSubscriptions)
        .values(insertRow as typeof userSubscriptions.$inferInsert)
        .onDuplicateKeyUpdate({ set: updateSet });
    },

    async postInvoiceCredit({ userId, invoiceId, amountMajor, currency }) {
      // 只入帳不扣款：credit member（貸入使用者）＋ debit stripe:revenue（對手腳），
      // 複式分錄平衡；invoiceId 派生冪等鍵，Stripe 重送同 invoice 不雙重入帳。
      const result = await postTransaction(db as unknown as LedgerDb, {
        fromAccount: STRIPE_REVENUE_ACCOUNT,
        toAccount: makeAccountKey("member", userId),
        amount: amountMajor,
        idempotencyKey: hashIdempotencyKey("stripe-invoice", invoiceId),
        refType: "stripe_invoice",
        refId: invoiceId.slice(0, 128),
        meta: {
          provider: "stripe",
          sourceCurrency: currency,
          costSource: "provider",
        },
      });
      return result.outcome;
    },
  };
}
