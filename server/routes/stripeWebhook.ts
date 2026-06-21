/**
 * stripeWebhook.ts — Stripe 支付 Webhook 端點
 * POST /api/webhooks/stripe
 *
 * AIDV-159：簽章驗證已從骨架（永遠 return true）改為真正的 HMAC-SHA256 驗證。
 * 事件處理器（handlers）目前仍是 console.log stub，待接 entitlement 時完善。
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { serverEnv } from "../_core/env.validated";

export const stripeWebhookRouter = Router();

// ─── Stripe 簽章驗證（AIDV-159：真 HMAC-SHA256，不引入 stripe 套件）────────────
//
// Stripe-Signature 標頭格式：`t=<unix秒>,v1=<hex簽章>[,v1=<另一把>...]`
//   signedPayload = `${t}.${rawBody}`
//   v1            = HMAC-SHA256(signedPayload, STRIPE_WEBHOOK_SECRET) 的 hex
// 用 Node 內建 crypto 自行計算（無需 stripe SDK），並做：
//   1) 時間戳容差（replay 保護）：|now - t| > 300s 即拒絕。
//   2) timingSafeEqual 比對任一 v1（Stripe 在 secret 輪替期會同時送多把 v1）。
//
// 重要：必須用 req.rawBody（_core/index.ts express.json 的 verify 鉤子保留的原始
// 位元組）— Stripe 簽的是原始 payload bytes，重新 JSON.stringify(req.body) 會因鍵序
// / 空白差異導致 HMAC 不符。比照 webhookFal.ts 既有作法（router 掛在全域 json
// parser 之後，故 req.rawBody 一定已被保留，不需要 express.raw）。

/** Stripe 預設時間戳容差（秒）。比照官方 SDK 的 DEFAULT_TOLERANCE = 300。 */
const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** 「明確關閉」值（"0"/"false"/"off"/"no"，含大小寫與前後空白）。 */
function isExplicitlyFalsy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

/** 「明確開啟」值（"1"/"true"/"on"/"yes"，含大小寫與前後空白）。 */
function isExplicitlyTruthy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * AIDV-159：STRIPE_WEBHOOK_SECRET 未設定時是否 fail-closed（拒絕 webhook）。
 * 比照 CONTENT_SAFETY_FAIL_CLOSED 的設計，但**只**管「密鑰留空」這個情境；
 * 密鑰有設時簽章不符一律拒絕，與本旗標無關。
 *  - 明確 "false"/"0"/"off"/"no" → fail-open（緊急回退，明確人工決定；連 prod 也放行骨架）。
 *  - 明確 "true"/"1"/"on"/"yes"  → 一律 fail-closed（連 dev 也拒絕，方便 staging 演練）。
 *  - 留空／未設（預設）→ 只有 production fail-closed；dev/test 放行骨架，避免擋住本機開發。
 */
function isStripeWebhookFailClosed(): boolean {
  const raw = serverEnv.STRIPE_WEBHOOK_FAIL_CLOSED;
  if (isExplicitlyFalsy(raw)) return false;
  if (isExplicitlyTruthy(raw)) return true;
  return serverEnv.NODE_ENV === "production";
}

type StripeVerifyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/** 解析 Stripe-Signature 標頭，取出 t 與所有 v1。 */
function parseStripeSignatureHeader(header: string): {
  timestamp: number | null;
  v1: string[];
} {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === "v1" && value) {
      v1.push(value);
    }
  }
  return { timestamp, v1 };
}

/**
 * 驗證 Stripe-Signature。回傳 discriminated result：
 *   { ok:true }                  → 通過（或 dev fail-open 骨架跳過）
 *   { ok:false, status, reason } → 拒絕；status 為要回的 HTTP code（400 簽章問題 / 503 未設定密鑰）
 *
 * 失敗時呼叫端必須回對應 status 且**不**觸發任何事件處理器。
 */
function verifyStripeSignature(req: Request): StripeVerifyResult {
  const secret = serverEnv.STRIPE_WEBHOOK_SECRET;

  // ── 密鑰未設定 ──
  if (!secret) {
    if (isStripeWebhookFailClosed()) {
      // production（或明確要求）下拒絕未驗證 webhook，避免偽造 payload 觸發 handler。
      return {
        ok: false,
        status: 503,
        reason:
          "STRIPE_WEBHOOK_SECRET 未設定（fail-closed），拒絕未驗證的 webhook",
      };
    }
    console.warn(
      "[StripeWebhook] ⚠️  STRIPE_WEBHOOK_SECRET 未設定，跳過簽章驗證（僅開發/骨架模式，fail-open）。"
    );
    return { ok: true };
  }

  // ── 密鑰已設定：一律執行真實 HMAC 驗證 ──
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || signature.length === 0) {
    return { ok: false, status: 400, reason: "缺少 Stripe-Signature 標頭" };
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || rawBody.length === 0) {
    return { ok: false, status: 400, reason: "缺少原始請求內容（rawBody）" };
  }

  const { timestamp, v1 } = parseStripeSignatureHeader(signature);
  if (timestamp === null || v1.length === 0) {
    return { ok: false, status: 400, reason: "Stripe-Signature 標頭格式錯誤" };
  }

  // 時間戳容差（replay 保護）：拒絕過舊或時鐘偏移過大的 payload。
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > STRIPE_TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      ok: false,
      status: 400,
      reason: `時間戳超出容差（±${STRIPE_TIMESTAMP_TOLERANCE_SECONDS}s）`,
    };
  }

  // 計算 HMAC-SHA256 over `${t}.${rawBody}`（注意 rawBody 接在 "t." 之後的原始位元組）。
  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]))
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  // 任一 v1 timing-safe 相符即通過。長度不同先短路，避免 timingSafeEqual 因長度不一 throw。
  const matched = v1.some(candidate => {
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(candidateBuf, expectedBuf);
  });

  if (!matched) {
    return { ok: false, status: 400, reason: "簽章不符" };
  }

  return { ok: true };
}

