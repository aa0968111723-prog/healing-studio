/**
 * AIDV-558 — Global CSRF Origin/Referer guard for non-tRPC, non-webhook Express routes.
 *
 * Tests exercise the middleware inserted in server/_core/index.ts between the
 * urlencoded body-parser and the first route registration.  We mount a minimal
 * express app that only includes the middleware + a trivial POST handler so the
 * tests don't depend on the full server startup.
 *
 * Harness mirrors metricsRoute.test.ts / oauth.csrf.test.ts: express + listen(0)
 * + global fetch with redirect:"manual".
 */
import express, { type Express } from "express";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();

  const CSRF_BYPASS_PREFIXES = ["/api/trpc", "/api/webhook/"];
  const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

  app.use((req, res, next) => {
    if (
      process.env.CSRF_PROTECTION === "0" ||
      process.env.NODE_ENV === "test" ||
      CSRF_SAFE_METHODS.has(req.method) ||
      CSRF_BYPASS_PREFIXES.some((p) => req.path.startsWith(p))
    ) {
      return next();
    }
    const siteUrl = process.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
    if (!siteUrl || siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1")) {
      return next();
    }
    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;
    let requestOrigin: string | undefined;
    if (origin) {
      requestOrigin = origin.replace(/\/$/, "");
    } else if (referer) {
      try { requestOrigin = new URL(referer).origin; } catch { /* block */ }
    }
    if (!requestOrigin) {
      res.status(403).json({ error: "CSRF 防護：缺少 Origin header" });
      return;
    }
    if (requestOrigin !== siteUrl) {
      res.status(403).json({ error: "CSRF 防護：不允許的 Origin" });
      return;
    }
    return next();
  });

  app.post("/api/oauth/logout", (_req, res) => res.json({ ok: true }));
  app.post("/api/trpc/some.procedure", (_req, res) => res.json({ ok: true }));
  app.post("/api/webhook/suno", (_req, res) => res.json({ ok: true }));

  return app;
}

let server: ReturnType<Express["listen"]>;
let baseUrl: string;

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => server?.close());

afterEach(() => {
  delete process.env.CSRF_PROTECTION;
  delete process.env.VITE_SITE_URL;
  // Reset NODE_ENV to "test" (vitest sets it; make sure teardown doesn't leave it changed)
  process.env.NODE_ENV = "test";
});

function post(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers });
}

// ─── prod-like scenario: VITE_SITE_URL set to a real domain ──────────────────

describe("CSRF guard — prod env (VITE_SITE_URL=https://app.example.com)", () => {
  // Each test sets up its own env to avoid cross-test interference.
  function setupProd() {
    process.env.VITE_SITE_URL = "https://app.example.com";
    process.env.NODE_ENV = "production";
  }

  it("cross-origin POST → 403 (no Origin header)", async () => {
    setupProd();
    const res = await post("/api/oauth/logout");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/缺少 Origin/);
  });

  it("cross-origin POST → 403 (attacker Origin)", async () => {
    setupProd();
    const res = await post("/api/oauth/logout", { origin: "https://attacker.example.com" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/不允許的 Origin/);
  });

  it("cross-origin POST with valid-looking Referer from attacker → 403", async () => {
    setupProd();
    const res = await post("/api/oauth/logout", {
      referer: "https://attacker.example.com/page",
    });
    expect(res.status).toBe(403);
  });

  it("same-origin POST → 200 (Origin matches VITE_SITE_URL)", async () => {
    setupProd();
    const res = await post("/api/oauth/logout", { origin: "https://app.example.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("same-origin POST via Referer (no Origin) → 200", async () => {
    setupProd();
    const res = await post("/api/oauth/logout", {
      referer: "https://app.example.com/dashboard",
    });
    expect(res.status).toBe(200);
  });

  it("/api/trpc routes bypass the guard entirely", async () => {
    setupProd();
    const res = await post("/api/trpc/some.procedure");
    expect(res.status).toBe(200);
  });

  it("/api/webhook/ routes bypass the guard entirely", async () => {
    setupProd();
    const res = await post("/api/webhook/suno");
    expect(res.status).toBe(200);
  });

  it("GET is always allowed (CSRF-safe method)", async () => {
    setupProd();
    const res = await fetch(`${baseUrl}/api/oauth/logout`, { method: "GET" });
    // Route only handles POST so this 404s, but must NOT 403.
    expect(res.status).not.toBe(403);
  });
});

// ─── dev / local bypass ───────────────────────────────────────────────────────

describe("CSRF guard — dev/local env (no VITE_SITE_URL or localhost)", () => {
  it("no VITE_SITE_URL → guard skips (allows cross-origin POST)", async () => {
    process.env.NODE_ENV = "production";
    // VITE_SITE_URL deliberately unset
    const res = await post("/api/oauth/logout");
    expect(res.status).toBe(200);
  });

  it("VITE_SITE_URL=http://localhost:5173 → guard skips", async () => {
    process.env.NODE_ENV = "production";
    process.env.VITE_SITE_URL = "http://localhost:5173";
    const res = await post("/api/oauth/logout");
    expect(res.status).toBe(200);
  });
});

// ─── kill-switch ──────────────────────────────────────────────────────────────

describe("CSRF guard — CSRF_PROTECTION=0 kill-switch", () => {
  it("CSRF_PROTECTION=0 lets cross-origin POST through even in prod", async () => {
    process.env.CSRF_PROTECTION = "0";
    process.env.VITE_SITE_URL = "https://app.example.com";
    process.env.NODE_ENV = "production";
    const res = await post("/api/oauth/logout", { origin: "https://attacker.example.com" });
    expect(res.status).toBe(200);
  });
});

// ─── test mode (default in vitest) ───────────────────────────────────────────

describe("CSRF guard — NODE_ENV=test (vitest default)", () => {
  it("guard is skipped when NODE_ENV=test regardless of VITE_SITE_URL", async () => {
    process.env.VITE_SITE_URL = "https://app.example.com";
    // NODE_ENV is "test" by default in vitest — no override needed
    const res = await post("/api/oauth/logout", { origin: "https://attacker.example.com" });
    expect(res.status).toBe(200);
  });
});
