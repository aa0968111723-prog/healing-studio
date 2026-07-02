/**
 * stripeFulfillment.test.ts — AIDV-167：Stripe webhook 事件落地服務
 *
 * 涵蓋（窮盡）：
 *  純函式：
 *   - isStripeFulfillmentEnabled 預設 OFF、明確 truthy 才 ON
 *   - parsePricePlanMap 非法 JSON / 非物件 / 非白名單 planId 全部失敗安全
 *   - normalizePlanId 白名單驗證
 *   - mapStripeSubscriptionStatus 已知映射 + 未知 → null（從嚴）
 *   - toMajorUnits 一般幣別 /100、zero-decimal 不除、非法 → 0
 *   - unixToDate / parsePositiveInt / extractPriceIds / extractSubscriptionId
 *  主流程（FakeStore）：
 *   - 未接手事件 → skipped 且不落表
 *   - 缺 data.object → held
 *   - 事件級冪等：同 eventId 重送 → duplicate、只落地一次（重放安全）
 *   - 無 event.id → payload 雜湊衍生鍵，同 payload 重放仍冪等
 *   - handler 拋錯 → failed（settle failed）；重試 re-claim 後可成功（冪等收斂）
 *  checkout.session.completed：
 *   - metadata.userId + metadata.planId → 開通（active + 綁 Stripe id + planId）
 *   - STRIPE_PRICE_PLAN_MAP price 對照 → 開通
 *   - 無法解析 userId → held、不落地
 *   - metadata.userId 指向不存在使用者 → held（不 fallback 錯綁）
 *   - payment_status 非 paid → held、不落地
 *   - 方案無法解析 → 記錄開通但 planId 不動 + held 轉人審
 *  invoice.paid：
 *   - 續期：status=active + currentPeriod 由 lines[0].period 落地
 *   - fallback invoice.period_*
 *   - 只入帳不扣款：ENABLE_COST_LEDGER=ON 才 credit member（invoiceId 冪等）；
 *     OFF / amount_paid=0 → 不入帳；永無 debit 使用者
 *   - 無法解析 userId → held
 *   - 首次由 invoice 建列且方案未解析 → held
 *  invoice.payment_failed：
 *   - 標 past_due（不降級、不扣點）；查無訂閱列 → held
 *  customer.subscription.updated：
 *   - 同步 status / cancelAtPeriodEnd / periods / planId
 *   - 未知 Stripe 狀態 → held、不落地
 *   - 亂序防護：已有更新的 processed 事件 → skipped 不倒退
 *   - terminal：已 processed deleted → skipped
 *   - price 無對照 → 狀態照常同步、方案 held
 *  customer.subscription.deleted：
 *   - 降級落地：cancelled + planId=free + cancelAtPeriodEnd=false
 *   - 查無訂閱列 → processed no-op；無法解析 userId → held
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ── env mock（旗標 / 對照表可逐案調整）──────────────────────────────────────
const { envMock } = vi.hoisted(() => ({
  envMock: {
    STRIPE_FULFILLMENT: "",
    STRIPE_PRICE_PLAN_MAP: "",
  } as Record<string, string>,
}));
vi.mock("../../_core/env.validated", () => ({ serverEnv: envMock }));

// ── 稽核 mock（fire-and-forget，不打 DB）────────────────────────────────────
const { auditMock } = vi.hoisted(() => ({ auditMock: { record: vi.fn() } }));
vi.mock("../audit/auditLog", () => ({
  recordAuditEvent: (...args: unknown[]) => auditMock.record(...args),
}));

import {
  processStripeEvent,
  isStripeFulfillmentEnabled,
  parsePricePlanMap,
  normalizePlanId,
  mapStripeSubscriptionStatus,
  toMajorUnits,
  unixToDate,
  parsePositiveInt,
  extractPriceIds,
  extractSubscriptionId,
  type BillingStore,
  type ClaimOutcome,
  type SettledEventStatus,
  type StripeEventEnvelope,
  type SubscriptionPatch,
  type WebhookEventClaim,
} from "./stripeFulfillment";

// ─── FakeStore：in-memory BillingStore（語義同 drizzle 接線層）───────────────

interface FakeEventRow {
  eventId: string;
  eventType: string;
  subscriptionId: string | null;
  eventCreated: Date | null;
  status: "processing" | SettledEventStatus;
  holdReason: string | null;
  error: string | null;
  attempts: number;
}

interface FakeSubRow {
  userId: number;
  planId: string;
  status: string | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

class FakeStore implements BillingStore {
  events = new Map<string, FakeEventRow>();
  users = new Set<number>();
  subs = new Map<number, FakeSubRow>();
  upsertCalls: Array<{ userId: number; patch: SubscriptionPatch }> = [];
  credits: Array<{ userId: number; invoiceId: string; amountMajor: number; currency: string }> = [];
  /** 模擬 handler 中途 DB 掛掉。 */
  failNextUpsert = false;

  async claimEvent(claim: WebhookEventClaim): Promise<ClaimOutcome> {
    const existing = this.events.get(claim.eventId);
    if (existing) {
      if (existing.status === "failed") {
        existing.status = "processing";
        existing.attempts += 1;
        existing.error = null;
        return "reclaimed";
      }
      return "duplicate";
    }
    this.events.set(claim.eventId, {
      eventId: claim.eventId,
      eventType: claim.eventType,
      subscriptionId: claim.subscriptionId,
      eventCreated: claim.eventCreated,
      status: "processing",
      holdReason: null,
      error: null,
      attempts: 1,
    });
    return "claimed";
  }

  async settleEvent(
    eventId: string,
    patch: { status: SettledEventStatus; holdReason?: string | null; error?: string | null }
  ): Promise<void> {
    const row = this.events.get(eventId);
    if (!row) return;
    row.status = patch.status;
    row.holdReason = patch.holdReason ?? null;
    row.error = patch.error ?? null;
  }

  async hasNewerProcessedSubscriptionEvent(
    subscriptionId: string,
    eventCreated: Date
  ): Promise<boolean> {
    for (const row of this.events.values()) {
      if (
        row.subscriptionId === subscriptionId &&
        row.status === "processed" &&
        row.eventCreated &&
        row.eventCreated.getTime() > eventCreated.getTime()
      ) {
        return true;
      }
    }
    return false;
  }

  async hasProcessedDeletion(subscriptionId: string): Promise<boolean> {
    for (const row of this.events.values()) {
      if (
        row.subscriptionId === subscriptionId &&
        row.eventType === "customer.subscription.deleted" &&
        row.status === "processed"
      ) {
        return true;
      }
    }
    return false;
  }

  async userExists(userId: number): Promise<boolean> {
    return this.users.has(userId);
  }

  async getSubscriptionByUserId(userId: number) {
    const row = this.subs.get(userId);
    return row ? { planId: row.planId, status: row.status } : null;
  }

  async findUserIdByStripeSubscriptionId(subscriptionId: string) {
    for (const row of this.subs.values()) {
      if (row.stripeSubscriptionId === subscriptionId) return row.userId;
    }
    return null;
  }

  async findUserIdByStripeCustomerId(customerId: string) {
    for (const row of this.subs.values()) {
      if (row.stripeCustomerId === customerId) return row.userId;
    }
    return null;
  }

  async upsertUserSubscription(userId: number, patch: SubscriptionPatch) {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("db down (simulated)");
    }
    this.upsertCalls.push({ userId, patch });
    const existing = this.subs.get(userId) ?? {
      userId,
      planId: "free", // DB default
      status: "active", // DB default
    };
    this.subs.set(userId, { ...existing, ...patch });
  }

  async postInvoiceCredit(input: {
    userId: number;
    invoiceId: string;
    amountMajor: number;
    currency: string;
  }): Promise<"inserted" | "duplicate" | "skipped" | "invalid"> {
    if (this.credits.some(c => c.invoiceId === input.invoiceId)) return "duplicate";
    this.credits.push(input);
    return "inserted";
  }
}

