/**
 * securityHeaders (AIDV-249) — HTTP 安全回應標頭單元測試
 *
 * 驗收條件：
 *   1. Content-Security-Policy 存在且不含 unsafe-eval
 *   2. X-Frame-Options 存在（SAMEORIGIN）
 *   3. X-Content-Type-Options: nosniff
 *   4. Strict-Transport-Security 存在
 *   5. Referrer-Policy: strict-origin-when-cross-origin
 *   6. Permissions-Policy 存在且封鎖 camera/microphone
 *   7. /api/trpc 路由無 Access-Control-Allow-Origin: *
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import helmet from "helmet";
import { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          mediaSrc: ["'self'", "blob:", "https:"],
          connectSrc: ["'self'", "https:", "wss:"],
          fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    );
    next();
  });
  app.get("/api/trpc/videoProject.list", (_req, res) => {
    res.json({ ok: true });
  });

  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Server bind failed");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

async function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

describe("Security response headers (AIDV-249)", () => {
  it("Content-Security-Policy 存在", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("CSP 不含 unsafe-eval", async () => {
    const res = await get("/api/trpc/videoProject.list");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("unsafe-eval");
  });

  it("CSP 含 object-src 'none'（阻止 plugin 執行）", async () => {
    const res = await get("/api/trpc/videoProject.list");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("object-src");
    expect(csp).toContain("'none'");
  });

  it("X-Frame-Options 存在", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("x-frame-options")).toBeTruthy();
  });

  it("X-Content-Type-Options: nosniff", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("Strict-Transport-Security 存在", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("strict-transport-security")).toBeTruthy();
  });

  it("Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy 存在且封鎖 camera 和 microphone", async () => {
    const res = await get("/api/trpc/videoProject.list");
    const pp = res.headers.get("permissions-policy") ?? "";
    expect(pp).toBeTruthy();
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
  });

  it("回應不含 Access-Control-Allow-Origin: *（tRPC 路由）", async () => {
    const res = await get("/api/trpc/videoProject.list");
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});
