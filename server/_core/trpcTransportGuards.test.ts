/**
 * trpcTransportGuards.test.ts — AIDV-35 (complementary CI guard)
 *
 * Companion to `trpcBodyParser.test.ts` (which guards the AIDV-572 express.json
 * body-parser axis). This file closes the two remaining `/api/trpc` transport
 * guards that previously had no real-HTTP integration coverage and no binding to
 * the real `index.ts` wiring:
 *
 *   1. AIDV-219 CSRF guard — POST must carry an `x-trpc-source` header (403 if
 *      missing in production). `csrf-guard.test.ts` only exercises a *copied*
 *      replica via mock req/res, so a regression in the real middleware (removal,
 *      reordering, or weakening) would not be caught. We add (a) a real-HTTP
 *      integration test mounting the guard exactly as production does, and (b) a
 *      source invariant binding the contract to `index.ts`.
 *   2. AIDV-293 jsonDepthGuard — rejects payloads nested >32 levels (400).
 *      `inputGuard.ts` had no test at all; we add real-HTTP coverage using the
 *      REAL `jsonDepthGuard` import plus `measureDepth` boundary unit checks.
 *
 * Why real HTTP + a source invariant (mirrors trpcBodyParser.test.ts): router
 * createCaller tests bypass Express, and browser smoke tests never submit a
 * mutation, so the only way to catch a wiring regression is to drive a real
 * request through the express.json → jsonDepthGuard → csrf → tRPC chain AND
 * assert index.ts keeps that ordering.
 *
 * Pure additive test — zero production-code change, not in the deploy path.
 */
import { readFileSync } from "fs";
import { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { jsonDepthGuard, _measureDepthForTest as measureDepth } from "./inputGuard";

// ── Faithful replica of the inline tRPC CSRF guard in index.ts (L~972-985).
// The production guard is defined inline (not exported), so we replicate it
// verbatim here for the behavioural test; the source-invariant block below binds
// this contract to the real index.ts so the two cannot silently drift.
function trpcCsrfGuard(): express.RequestHandler {
  return (req, res, next) => {
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

// Build an express app reproducing the production /api/trpc middleware ordering:
//   express.json → jsonDepthGuard(32) → csrf guard → handler (stands in for the
//   tRPC adapter). The handler echoes req.body so we can assert it was parsed.
function buildApp(): express.Express {
  const app = express();
  app.use("/api/trpc", express.json({ limit: "4mb" }));
  app.use("/api/trpc", jsonDepthGuard(32));
  app.use("/api/trpc", trpcCsrfGuard());
  app.use("/api/trpc", (req, res) => {
    res.status(200).json({ ok: true, body: req.body });
  });
  return app;
}

let server: import("http").Server;
let baseUrl: string;

beforeAll(async () => {
  const app = buildApp();
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

// The guards read process.env at request time; save/restore around each test.
let savedNodeEnv: string | undefined;
let savedCsrf: string | undefined;
beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  savedCsrf = process.env.CSRF_PROTECTION;
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedCsrf === undefined) delete process.env.CSRF_PROTECTION;
  else process.env.CSRF_PROTECTION = savedCsrf;
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("AIDV-219 tRPC CSRF guard (real HTTP)", () => {
  it("production POST without x-trpc-source → 403", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const res = await post("/api/trpc/videoProject.create", { json: { title: "x" } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/x-trpc-source/);
  });

  it("production POST with x-trpc-source → passes guard (200, body parsed)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const res = await post(
      "/api/trpc/videoProject.create",
      { json: { title: "x" } },
      { "x-trpc-source": "react" }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.body).toEqual({ json: { title: "x" } });
  });

  it("any non-empty x-trpc-source value passes (not just 'web') — guards over-narrow matching", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_PROTECTION;
    const res = await post(
      "/api/trpc/auth.logout",
      { json: null },
      { "x-trpc-source": "mobile-app" }
    );
    expect(res.status).toBe(200);
  });

  it("CSRF_PROTECTION=0 kill-switch lets a header-less POST through (fallback)", async () => {
    process.env.NODE_ENV = "production";
    process.env.CSRF_PROTECTION = "0";
    const res = await post("/api/trpc/videoProject.create", { json: {} });
    expect(res.status).toBe(200);
  });

  it("NODE_ENV=test bypasses the guard (vitest's own env must not 403)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.CSRF_PROTECTION;
    const res = await post("/api/trpc/videoProject.create", { json: {} });
    expect(res.status).toBe(200);
  });
});

