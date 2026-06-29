/**
 * AIDV-580 — Google OAuth **login** CSRF / session-fixation guard.
 *
 * The fix mints a high-entropy `nonce` at `/api/oauth/google/start`, mirrors it
 * into a short-lived first-party `oauth_state` cookie, embeds it in the `state`,
 * and refuses any callback whose `state` nonce doesn't match the cookie — so a
 * forged `code`+`state` minted from an attacker's own Google account can't be
 * replayed into a victim's browser. Enforcement is gated by
 * `OAUTH_LOGIN_STATE_CSRF` (default OFF → merge is a no-op until Bruce flips it).
 *
 * Harness mirrors metricsRoute.test.ts / sseRoute.test.ts: a real express app on
 * app.listen(0) hit with global fetch (redirect:"manual"); externals are mocked.
 * `buildGoogleAuthUrl` is stubbed (so no GOOGLE_CLIENT_ID is needed) but the
 * nonce/flag/state helpers stay REAL — this exercises the actual guard.
 */
import express, { type Express } from "express";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeOAuthState } from "./oauthState";
import { COOKIE_NAME } from "@shared/const";

const h = vi.hoisted(() => ({
  buildUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?fake=1"),
  exchange: vi.fn(),
  userInfo: vi.fn(),
  upsertUser: vi.fn(async () => {}),
}));

vi.mock("./googleAuth", async (orig) => {
  const actual = await orig<typeof import("./googleAuth")>();
  return {
    ...actual,
    // Keep the REAL nonce/flag/state + JWT helpers; stub only the network + env edges.
    isDemoMode: () => false,
    isRefreshTokenRotationEnabled: () => false,
    buildGoogleAuthUrl: (...a: unknown[]) => h.buildUrl(...a),
    exchangeCodeForTokens: (...a: unknown[]) => h.exchange(...a),
    getGoogleUserInfo: (...a: unknown[]) => h.userInfo(...a),
  };
});

vi.mock("../db", () => ({
  upsertUser: (...a: unknown[]) => h.upsertUser(...a),
  getUserByOpenId: vi.fn(async () => undefined),
  insertRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock("../services/googleDrive", () => ({
  buildDriveAuthUrl: vi.fn(() => "https://drive.example/fake"),
  exchangeDriveCode: vi.fn(),
  saveDriveTokens: vi.fn(),
}));

let app: Express;
let baseUrl: string;
let server: ReturnType<Express["listen"]>;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-jwt-secret-aidv580-1234567890";
  const { registerOAuthRoutes } = await import("./oauth");
  app = express();
  registerOAuthRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
  delete process.env.JWT_SECRET;
});

beforeEach(() => {
  h.buildUrl.mockClear();
  h.exchange.mockClear();
  h.userInfo.mockClear();
  h.upsertUser.mockClear();
  h.exchange.mockResolvedValue({
    access_token: "fake-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid email profile",
    id_token: "",
  });
  h.userInfo.mockResolvedValue({
    sub: "user-victim-1",
    email: "victim@example.com",
    name: "Victim",
    email_verified: true,
  });
});

afterEach(() => {
  delete process.env.OAUTH_LOGIN_STATE_CSRF;
});

function get(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe("/api/oauth/google/start — mints nonce + cookie (AIDV-580)", () => {
  it("sets a one-time oauth_state cookie and passes the same nonce to the auth URL", async () => {
    const res = await get("/api/oauth/google/start?redirect=/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?fake=1",
    );

    const cookies = setCookies(res);
    const stateCookie = cookies.find((c) => c.startsWith("oauth_state="));
    expect(stateCookie, "oauth_state cookie must be set").toBeTruthy();
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).toMatch(/Path=\/api\/oauth/i);

    const cookieNonce = /oauth_state=([^;]+)/.exec(stateCookie!)?.[1];
    expect(cookieNonce && cookieNonce.length).toBeGreaterThan(20);

    // buildGoogleAuthUrl(redirectAfter, req, nonce) — nonce must equal the cookie.
    expect(h.buildUrl).toHaveBeenCalledTimes(1);
    const [redirectAfter, , passedNonce] = h.buildUrl.mock.calls[0];
    expect(redirectAfter).toBe("/dashboard");
    expect(passedNonce).toBe(cookieNonce);
  });
});

describe("/api/oauth/callback — login nonce enforcement (flag ON)", () => {
  beforeEach(() => {
    process.env.OAUTH_LOGIN_STATE_CSRF = "1";
  });

  it("rejects a forged state with NO matching cookie before exchanging the code", async () => {
    const state = encodeOAuthState({
      redirect: "/",
      purpose: "login",
      nonce: "attacker-supplied-nonce",
    });
    const res = await get(`/api/oauth/callback?code=ATTACKER_CODE&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=oauth_state_mismatch");
    // The whole point: no code exchange, no attacker session minted.
    expect(h.exchange).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME}=`))).toBe(false);
  });

  it("rejects when the cookie nonce and state nonce differ", async () => {
    const state = encodeOAuthState({ redirect: "/", purpose: "login", nonce: "N1" });
    const res = await get(
      `/api/oauth/callback?code=C&state=${encodeURIComponent(state)}`,
      "oauth_state=N2",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=oauth_state_mismatch");
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it("accepts a matching nonce, exchanges the code, and mints the session", async () => {
    const nonce = "matching-nonce-aidv580";
    const state = encodeOAuthState({ redirect: "/dashboard", purpose: "login", nonce });
    const res = await get(
      `/api/oauth/callback?code=GOOD_CODE&state=${encodeURIComponent(state)}`,
      `oauth_state=${nonce}`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("welcome=1");
    expect(h.exchange).toHaveBeenCalledTimes(1);

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${COOKIE_NAME}=`))).toBe(true);
    // The one-time state cookie is cleared (expired) after use.
    const cleared = cookies.find((c) => c.startsWith("oauth_state="));
    expect(cleared).toBeTruthy();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});

describe("/api/oauth/callback — flag OFF preserves legacy behaviour", () => {
  it("a legacy state with no nonce/cookie still logs in (zero-behaviour-change default)", async () => {
    // No OAUTH_LOGIN_STATE_CSRF set → enforcement off.
    const legacyState = Buffer.from("/", "utf-8").toString("base64");
    const res = await get(`/api/oauth/callback?code=GOOD_CODE&state=${legacyState}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("welcome=1");
    expect(h.exchange).toHaveBeenCalledTimes(1);
    expect(setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME}=`))).toBe(true);
  });
});
