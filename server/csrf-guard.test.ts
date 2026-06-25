/**
 * csrf-guard.test.ts — AIDV-219 tRPC CSRF 防護單元測試
 *
 * 測試策略：用輕量 mock req/res/next 直接驗中介層行為，
 * 不需啟動整個 Express server。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// --- 複製中介層邏輯讓測試自持 ---
// 若未來把 guard 抽成獨立函式再 import，這段可刪。
function makeCsrfGuard() {
  return function csrfGuard(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (
      req.method !== "POST" ||
      process.env.CSRF_PROTECTION === "0" ||
      process.env.NODE_ENV === "test"
    ) {
      next();
      return;
    }
    if (!req.headers["x-trpc-source"]) {
      res.status(403).json({ error: "CSRF 防護：缺少 x-trpc-source header" });
      return;
    }
    next();
  };
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "POST",
    headers: {},
    ...overrides,
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

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  savedCsrfProtection = process.env.CSRF_PROTECTION;
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedCsrfProtection === undefined) delete process.env.CSRF_PROTECTION;
  else process.env.CSRF_PROTECTION = savedCsrfProtection;
});

describe("AIDV-219 CSRF guard middleware", () => {
  it("G1: POST 無 x-trpc-source → 403（production 模式）", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "POST", headers: {} });
    const { res, status } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("G2: POST 帶 x-trpc-source: web → 通過（呼叫 next）", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "POST", headers: { "x-trpc-source": "web" } });
    const { res } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("G3: GET 請求不受 CSRF guard 限制（query batching）", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "GET", headers: {} });
    const { res } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("G4: CSRF_PROTECTION=0 時 POST 無 header 仍通過（退路機制）", () => {
    process.env.NODE_ENV = "production";
    process.env.CSRF_PROTECTION = "0";
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "POST", headers: {} });
    const { res } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("G5: NODE_ENV=test 時不套用（vitest 自身環境不影響測試套件）", () => {
    process.env.NODE_ENV = "test";
    delete process.env.CSRF_PROTECTION;
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "POST", headers: {} });
    const { res } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("G6: 任意非空 x-trpc-source 值均通過（防只比對 'web'）", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const guard = makeCsrfGuard();
    const req = mockReq({ method: "POST", headers: { "x-trpc-source": "mobile-app" } });
    const { res } = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
