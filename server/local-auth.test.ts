import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAuthRouter } from "./routes/localAuth";

const mockFacade = {
  registerWithPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  findUserByEmail: vi.fn(),
};

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  mockFacade.registerWithPassword.mockReset();
  mockFacade.loginWithPassword.mockReset();
  mockFacade.findUserByEmail.mockReset();
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
});
