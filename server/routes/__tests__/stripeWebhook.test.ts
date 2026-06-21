/**
 * stripeWebhook.test.ts — AIDV-159：Stripe webhook 真 HMAC 簽章驗證
 *
 * 涵蓋（完成定義：偽造 payload 在驗證失敗時回 4xx 且不觸發任何 handler；密鑰未設時 prod 拒絕）：
 *  - 密鑰已設 + 正確簽章 → 200，且事件 handler 被觸發
 *  - 密鑰已設 + 偽造簽章 → 400，handler 不觸發
 *  - 密鑰已設 + 缺 Stripe-Signature 標頭 → 400，handler 不觸發
 *  - 密鑰已設 + 時間戳過舊（replay）→ 400，handler 不觸發
 *  - 密鑰未設 + production（預設 fail-closed）→ 503，handler 不觸發
 *  - 密鑰未設 + dev（預設 fail-open 骨架）→ 200，handler 觸發
 *  - 密鑰未設 + 明確 FAIL_CLOSED=true（即使 dev）→ 503
 *  - 密鑰未設 + 明確 FAIL_CLOSED=false（即使 prod）→ 200 骨架
 */

import express from "express";
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── 以可變 mock 取代 env.validated（逐案改 secret / fail-closed / NODE_ENV）──
const { envMock } = vi.hoisted(() => ({
  envMock: {
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_WEBHOOK_FAIL_CLOSED: "",
    NODE_ENV: "test",
  } as {
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_WEBHOOK_FAIL_CLOSED: string;
    NODE_ENV: string;
  },
}));

vi.mock("../../_core/env.validated", () => ({
  serverEnv: envMock,
}));

import { stripeWebhookRouter } from "../stripeWebhook";

const TEST_SECRET = "whsec_test_secret_abc123";

/** 起一個會保留 req.rawBody 的測試 server（比照 _core/index.ts 的 verify 鉤子）。 */
async function startTestServer() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if (buf && buf.length) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    })
  );
  app.use(stripeWebhookRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

/** 用 secret 對 `${t}.${rawBody}` 算 HMAC，組出 Stripe-Signature 標頭。 */
function signStripePayload(
  rawBody: string,
  secret: string,
  timestamp: number
): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const SAMPLE_EVENT = {
  id: "evt_test_123",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", customer: "cus_1", subscription: "sub_1" } },
};

describe("stripeWebhook /api/webhooks/stripe — AIDV-159 簽章驗證", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envMock.STRIPE_WEBHOOK_SECRET = "";
    envMock.STRIPE_WEBHOOK_FAIL_CLOSED = "";
    envMock.NODE_ENV = "test";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  /** handler 是否被觸發 —「📨 Received event」只在驗證通過、進入分派時印出。 */
  function handlerWasInvoked(): boolean {
    return logSpy.mock.calls.some(
      args => typeof args[0] === "string" && args[0].includes("📨 Received event")
    );
  }

  it("密鑰已設 + 正確簽章 → 200，handler 觸發（checkout.session.completed）", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify(SAMPLE_EVENT);
    const sigHeader = signStripePayload(body, TEST_SECRET, nowSeconds());
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sigHeader },
      body,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(true);
    // checkout.session.completed handler 的 stub log
    expect(
      logSpy.mock.calls.some(
        args =>
          typeof args[0] === "string" &&
          args[0].includes("checkout.session.completed")
      )
    ).toBe(true);
    server.close();
  });

  it("密鑰已設 + 偽造簽章 → 400，handler 不觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify(SAMPLE_EVENT);
    // 用錯誤的 secret 簽 → v1 不符
    const forged = signStripePayload(body, "whsec_wrong_secret", nowSeconds());
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": forged },
      body,
    });

    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰已設 + 竄改 body（簽章對不上新 body）→ 400，handler 不觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const originalBody = JSON.stringify(SAMPLE_EVENT);
    const sigHeader = signStripePayload(originalBody, TEST_SECRET, nowSeconds());
    // 送出被竄改過的 body，但帶原本 body 的簽章
    const tamperedBody = JSON.stringify({ ...SAMPLE_EVENT, id: "evt_tampered" });
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sigHeader },
      body: tamperedBody,
    });

    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰已設 + 缺 Stripe-Signature 標頭 → 400，handler 不觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify(SAMPLE_EVENT);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰已設 + 時間戳過舊（replay）→ 400，handler 不觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify(SAMPLE_EVENT);
    // 簽章本身正確，但時間戳是 10 分鐘前（> 300s 容差）
    const staleTs = nowSeconds() - 600;
    const sigHeader = signStripePayload(body, TEST_SECRET, staleTs);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sigHeader },
      body,
    });

    expect(res.status).toBe(400);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰未設 + production（預設 fail-closed）→ 503，handler 不觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = "";
    envMock.NODE_ENV = "production";
    const body = JSON.stringify(SAMPLE_EVENT);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(res.status).toBe(503);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰未設 + dev（預設 fail-open 骨架）→ 200，handler 觸發", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = "";
    envMock.NODE_ENV = "development";
    const body = JSON.stringify(SAMPLE_EVENT);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(true);
    server.close();
  });

  it("密鑰未設 + 明確 FAIL_CLOSED=true（即使 dev）→ 503", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = "";
    envMock.NODE_ENV = "development";
    envMock.STRIPE_WEBHOOK_FAIL_CLOSED = "true";
    const body = JSON.stringify(SAMPLE_EVENT);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(res.status).toBe(503);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(false);
    server.close();
  });

  it("密鑰未設 + 明確 FAIL_CLOSED=false（即使 prod）→ 200 骨架放行", async () => {
    envMock.STRIPE_WEBHOOK_SECRET = "";
    envMock.NODE_ENV = "production";
    envMock.STRIPE_WEBHOOK_FAIL_CLOSED = "false";
    const body = JSON.stringify(SAMPLE_EVENT);
    const { server, baseUrl } = await startTestServer();

    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(handlerWasInvoked()).toBe(true);
    server.close();
  });
});
