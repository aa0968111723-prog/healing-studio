import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAuthRouter } from "./routes/localAuth";

const mockFacade = {
  registerWithPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  findUserByEmail: vi.fn(),
};

const mockHistory = {
  getFailedAttemptsByEmail: vi.fn().mockResolvedValue(0),
  recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
};

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  mockFacade.registerWithPassword.mockReset();
  mockFacade.loginWithPassword.mockReset();
  mockFacade.findUserByEmail.mockReset();
  mockHistory.getFailedAttemptsByEmail.mockReset().mockResolvedValue(0);
  mockHistory.recordLoginAttempt.mockReset().mockResolvedValue(undefined);
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
});

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(
    createLocalAuthRouter({
      facade: mockFacade as any,
      loginHistory: mockHistory,
    })
  );

  const server = app.listen(0);
  const addr = server.address() as AddressInfo;
  closeServer = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return `http://127.0.0.1:${addr.port}`;
}

describe("localAuth routes", () => {
  it("rejects weak password during register", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "weakpass",
        name: "Tester",
      }),
    });

    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toContain("Password must include");
  });

  it("returns 409 when local password already exists", async () => {
    mockFacade.registerWithPassword.mockRejectedValueOnce(
      new Error("EMAIL_ALREADY_REGISTERED")
    );

    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "Strong!Pass1",
        name: "Tester",
      }),
    });

    expect(res.status).toBe(409);
  });

  it("register returns 201 and payload when facade succeeds", async () => {
    mockFacade.registerWithPassword.mockResolvedValueOnce({
      token: "jwt-token",
      user: {
        openId: "google-sub-123",
        email: "oauth@example.com",
        name: "OAuth User",
      },
    });

    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "oauth@example.com",
        password: "Strong!Pass1",
      }),
    });

    expect(res.status).toBe(201);
    expect(mockFacade.registerWithPassword).toHaveBeenCalledOnce();
  });

  it("returns 401 when login password verification fails", async () => {
    mockFacade.loginWithPassword.mockRejectedValueOnce(
      new Error("INVALID_CREDENTIALS")
    );

    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "login@example.com",
        password: "wrong",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 429 when account has too many recent failed attempts", async () => {
    // Simulate 5 recent failures for this email
    mockHistory.getFailedAttemptsByEmail.mockResolvedValueOnce(5);

    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "locked@example.com",
        password: "AnyPass1!",
      }),
    });

    expect(res.status).toBe(429);
    const payload = await res.json();
    expect(payload.error).toContain("Too many failed login attempts");
    // Facade should never be called when locked out
    expect(mockFacade.loginWithPassword).not.toHaveBeenCalled();
  });

  it("records login history on successful login", async () => {
    mockFacade.loginWithPassword.mockResolvedValueOnce({
      token: "jwt-token",
      userId: 42,
      user: { openId: "local:user@example.com", email: "user@example.com", name: "User" },
    });

    const base = await startTestServer();
    await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "AnyPass1!" }),
    });

    // Allow fire-and-forget to settle
    await new Promise(r => setTimeout(r, 20));
    expect(mockHistory.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, success: true })
    );
  });

  it("proceeds normally when history DB is unavailable during login", async () => {
    // Simulate DB failure in the brute-force check
    mockHistory.getFailedAttemptsByEmail.mockRejectedValueOnce(new Error("DB down"));
    mockFacade.loginWithPassword.mockResolvedValueOnce({
      token: "jwt-token",
      userId: 99,
      user: { openId: "local:u@example.com", email: "u@example.com", name: "U" },
    });

    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "u@example.com", password: "AnyPass1!" }),
    });

    // DB failure in brute-force check should not block the login
    expect(res.status).toBe(200);
  });
});
