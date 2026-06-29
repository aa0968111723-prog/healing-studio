/**
 * csrf-origin-guard.test.ts — AIDV-558 全域 Origin/Referer CSRF 中介層單元測試
 *
 * 測試策略：用輕量 mock req/res/next 直接驗中介層與其純函式輔助，
 * 不需啟動整個 Express server（與 csrf-guard.test.ts 一致）。
 *
 * 涵蓋矩陣：安全方法略過、kill switch、測試環境略過、webhook/tRPC 排除、
 * 無 cookie 放行、跨站 Origin → 403、同源 → 通過、缺 Origin/Referer → 403、
 * Referer 後援、null origin、env/option 信任清單、dev localhost、其它變更型方法。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";
import { COOKIE_NAME } from "@shared/const";
import {
  createCsrfOriginGuard,
  normalizeOrigin,
  isOriginAllowed,
} from "./_core/csrfOriginGuard";

const SELF_HOST = "director.today";
const SELF_ORIGIN = `https://${SELF_HOST}`;
const COOKIE = `${COOKIE_NAME}=session-token-abc; other=1`;

function mockReq(overrides: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  const { headers, ...rest } = overrides;
  return {
    method: "POST",
    protocol: "https",
    path: "/api/oauth/logout",
    url: "/api/oauth/logout",
    headers: { host: SELF_HOST, ...(headers ?? {}) },
    ...rest,
  } as unknown as Request;
}

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

// --- 環境備份 ---
let savedNodeEnv: string | undefined;
let savedCsrfProtection: string | undefined;
let savedTrustedOrigins: string | undefined;

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  savedCsrfProtection = process.env.CSRF_PROTECTION;
  savedTrustedOrigins = process.env.CSRF_TRUSTED_ORIGINS;
  // 預設進入「production 啟用、無 kill switch、無額外信任來源」的可攔狀態。
  process.env.NODE_ENV = "production";
  delete process.env.CSRF_PROTECTION;
  delete process.env.CSRF_TRUSTED_ORIGINS;
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedCsrfProtection === undefined) delete process.env.CSRF_PROTECTION;
  else process.env.CSRF_PROTECTION = savedCsrfProtection;
  if (savedTrustedOrigins === undefined) delete process.env.CSRF_TRUSTED_ORIGINS;
  else process.env.CSRF_TRUSTED_ORIGINS = savedTrustedOrigins;
});

describe("AIDV-558 normalizeOrigin", () => {
  it("剝掉路徑/query 只留 protocol//host、轉小寫", () => {
    expect(normalizeOrigin("https://Director.Today/api/x?y=1")).toBe("https://director.today");
    expect(normalizeOrigin("http://localhost:5173/")).toBe("http://localhost:5173");
  });
  it("無效/空/字面 null → null", () => {
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("not a url")).toBeNull();
  });
});

describe("AIDV-558 isOriginAllowed", () => {
  const deps = { trustedOrigins: ["https://app.example.com"], isProduction: true };
  it("同源（由 host 推導）通過", () => {
    expect(isOriginAllowed(SELF_ORIGIN, mockReq(), deps)).toBe(true);
  });
  it("信任清單內通過", () => {
    expect(isOriginAllowed("https://app.example.com", mockReq(), deps)).toBe(true);
  });
  it("跨站不通過", () => {
    expect(isOriginAllowed("https://evil.com", mockReq(), deps)).toBe(false);
  });
  it("prod 時 localhost 不通過；非 prod 通過", () => {
    expect(isOriginAllowed("http://localhost:5173", mockReq(), deps)).toBe(false);
    expect(
      isOriginAllowed("http://localhost:5173", mockReq(), { trustedOrigins: [], isProduction: false })
    ).toBe(true);
  });
});

describe("AIDV-558 createCsrfOriginGuard", () => {
  it("C1: 安全方法（GET）直接放行（即便跨站 Origin＋帶 cookie）", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ method: "GET", headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C2: CSRF_PROTECTION=0 kill switch → 放行", () => {
    process.env.CSRF_PROTECTION = "0";
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("C3: NODE_ENV=test → 放行（不影響測試套件）", () => {
    process.env.NODE_ENV = "test";
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/api/webhook/fal", "fal webhook"],
    ["/api/webhook/suno", "suno webhook"],
    ["/api/webhook/replicate", "replicate webhook"],
    ["/api/webhooks/stripe", "stripe webhook"],
    ["/api/trpc/foo.bar", "tRPC（已有 x-trpc-source guard）"],
  ])("C4: 排除路徑 %s 放行（即便跨站＋帶 cookie）", path => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ path, url: path, headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C5: 無 session cookie → 放行（無從被 CSRF 冒充）", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://evil.com" } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C6: 帶 cookie＋跨站 Origin → 403（核心攻擊路徑）", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res, status, json } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("C7: 帶 cookie＋同源 Origin → 通過", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: SELF_ORIGIN, cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C8: 帶 cookie＋變更型請求但缺 Origin 與 Referer → 403", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("C9: 缺 Origin 時用 Referer 後援 — 同源 Referer 通過", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, referer: `${SELF_ORIGIN}/dashboard`, cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C10: 跨站 Referer（無 Origin）→ 403", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, referer: "https://evil.com/attack", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("C11: Origin 字面 'null'（sandbox iframe / file://）→ 403", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "null", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("C12: CSRF_TRUSTED_ORIGINS env 追加的來源 → 通過", () => {
    process.env.CSRF_TRUSTED_ORIGINS = "https://admin.partner.com, https://other.com";
    const guard = createCsrfOriginGuard();
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://admin.partner.com", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C13: options.trustedOrigins 注入的來源 → 通過", () => {
    const guard = createCsrfOriginGuard({ trustedOrigins: ["https://injected.example"] });
    const req = mockReq({ headers: { host: SELF_HOST, origin: "https://injected.example", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("C14: 非 production 時 localhost dev origin → 通過", () => {
    process.env.NODE_ENV = "development";
    const guard = createCsrfOriginGuard();
    const req = mockReq({
      protocol: "http",
      headers: { host: "localhost:5173", origin: "http://localhost:5173", cookie: COOKIE },
    });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it.each(["PUT", "PATCH", "DELETE"])("C15: 其它變更型方法 %s 同樣強制（跨站＋cookie → 403）", method => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ method, headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("C16: /api/auth/2fa/setup 跨站 form-POST（帶受害者 cookie）→ 403（DoD 重現）", () => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({
      path: "/api/auth/2fa/setup",
      url: "/api/auth/2fa/setup",
      headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE },
    });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "/api/webhooks-config",
    "/api/webhookstatus",
    "/api/trpcfoo",
  ])("C17: 同前綴但非真排除路徑 %s 仍受保護（路段邊界比對，跨站＋cookie → 403）", path => {
    const guard = createCsrfOriginGuard();
    const req = mockReq({ path, url: path, headers: { host: SELF_HOST, origin: "https://evil.com", cookie: COOKIE } });
    const { res, status } = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