// ─── 共用 fixtures ───────────────────────────────────────────────────────────

const NOW_UNIX = Math.floor(Date.now() / 1000);

function checkoutEvent(overrides: {
  id?: string;
  object?: Record<string, unknown>;
}): StripeEventEnvelope {
  return {
    id: overrides.id ?? "evt_checkout_1",
    type: "checkout.session.completed",
    created: NOW_UNIX,
    data: {
      object: {
        id: "cs_1",
        object: "checkout.session",
        customer: "cus_1",
        subscription: "sub_1",
        payment_status: "paid",
        metadata: { userId: "7", planId: "pro" },
        ...overrides.object,
      },
    },
  };
}

function invoiceEvent(overrides: Record<string, unknown> = {}, id = "evt_inv_1"): StripeEventEnvelope {
  return {
    id,
    type: "invoice.paid",
    created: NOW_UNIX,
    data: {
      object: {
        id: "in_1",
        object: "invoice",
        customer: "cus_1",
        subscription: "sub_1",
        amount_paid: 1999,
        currency: "usd",
        lines: {
          data: [
            {
              price: { id: "price_pro" },
              period: { start: NOW_UNIX, end: NOW_UNIX + 30 * 86400 },
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

function subUpdatedEvent(
  overrides: Record<string, unknown> = {},
  opts: { id?: string; created?: number } = {}
): StripeEventEnvelope {
  return {
    id: opts.id ?? "evt_sub_upd_1",
    type: "customer.subscription.updated",
    created: opts.created ?? NOW_UNIX,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        current_period_start: NOW_UNIX,
        current_period_end: NOW_UNIX + 30 * 86400,
        items: { data: [{ price: { id: "price_pro" } }] },
        ...overrides,
      },
    },
  };
}

function subDeletedEvent(overrides: Record<string, unknown> = {}): StripeEventEnvelope {
  return {
    id: "evt_sub_del_1",
    type: "customer.subscription.deleted",
    created: NOW_UNIX,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        customer: "cus_1",
        status: "canceled",
        ...overrides,
      },
    },
  };
}

let store: FakeStore;

beforeEach(() => {
  envMock.STRIPE_FULFILLMENT = "";
  envMock.STRIPE_PRICE_PLAN_MAP = "";
  auditMock.record.mockClear();
  store = new FakeStore();
  store.users.add(7);
  delete process.env.ENABLE_COST_LEDGER;
});

afterEach(() => {
  delete process.env.ENABLE_COST_LEDGER;
});

// ─── 純函式 ──────────────────────────────────────────────────────────────────

describe("純函式：旗標 / 對照表 / 映射 / 金額", () => {
  it("isStripeFulfillmentEnabled：預設（空/未設）OFF", () => {
    envMock.STRIPE_FULFILLMENT = "";
    expect(isStripeFulfillmentEnabled()).toBe(false);
  });

  it.each(["1", "true", "ON", " yes "])("isStripeFulfillmentEnabled('%s') → ON", v => {
    envMock.STRIPE_FULFILLMENT = v;
    expect(isStripeFulfillmentEnabled()).toBe(true);
  });

  it.each(["0", "false", "off", "no", "enabled", "banana"])(
    "isStripeFulfillmentEnabled('%s') → OFF（非明確 truthy 一律 OFF）",
    v => {
      envMock.STRIPE_FULFILLMENT = v;
      expect(isStripeFulfillmentEnabled()).toBe(false);
    }
  );

  it("parsePricePlanMap：合法 JSON 只保留白名單 planId", () => {
    expect(
      parsePricePlanMap('{"price_a":"pro","price_b":"PLATINUM","price_c":" Starter "}')
    ).toEqual({ price_a: "pro", price_c: "starter" });
  });

  it("parsePricePlanMap：非法 JSON / 非物件 / 空 → {}（失敗安全）", () => {
    expect(parsePricePlanMap("{oops")).toEqual({});
    expect(parsePricePlanMap('["pro"]')).toEqual({});
    expect(parsePricePlanMap('"pro"')).toEqual({});
    expect(parsePricePlanMap("")).toEqual({});
    expect(parsePricePlanMap(undefined)).toEqual({});
  });

  it("normalizePlanId：白名單 + trim/lowercase；其外 null", () => {
    expect(normalizePlanId(" PRO ")).toBe("pro");
    expect(normalizePlanId("enterprise")).toBe("enterprise");
    expect(normalizePlanId("gold")).toBeNull();
    expect(normalizePlanId(42)).toBeNull();
    expect(normalizePlanId(undefined)).toBeNull();
  });

  it("mapStripeSubscriptionStatus：已知映射", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("cancelled");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("cancelled");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("cancelled");
  });

  it("mapStripeSubscriptionStatus：未知狀態 → null（從嚴轉人審）", () => {
    expect(mapStripeSubscriptionStatus("incomplete")).toBeNull();
    expect(mapStripeSubscriptionStatus("paused")).toBeNull();
    expect(mapStripeSubscriptionStatus("")).toBeNull();
    expect(mapStripeSubscriptionStatus(123)).toBeNull();
  });

  it("toMajorUnits：一般幣別 /100、zero-decimal 不除、非法 → 0", () => {
    expect(toMajorUnits(1999, "usd")).toBe(19.99);
    expect(toMajorUnits(500, "JPY")).toBe(500);
    expect(toMajorUnits(-100, "usd")).toBe(0);
    expect(toMajorUnits("abc", "usd")).toBe(0);
    expect(toMajorUnits(0, "usd")).toBe(0);
  });

  it("unixToDate / parsePositiveInt 邊界", () => {
    expect(unixToDate(NOW_UNIX)?.getTime()).toBe(NOW_UNIX * 1000);
    expect(unixToDate(-1)).toBeNull();
    expect(unixToDate("nope")).toBeNull();
    expect(parsePositiveInt("42")).toBe(42);
    expect(parsePositiveInt(42)).toBe(42);
    expect(parsePositiveInt("4.2")).toBeNull();
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt("-3")).toBeNull();
    expect(parsePositiveInt("abc")).toBeNull();
  });

  it("extractPriceIds：subscription.items 與 invoice.lines（string / object price）", () => {
    expect(
      extractPriceIds({ items: { data: [{ price: { id: "price_a" } }, { price: "price_b" }] } })
    ).toEqual(["price_a", "price_b"]);
    expect(extractPriceIds({ lines: { data: [{ price: { id: "price_c" } }] } })).toEqual([
      "price_c",
    ]);
    expect(extractPriceIds({})).toEqual([]);
  });

  it("extractSubscriptionId：subscription 物件本身 / 欄位 string / expanded object", () => {
    expect(extractSubscriptionId({ object: "subscription", id: "sub_x" })).toBe("sub_x");
    expect(extractSubscriptionId({ subscription: "sub_y" })).toBe("sub_y");
    expect(extractSubscriptionId({ subscription: { id: "sub_z" } })).toBe("sub_z");
    expect(extractSubscriptionId({ object: "invoice" })).toBeNull();
  });
});

// ─── 主流程：冪等 / 重放 / failed 重試 ───────────────────────────────────────

describe("processStripeEvent：主流程", () => {
  it("未接手的事件類型 → skipped 且不落表", async () => {
    const result = await processStripeEvent(store, {
      id: "evt_x",
      type: "charge.refunded",
      data: { object: { id: "ch_1" } },
    });
    expect(result.outcome).toBe("skipped");
    expect(store.events.size).toBe(0);
  });

  it("缺 data.object → held（凍結轉人審）", async () => {
    const result = await processStripeEvent(store, {
      id: "evt_noobj",
      type: "invoice.paid",
    });
    expect(result).toMatchObject({ outcome: "held" });
    expect(store.events.get("evt_noobj")?.status).toBe("held");
    expect(store.events.get("evt_noobj")?.holdReason).toContain("data.object");
  });

  it("事件級冪等：同 eventId 重送 → duplicate、只落地一次", async () => {
    const evt = checkoutEvent({});
    const first = await processStripeEvent(store, evt);
    expect(first.outcome).toBe("processed");
    const second = await processStripeEvent(store, evt);
    expect(second.outcome).toBe("duplicate");
    expect(store.upsertCalls).toHaveLength(1);
  });

  it("無 event.id → payload 雜湊衍生鍵，同 payload 重放仍冪等", async () => {
    const evt = checkoutEvent({});
    delete (evt as { id?: unknown }).id;
    const first = await processStripeEvent(store, evt);
    expect(first.outcome).toBe("processed");
    const second = await processStripeEvent(store, evt);
    expect(second.outcome).toBe("duplicate");
    expect(store.upsertCalls).toHaveLength(1);
  });

  it("handler 拋錯 → failed（settle failed、回 failed 讓 route 回 5xx）；重試 re-claim 後成功", async () => {
    const evt = checkoutEvent({});
    store.failNextUpsert = true;
    const first = await processStripeEvent(store, evt);
    expect(first.outcome).toBe("failed");
    expect(store.events.get("evt_checkout_1")?.status).toBe("failed");
    expect(store.events.get("evt_checkout_1")?.error).toContain("db down");
    // Stripe 重試（冪等收斂）：re-claim → processed
    const retry = await processStripeEvent(store, evt);
    expect(retry.outcome).toBe("processed");
    expect(store.events.get("evt_checkout_1")?.status).toBe("processed");
    expect(store.events.get("evt_checkout_1")?.attempts).toBe(2);
  });

  it("每顆已 claim 事件都留下稽核軌跡（AIDV-123）", async () => {
    await processStripeEvent(store, checkoutEvent({}));
    expect(auditMock.record).toHaveBeenCalledTimes(1);
    const call = auditMock.record.mock.calls[0][0] as Record<string, unknown>;
    expect(call.action).toBe("billing.stripe.checkout.session.completed");
    expect(call.result).toBe("success");
  });
});

// ─── checkout.session.completed ──────────────────────────────────────────────

describe("checkout.session.completed（開通）", () => {
  it("metadata.userId + metadata.planId → 開通：active + Stripe id 綁定 + planId", async () => {
    const result = await processStripeEvent(store, checkoutEvent({}));
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.subs.get(7)).toMatchObject({
      planId: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(store.events.get("evt_checkout_1")?.status).toBe("processed");
  });

  it("metadata 無 planId 但 STRIPE_PRICE_PLAN_MAP 對照 lines price → 開通", async () => {
    envMock.STRIPE_PRICE_PLAN_MAP = '{"price_starter":"starter"}';
    const result = await processStripeEvent(
      store,
      checkoutEvent({
        object: {
          metadata: { userId: "7" },
          lines: { data: [{ price: { id: "price_starter" } }] },
        },
      })
    );
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.subs.get(7)?.planId).toBe("starter");
  });

  it("無法解析 userId → held、完全不落地", async () => {
    const result = await processStripeEvent(
      store,
      checkoutEvent({ object: { metadata: {}, customer: "cus_unknown", subscription: null } })
    );
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
    expect(store.events.get("evt_checkout_1")?.status).toBe("held");
  });

  it("metadata.userId 指向不存在使用者 → held（權威來源不 fallback，防錯綁）", async () => {
    // cus_1 其實對應既有使用者 7，但 metadata 說 999 → 從嚴 held 而非錯綁到 7
    store.subs.set(7, { userId: 7, planId: "free", status: "active", stripeCustomerId: "cus_1" });
    const result = await processStripeEvent(
      store,
      checkoutEvent({ object: { metadata: { userId: "999", planId: "pro" } } })
    );
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("payment_status=unpaid（非同步付款未完成）→ held、不開通", async () => {
    const result = await processStripeEvent(
      store,
      checkoutEvent({ object: { payment_status: "unpaid" } })
    );
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("client_reference_id 可作 userId 來源（無 metadata 時）", async () => {
    const result = await processStripeEvent(
      store,
      checkoutEvent({ object: { metadata: { planId: "pro" }, client_reference_id: "7" } })
    );
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
  });

  it("方案無法解析 → 記錄開通（active + Stripe id）但 planId 不動 + held 轉人審", async () => {
    const result = await processStripeEvent(
      store,
      checkoutEvent({
        object: {
          metadata: { userId: "7" },
          lines: { data: [{ price: { id: "price_unmapped" } }] },
        },
      })
    );
    expect(result).toMatchObject({ outcome: "held", userId: 7 });
    expect(store.upsertCalls).toHaveLength(1);
    // patch 不含 planId（不猜方案），只綁 id + active
    expect(store.upsertCalls[0].patch).toEqual({
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(store.events.get("evt_checkout_1")?.holdReason).toContain("人審");
  });
});

// ─── invoice.paid ────────────────────────────────────────────────────────────

describe("invoice.paid（續期 + 只入帳不扣款）", () => {
  beforeEach(() => {
    // 既有訂閱列（先前 checkout 開通過）
    store.subs.set(7, {
      userId: 7,
      planId: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("續期：由 stripeSubscriptionId 反查 user，status=active + period 由 lines[0].period 落地", async () => {
    const result = await processStripeEvent(store, invoiceEvent());
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    const sub = store.subs.get(7)!;
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodStart?.getTime()).toBe(NOW_UNIX * 1000);
    expect(sub.currentPeriodEnd?.getTime()).toBe((NOW_UNIX + 30 * 86400) * 1000);
  });

  it("lines 無 period → fallback invoice.period_*", async () => {
    const result = await processStripeEvent(
      store,
      invoiceEvent({
        lines: { data: [{ price: { id: "price_pro" } }] },
        period_start: NOW_UNIX - 100,
        period_end: NOW_UNIX + 100,
      })
    );
    expect(result.outcome).toBe("processed");
    expect(store.subs.get(7)?.currentPeriodStart?.getTime()).toBe((NOW_UNIX - 100) * 1000);
    expect(store.subs.get(7)?.currentPeriodEnd?.getTime()).toBe((NOW_UNIX + 100) * 1000);
  });

  it("只入帳不扣款：ENABLE_COST_LEDGER=ON → credit member（金額換算主單位）", async () => {
    process.env.ENABLE_COST_LEDGER = "true";
    const result = await processStripeEvent(store, invoiceEvent());
    expect(result.outcome).toBe("processed");
    expect(store.credits).toEqual([
      { userId: 7, invoiceId: "in_1", amountMajor: 19.99, currency: "USD" },
    ]);
  });

  it("帳本冪等：同 invoice 兩顆不同事件 id → 第二次 credit duplicate、不雙重入帳", async () => {
    process.env.ENABLE_COST_LEDGER = "true";
    await processStripeEvent(store, invoiceEvent({}, "evt_inv_1"));
    const second = await processStripeEvent(store, invoiceEvent({}, "evt_inv_2"));
    expect(second.outcome).toBe("processed");
    expect(store.credits).toHaveLength(1); // invoiceId 冪等
  });

  it("ENABLE_COST_LEDGER 預設 OFF → 不入帳（零帳本行為變化）", async () => {
    const result = await processStripeEvent(store, invoiceEvent());
    expect(result.outcome).toBe("processed");
    expect(store.credits).toHaveLength(0);
  });

  it("amount_paid=0（試用期）→ 不入帳、續期照常", async () => {
    process.env.ENABLE_COST_LEDGER = "true";
    const result = await processStripeEvent(store, invoiceEvent({ amount_paid: 0 }));
    expect(result.outcome).toBe("processed");
    expect(store.credits).toHaveLength(0);
  });

  it("無法解析 userId → held、不落地不入帳", async () => {
    store.subs.clear();
    process.env.ENABLE_COST_LEDGER = "true";
    const result = await processStripeEvent(store, invoiceEvent());
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
    expect(store.credits).toHaveLength(0);
  });

  it("首次由 invoice 建立訂閱列且方案未解析 → held 轉人審（續期資訊仍寫入）", async () => {
    store.subs.clear();
    const result = await processStripeEvent(
      store,
      invoiceEvent({
        metadata: { userId: "7" },
        lines: { data: [{ price: { id: "price_unmapped" }, period: { start: NOW_UNIX, end: NOW_UNIX + 86400 } }] },
      })
    );
    expect(result).toMatchObject({ outcome: "held", userId: 7 });
    expect(store.upsertCalls).toHaveLength(1);
    expect(store.upsertCalls[0].patch.planId).toBeUndefined();
  });

  it("既有訂閱列（方案已知）續期，price 未對照也不 held（方案不變即可）", async () => {
    const result = await processStripeEvent(
      store,
      invoiceEvent({ lines: { data: [{ price: { id: "price_unmapped" }, period: { start: NOW_UNIX, end: NOW_UNIX + 86400 } }] } })
    );
    expect(result.outcome).toBe("processed");
    expect(store.subs.get(7)?.planId).toBe("pro"); // 不動
  });
});

// ─── invoice.payment_failed ──────────────────────────────────────────────────

describe("invoice.payment_failed（催繳標記）", () => {
  it("標 past_due：不降級 planId、不扣點、不入帳", async () => {
    store.subs.set(7, {
      userId: 7,
      planId: "pro",
      status: "active",
      stripeSubscriptionId: "sub_1",
    });
    const result = await processStripeEvent(store, {
      id: "evt_pf_1",
      type: "invoice.payment_failed",
      created: NOW_UNIX,
      data: { object: { id: "in_2", subscription: "sub_1", attempt_count: 2 } },
    });
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.subs.get(7)).toMatchObject({ planId: "pro", status: "past_due" });
    expect(store.credits).toHaveLength(0);
  });

  it("查無訂閱列 → held（不無中生有）", async () => {
    store.users.add(9);
    const result = await processStripeEvent(store, {
      id: "evt_pf_2",
      type: "invoice.payment_failed",
      created: NOW_UNIX,
      data: { object: { id: "in_3", metadata: { userId: "9" } } },
    });
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
  });
});

// ─── customer.subscription.updated ───────────────────────────────────────────

describe("customer.subscription.updated（同步 / 亂序防護）", () => {
  beforeEach(() => {
    store.subs.set(7, {
      userId: 7,
      planId: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    envMock.STRIPE_PRICE_PLAN_MAP = '{"price_pro":"pro","price_ent":"enterprise"}';
  });

  it("同步 status / cancelAtPeriodEnd / periods / planId", async () => {
    const result = await processStripeEvent(
      store,
      subUpdatedEvent({ status: "past_due", cancel_at_period_end: true })
    );
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.subs.get(7)).toMatchObject({
      status: "past_due",
      cancelAtPeriodEnd: true,
      planId: "pro",
    });
    expect(store.subs.get(7)?.currentPeriodEnd?.getTime()).toBe((NOW_UNIX + 30 * 86400) * 1000);
  });

  it("升級：price 對照到 enterprise → planId 落地", async () => {
    const result = await processStripeEvent(
      store,
      subUpdatedEvent({ items: { data: [{ price: { id: "price_ent" } }] } })
    );
    expect(result.outcome).toBe("processed");
    expect(store.subs.get(7)?.planId).toBe("enterprise");
  });

  it("Stripe status=canceled → 映射 cancelled", async () => {
    const result = await processStripeEvent(store, subUpdatedEvent({ status: "canceled" }));
    expect(result.outcome).toBe("processed");
    expect(store.subs.get(7)?.status).toBe("cancelled");
  });

  it("未知 Stripe 狀態（incomplete）→ held、不落地（從嚴）", async () => {
    const result = await processStripeEvent(store, subUpdatedEvent({ status: "incomplete" }));
    expect(result).toMatchObject({ outcome: "held", userId: 7 });
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("亂序防護：已 processed 更新的事件 → 舊事件 skipped、不倒退狀態", async () => {
    // 先處理較新的事件（cancel_at_period_end=true）
    const newer = subUpdatedEvent(
      { cancel_at_period_end: true },
      { id: "evt_newer", created: NOW_UNIX + 100 }
    );
    await processStripeEvent(store, newer);
    expect(store.subs.get(7)?.cancelAtPeriodEnd).toBe(true);
    // 再收到較舊的事件（cancel_at_period_end=false）→ skipped
    const older = subUpdatedEvent(
      { cancel_at_period_end: false },
      { id: "evt_older", created: NOW_UNIX - 100 }
    );
    const result = await processStripeEvent(store, older);
    expect(result.outcome).toBe("skipped");
    expect(store.subs.get(7)?.cancelAtPeriodEnd).toBe(true); // 未倒退
    expect(store.events.get("evt_older")?.status).toBe("skipped");
  });

  it("terminal：已 processed deleted → 後到的 updated 一律 skipped", async () => {
    await processStripeEvent(store, subDeletedEvent());
    const result = await processStripeEvent(
      store,
      subUpdatedEvent({}, { id: "evt_late_upd", created: NOW_UNIX - 500 })
    );
    expect(result.outcome).toBe("skipped");
    expect(store.subs.get(7)?.status).toBe("cancelled"); // 維持已刪除的降級
  });

  it("price 無對照（方案變更不明）→ 狀態照常同步、方案 held 轉人審", async () => {
    const result = await processStripeEvent(
      store,
      subUpdatedEvent({ status: "active", items: { data: [{ price: { id: "price_mystery" } }] } })
    );
    expect(result).toMatchObject({ outcome: "held", userId: 7 });
    expect(store.subs.get(7)?.status).toBe("active"); // 狀態有同步
    expect(store.subs.get(7)?.planId).toBe("pro"); // 方案不猜
  });

  it("無法解析 userId → held", async () => {
    store.subs.clear();
    const result = await processStripeEvent(store, subUpdatedEvent());
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────────────

describe("customer.subscription.deleted（降級落地）", () => {
  it("降級：status=cancelled + planId=free + cancelAtPeriodEnd=false", async () => {
    store.subs.set(7, {
      userId: 7,
      planId: "pro",
      status: "active",
      stripeSubscriptionId: "sub_1",
      cancelAtPeriodEnd: true,
    });
    const result = await processStripeEvent(store, subDeletedEvent());
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.subs.get(7)).toMatchObject({
      status: "cancelled",
      planId: "free",
      cancelAtPeriodEnd: false,
    });
  });

  it("重放（同事件重送）→ duplicate、降級只落地一次", async () => {
    store.subs.set(7, {
      userId: 7,
      planId: "pro",
      status: "active",
      stripeSubscriptionId: "sub_1",
    });
    await processStripeEvent(store, subDeletedEvent());
    const second = await processStripeEvent(store, subDeletedEvent());
    expect(second.outcome).toBe("duplicate");
    expect(store.upsertCalls).toHaveLength(1);
  });

  it("查無訂閱列 → processed no-op（本來就無權益可降）", async () => {
    const result = await processStripeEvent(
      store,
      subDeletedEvent({ metadata: { userId: "7" } })
    );
    expect(result).toMatchObject({ outcome: "processed", userId: 7 });
    expect(store.upsertCalls).toHaveLength(0);
  });

  it("無法解析 userId → held", async () => {
    const result = await processStripeEvent(store, subDeletedEvent());
    expect(result.outcome).toBe("held");
    expect(store.upsertCalls).toHaveLength(0);
  });
});
