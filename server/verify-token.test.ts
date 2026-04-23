import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { optionalVerifyToken, verifyToken } from "./middleware/verifyToken";
import { createSessionToken } from "./_core/googleAuth";
import { COOKIE_NAME } from "@shared/const";

const { mockGetUserByOpenId } = vi.hoisted(() => ({
  mockGetUserByOpenId: vi.fn(),
}));

vi.mock("./db", () => ({
  getUserByOpenId: mockGetUserByOpenId,
}));

beforeEach(() => {
  mockGetUserByOpenId.mockReset();
  mockGetUserByOpenId.mockImplementation(async (openId: string) => ({
    id: 99,
    openId,
    role: "user",
    email: "user@example.com",
    name: "Tester",
  }));
});

describe("verifyToken middleware", () => {
  it("accepts bearer token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const token = await createSessionToken("local:user@example.com", {
      name: "Tester",
      email: "user@example.com",
      expiresInMs: 60_000,
    });

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    expect((req as any).auth?.sub).toBe("local:user@example.com");
    expect((req as any).user?.id).toBe(99);
  });

  it("accepts session cookie token", async () => {
    process.env.JWT_SECRET = "test-secret";
    const token = await createSessionToken("local:user2@example.com", {
      name: "Tester2",
      email: "user2@example.com",
      expiresInMs: 60_000,
    });

    const req = {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as unknown as Request;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("optionalVerifyToken should pass through when token missing", async () => {
    const req = { headers: {} } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    await optionalVerifyToken(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("verifyToken should continue with auth payload when DB lookup fails", async () => {
    process.env.JWT_SECRET = "test-secret";
    mockGetUserByOpenId.mockRejectedValueOnce(new Error("db down"));
    const token = await createSessionToken("local:fallback@example.com", {
      name: "Fallback",
      email: "fallback@example.com",
      expiresInMs: 60_000,
    });

    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    await verifyToken(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).auth?.sub).toBe("local:fallback@example.com");
    expect((req as any).user).toBeUndefined();
  });
});