// ─── 事件處理器（骨架）────────────────────────────────────────────────────────

/**
 * 處理 checkout.session.completed
 * 觸發時機：Checkout Session 付款成功
 * TODO: 建立 userSubscriptions 記錄、發送歡迎郵件、解鎖功能
 */
function handleCheckoutSessionCompleted(
  session: Record<string, unknown>
): void {
  console.log(
    "[StripeWebhook] 📦 checkout.session.completed — sessionId:",
    session.id,
    "| customerId:",
    session.customer,
    "| subscriptionId:",
    session.subscription
  );
  // TODO: 實作訂閱開通邏輯
}

/**
 * 處理 invoice.paid
 * 觸發時機：發票付款成功（每月續訂）
 * TODO: 更新 userSubscriptions.currentPeriodEnd、記錄付款歷史
 */
function handleInvoicePaid(invoice: Record<string, unknown>): void {
  console.log(
    "[StripeWebhook] 💳 invoice.paid — invoiceId:",
    invoice.id,
    "| customerId:",
    invoice.customer,
    "| subscriptionId:",
    invoice.subscription,
    "| amountPaid:",
    invoice.amount_paid
  );
  // TODO: 實作續訂成功邏輯
}

/**
 * 處理 invoice.payment_failed
 * 觸發時機：發票付款失敗
 * TODO: 將 userSubscriptions.status 設為 past_due、發送催繳通知
 */
function handleInvoicePaymentFailed(invoice: Record<string, unknown>): void {
  console.warn(
    "[StripeWebhook] ⚠️  invoice.payment_failed — invoiceId:",
    invoice.id,
    "| customerId:",
    invoice.customer,
    "| subscriptionId:",
    invoice.subscription,
    "| attemptCount:",
    invoice.attempt_count
  );
  // TODO: 實作付款失敗處理邏輯
}

/**
 * 處理 customer.subscription.updated
 * 觸發時機：訂閱變更（升降級、取消排程等）
 * TODO: 同步 userSubscriptions 的 planId / status / cancelAtPeriodEnd
 */
function handleSubscriptionUpdated(
  subscription: Record<string, unknown>
): void {
  console.log(
    "[StripeWebhook] 🔄 customer.subscription.updated — subscriptionId:",
    subscription.id,
    "| customerId:",
    subscription.customer,
    "| status:",
    subscription.status,
    "| cancelAtPeriodEnd:",
    subscription.cancel_at_period_end
  );
  // TODO: 實作訂閱更新同步邏輯
}

/**
 * 處理 customer.subscription.deleted
 * 觸發時機：訂閱已取消且到期
 * TODO: 將 userSubscriptions.status 設為 cancelled、降回 free plan
 */
function handleSubscriptionDeleted(
  subscription: Record<string, unknown>
): void {
  console.log(
    "[StripeWebhook] 🗑️  customer.subscription.deleted — subscriptionId:",
    subscription.id,
    "| customerId:",
    subscription.customer
  );
  // TODO: 實作訂閱取消處理邏輯
}

// ─── POST /api/webhooks/stripe ─────────────────────────────────────────────

stripeWebhookRouter.post(
  "/api/webhooks/stripe",
  // 注意：Stripe 簽章驗證需要原始 raw body。本服務在 _core/index.ts 的全域
  // express.json({ verify }) 鉤子已把原始位元組保留在 req.rawBody，故此處直接沿用
  // req.rawBody 計算 HMAC（比照 webhookFal / webhookReplicate），不需要 express.raw
  // ——若改掛 express.raw 反而會與全域 json parser 衝突（body stream 已被消耗）。
  async (req: Request, res: Response) => {
    // 1. 先驗證簽章。失敗則回對應狀態碼且**不**觸發任何事件處理器。
    const verdict = verifyStripeSignature(req);
    if (!verdict.ok) {
      console.warn(
        `[StripeWebhook] ❌ 簽章驗證失敗（${verdict.reason}），回 ${verdict.status}，不處理 payload。`
      );
      // 回非 2xx，讓 Stripe／監控看得到拒絕（Stripe 會視為失敗並重試/告警）。
      res.status(verdict.status).json({ error: "Webhook 簽章驗證失敗" });
      return;
    }

    // 2. 驗證通過才回 200（Stripe 收到 2xx 即視為已接收，不再重試）。
    res.status(200).json({ received: true });

    try {
      const event = req.body as {
        id?: string;
        type?: string;
        data?: { object?: Record<string, unknown> };
      };

      console.log(
        `[StripeWebhook] 📨 Received event: type=${event.type}, id=${event.id}`
      );

      const eventObject = event.data?.object ?? {};

      // 3. 依事件類型分派處理器
      switch (event.type) {
        case "checkout.session.completed":
          handleCheckoutSessionCompleted(eventObject);
          break;

        case "invoice.paid":
          handleInvoicePaid(eventObject);
          break;

        case "invoice.payment_failed":
          handleInvoicePaymentFailed(eventObject);
          break;

        case "customer.subscription.updated":
          handleSubscriptionUpdated(eventObject);
          break;

        case "customer.subscription.deleted":
          handleSubscriptionDeleted(eventObject);
          break;

        default:
          console.log(
            `[StripeWebhook] ℹ️  未處理的事件類型：${event.type}（已接收，略過）`
          );
      }
    } catch (err) {
      console.error("[StripeWebhook] ❌ 處理 Webhook 時發生錯誤:", err);
    }
  }
);
