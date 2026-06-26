/**
 * authFailClosed.test.ts — AIDV-259 (AIDV-258)
 *
 * Verifies that verifyToken fails CLOSED when the database is unreachable.
 * The old behaviour was fail-open: catch DB error → log warning → return true,
 * allowing JWT-only access without the DB-side role/soft-delete checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../_core/googleAuth", () => ({
  verifySessionToken: vi.fn(),
  hashSessionToken: vi.fn((t: string) => `hash:${t}`),
  isRefreshTokenRotationEnabled: vi.fn(() => false),
}));

vi.mock("../../db", () => ({
  getUserByOpenId: vi.fn(),
  isRefreshTokenActive: vi.fn(() => true),
}));

vi.mock("cookie", () => ({
  parse: vi.fn(() => ({})),
}));

vi.mock("../../_core/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { verifyToken, optionalVerifyToken } from "../verifyToken";
import { verifySessionToken } from "../../_core/googleAuth";
import { getUserByOpenId } from "../../db";
import type { Request, Response, NextFunction } from "express";

function makeReq(token?: string): Request {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : undefined,
      cookie: "",
    },
  } as unknown as Request;
}

function makeRes(): { res: Response; state: { statusCode: number; body: unknown } } {
  const state = { statusCode: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(data: unknown) {
      state.body = data;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

describe("verifyToken — fail-closed on DB error (AIDV-258)", () => {
  const next = vi.fn() as unknown as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no token is present", async () => {
    const req = makeReq();
    const { res, state } = makeRes();
    await verifyToken(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when JWT is invalid (verifySessionToken returns null)", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null as any);
    const req = makeReq("bad-token");
    const { res, state } = makeRes();
    await verifyToken(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when DB is unreachable (ECONNREFUSED) — fail-closed", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "google|123", name: "Test" } as any);
    vi.mocked(getUserByOpenId).mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" })
    );
    const req = makeReq("valid-token");
    const { res, state } = makeRes();
    await verifyToken(req, res, next);
    // Must reject — not pass through with JWT-only auth
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when DB throws connection timeout", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "google|456", name: "User" } as any);
    vi.mocked(getUserByOpenId).mockRejectedValue(
      new Error("Connection timed out after 10000ms")
    );
    const req = makeReq("valid-token");
    const { res, state } = makeRes();
    await verifyToken(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when DB returns a valid user", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "google|789", name: "Valid User" } as any);
    vi.mocked(getUserByOpenId).mockResolvedValue({
      id: 1,
      openId: "google|789",
      role: "user",
      email: "user@example.com",
      name: "Valid User",
      deletedAt: null,
    } as any);
    const req = makeReq("good-token");
    const { res } = makeRes();
    await verifyToken(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when DB returns a soft-deleted user", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "google|deleted", name: "Deleted" } as any);
    vi.mocked(getUserByOpenId).mockResolvedValue({
      id: 99,
      openId: "google|deleted",
      role: "user",
      email: null,
      name: null,
      deletedAt: new Date(),
    } as any);
    const req = makeReq("old-token");
    const { res, state } = makeRes();
    await verifyToken(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("optionalVerifyToken — fail-closed on DB error", () => {
  const next = vi.fn() as unknown as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() with no token (unauthenticated passthrough)", async () => {
    const req = makeReq();
    const { res } = makeRes();
    await optionalVerifyToken(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() even when DB errors — optional route still responds", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "google|x", name: "X" } as any);
    vi.mocked(getUserByOpenId).mockRejectedValue(new Error("ECONNREFUSED"));
    const req = makeReq("some-token");
    const { res } = makeRes();
    await optionalVerifyToken(req, res, next);
    // optionalVerifyToken always calls next() — it's designed for public routes
    expect(next).toHaveBeenCalledOnce();
  });
});