describe("AIDV-293 jsonDepthGuard on /api/trpc (real HTTP, real guard)", () => {
  // NODE_ENV=test so the csrf guard is bypassed and the only thing that can 400
  // is the depth guard — isolating the axis under test.
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("payload nested >32 levels → 400 (Billion-Laughs / deep-recursion guard)", async () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { n: deep };
    const res = await post("/api/trpc/videoProject.create", deep);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/nesting depth/i);
  });

  it("shallow payload passes the depth guard → 200 with parsed body", async () => {
    const res = await post("/api/trpc/videoProject.create", { json: { a: { b: 1 } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body).toEqual({ json: { a: { b: 1 } } });
  });
});

describe("AIDV-293 measureDepth boundary semantics", () => {
  it("flat / one-level / two-level containers", () => {
    expect(measureDepth({})).toBe(0);
    expect(measureDepth({ a: { b: 1 } })).toBe(1);
    expect(measureDepth([[[1]]])).toBe(2);
  });

  it("primitive leaves do not add depth; early-exits at the limit", () => {
    expect(measureDepth({ a: 1, b: "s", c: true })).toBe(0);
    let deep: unknown = 1;
    for (let i = 0; i < 50; i++) deep = [deep];
    // early-exit means it reports at least the limit, never less
    expect(measureDepth(deep, 32)).toBeGreaterThanOrEqual(32);
  });
});

describe("AIDV-35 source invariant — binds guards to real index.ts wiring", () => {
  const indexSrc = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  const trpcJsonIdx = indexSrc.search(
    /app\.use\(\s*["']\/api\/trpc["']\s*,\s*express\.json\(/
  );
  const depthIdx = indexSrc.search(
    /app\.use\(\s*["']\/api\/trpc["']\s*,\s*jsonDepthGuard\(/
  );
  // The inline CSRF guard mount: /api/trpc handler that checks x-trpc-source.
  const csrfIdx = indexSrc.search(
    /app\.use\(\s*["']\/api\/trpc["']\s*,\s*\(req[\s\S]*?x-trpc-source[\s\S]*?status\(403\)/
  );
  const trpcMwIdx = indexSrc.indexOf("createExpressMiddleware(");

  it("index.ts mounts the jsonDepthGuard on /api/trpc", () => {
    expect(depthIdx).toBeGreaterThan(-1);
  });

  it("index.ts mounts a CSRF guard on /api/trpc that 403s on missing x-trpc-source", () => {
    expect(csrfIdx).toBeGreaterThan(-1);
  });

  it("CSRF guard documents the CSRF_PROTECTION kill-switch and NODE_ENV=test bypass", () => {
    expect(indexSrc).toMatch(/CSRF_PROTECTION\s*===\s*["']0["']/);
    expect(indexSrc).toMatch(/NODE_ENV\s*===\s*["']test["']/);
  });

  it("wiring order is express.json → jsonDepthGuard → csrf guard → tRPC adapter", () => {
    expect(trpcJsonIdx).toBeGreaterThan(-1);
    expect(trpcMwIdx).toBeGreaterThan(-1);
    expect(trpcJsonIdx).toBeLessThan(depthIdx);
    expect(depthIdx).toBeLessThan(csrfIdx);
    expect(csrfIdx).toBeLessThan(trpcMwIdx);
  });
});
