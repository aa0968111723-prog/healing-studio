/**
 * stripeWebhook.ts — Stripe 支付 Webhook 端點骨架
 * POST /api/webhooks/stripe
 * 目前為骨架實作，功能待 Stripe 整合時完善
 */

import { Router, Request, Response } from "express";
import { serverEnv } from "../_core/env.validated";

export const stripeWebhookRouter = Router();

// ─── Stripe Signature 驗證（骨架）────────────────────────────────────────────

/**
 * 驗證 Stripe-Signature header。
 * 若 STRIPE_WEBHOOK_SECRET 未設定，log 警告並跳過驗證。
 * TODO: 整合 Stripe 時使用 stripe.webhooks.constructEvent() 取代此骨架。
 *
 * 重要：完善時務必使用 req.rawBody（由 _core/index.ts 的 express.json verify
 * 鉤子保留的原始位元組）— Stripe 簽名是基於原始 payload bytes，不可重新
 * stringify 已 parse 過的 req.body。
 */
function verifyStripeSignature(req: Request): boolean {
  const secret = serverEnv.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn(
      "[StripeWebhook] ⚠️  STRIPE_WEBHOOK_SECRET 未設定，跳過簽名驗證（僅開發/骨架模式）。"
    );
    return true; // 骨架模式：無 secret 時視為通過
  }

  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    console.warn("[StripeWebhook] ❌ 缺少 Stripe-Signature header。");
    return false;
  }

  // TODO: 完善時改為 stripe.webhooks.constructEvent(req.rawBody, signature, secret)
  // const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  // 目前骨架僅檢查 header 存在性
  console.log(
    "[StripeWebhook] ℹ️  Stripe-Signature header 存在（骨架模式，未執行 HMAC 驗證）。"
  );
  return true;
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
  // 注意：Stripe Webhook 需要原始 raw body 來驗證簽名。
  // 完善時應在此路由前使用 express.raw({ type: "application/json" })
  // 目前骨架模式使用 express.json()（已在全域設定）。
  async (req: Request, res: Response) => {
    // 1. 立即回 200，避免 Stripe 重試
    res.status(200).json({ received: true });

    try {
      // 2. 簽名驗證
      if (!verifyStripeSignature(req)) {
        console.warn(
          "[StripeWebhook] ❌ 簽名驗證失敗，忽略此 payload。"
        );
        return;
      }

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
