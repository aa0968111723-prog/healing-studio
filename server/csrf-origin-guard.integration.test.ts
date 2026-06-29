/**
 * csrf-origin-guard.integration.test.ts — AIDV-558 端到端接線測試
 *
 * 單元測試（csrf-origin-guard.test.ts）直接驗中介層邏輯，但不驗「實際 app.use 接線、
 * 掛載順序、以及真實 Express 下 req.path 是否為未被 router 截斷的完整路徑」。
 * 本檔用與 local-auth.test.ts 相同的「起真 express server＋fetch」手法補上這道缺口：
 * 確認 createCsrfOriginGuard() 真的掛在 route handler 之前、且排除邏輯看到完整路徑。
 */
import express from "express";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import { createCsrfOriginGuard } from "./_core/csrfOriginGuard";

const COOKIE = `${COOKIE_NAME}=session-token-abc`;

let closeServer: (() => Promise<void>) | null = null;
let savedNodeEnv: string | undefined;

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

async function startTestServer(): Promise<string> {
  // guard 在 NODE_ENV=test 時不套用；端到端測試需在啟用狀態下驗證。
  savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(createCsrfOriginGuard());
  // 受保護的 cookie 認證變更路由
  app.post("/api/oauth/logout", (_req, res) => res.json({ ok: true, route: "logout" }));
  app.post("/api/auth/2fa/setup", (_req, res) => res.json({ ok: true, route: "2fa" }));
  // 排除路由（webhook，自驗簽）
  app.post("/api/webhook/fal", (_req, res) => res.json({ ok: true, route: "webhook" }));
  // 同前綴但非真排除路徑——必須仍受保護
  app.post("/api/webhooks-config", (_req, res) => res.json({ ok: true, route: "config" }));

  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  closeServer = () => new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

describe("AIDV-558 CSRF guard 端到端接線", () => {
  it("I1: 跨站 form-POST /api/oauth/logout（帶受害者 cookie）→ 403", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/oauth/logout`, {
      method: "POST",
      headers: { origin: "https://evil.com", cookie: COOKIE },
    });
    expect(res.status).toBe(403);
  });

  it("I2: 同源 POST /api/oauth/logout（帶 cookie）→ 200（合法流程不被誤殺）", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/oauth/logout`, {
      method: "POST",
      headers: { origin: base, cookie: COOKIE }, // base 即 http://127.0.0.1:<port> = self origin
    });
    expect(res.status).toBe(200);
  });

  it("I3: 無 cookie 的跨站 POST → 放行（無從被 CSRF 冒充）", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/oauth/logout`, {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    expect(res.status).toBe(200);
  });

  it("I4: 排除路徑 /api/webhook/fal 跨站＋cookie → 不被本 guard 攔（200）", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/webhook/fal`, {
      method: "POST",
      headers: { origin: "https://evil.com", cookie: COOKIE },
    });
    expect(res.status).toBe(200);
  });

  it("I5: 同前綴假排除路徑 /api/webhooks-config 跨站＋cookie → 仍 403（路段邊界）", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/webhooks-config`, {
      method: "POST",
      headers: { origin: "https://evil.com", cookie: COOKIE },
    });
    expect(res.status).toBe(403);
  });

  it("I6: 安全方法 GET 不受影響（即便跨站＋cookie）", async () => {
    const base = await startTestServer();
    // 無對應 GET handler → 404（重點是「不是 403」，代表 guard 放行進了路由層）
    const res = await fetch(`${base}/api/oauth/logout`, {
      method: "GET",
      headers: { origin: "https://evil.com", cookie: COOKIE },
    });
    expect(res.status).toBe(404);
  });
});
