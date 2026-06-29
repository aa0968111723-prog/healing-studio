/**
 * AIDV-572 — tRPC transport-layer body parser regression guard
 *
 * Root cause (proven, body-parser 1.x + express 4 + @trpc/server v11):
 *   The global `express.urlencoded()` mounted in index.ts runs
 *   `req.body = req.body || {}` BEFORE its own content-type check, so EVERY
 *   request — including `application/json` — leaves the chain with `req.body`
 *   already set to `{}`. tRPC's express adapter then sees `"body" in req` is
 *   true and uses that empty `{}` instead of reading the raw stream, so every
 *   mutation receives empty input and zod rejects it with HTTP 400. Because
 *   `/api/trpc` had no JSON parser of its own, this broke ALL tRPC writes on
 *   real HTTP (queries survive — they read input from the query string).
 *
 * The fix mounts `express.json()` on `/api/trpc` before the tRPC middleware so
 * the real body is parsed back onto `req.body`.
 *
 * Why this test exists / why earlier guards missed the bug (see card R22/R23):
 *   - createCaller-based router tests bypass the Express HTTP layer entirely.
 *   - Browser smoke tests never submit a mutation.
 *   So the only way to catch a regression is to (a) drive a real mutation over
 *   HTTP through the urlencoded→json→tRPC chain, and (b) assert the real
 *   index.ts wiring keeps the json parser in front of the tRPC handler.
 *
 * The body-parser pollution is transformer-independent, so the behavioural
 * tests use a plain (no-transformer) router for clarity — the invariant under
 * test is purely "is req.body parsed from the stream before tRPC reads it".
 */
import { readFileSync } from "fs";
import { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { z } from "zod";

const t = initTRPC.create();
const appRouter = t.router({
  create: t.procedure
    .input(z.object({ aspectRatio: z.string() }))
    .mutation(({ input }) => ({ ok: true, got: input })),
});

/**
 * Build an express app that reproduces the production middleware ordering:
 * a global `express.urlencoded()` (the polluter) followed by the tRPC adapter.
 * When `withJsonParser` is true we additionally mount `express.json()` on
 * `/api/trpc` — exactly the AIDV-572 fix.
 */
function buildApp(withJsonParser: boolean): express.Express {
  const app = express();
  app.use(express.urlencoded({ limit: "4mb", extended: true }));
  if (withJsonParser) app.use("/api/trpc", express.json({ limit: "4mb" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter })
  );
  return app;
}

let fixedServer: Server;
let brokenServer: Server;
let fixedUrl: string;
let brokenUrl: string;

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Server bind failed");
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

beforeAll(async () => {
  ({ server: fixedServer, url: fixedUrl } = await listen(buildApp(true)));
  ({ server: brokenServer, url: brokenUrl } = await listen(buildApp(false)));
});

afterAll(() => {
  fixedServer?.close();
  brokenServer?.close();
});

function postJson(base: string, body: string) {
  return fetch(`${base}/api/trpc/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("AIDV-572 tRPC body parser (real HTTP)", () => {
  it("mutation with express.json on /api/trpc parses the body → 200 with input", async () => {
    const res = await postJson(fixedUrl, JSON.stringify({ aspectRatio: "16:9" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data?.result?.data?.got).toEqual({ aspectRatio: "16:9" });
  });

  it("negative control: WITHOUT the parser the global urlencoded poisons req.body → 400 (the original bug)", async () => {
    const res = await postJson(brokenUrl, JSON.stringify({ aspectRatio: "16:9" }));
    expect(res.status).toBe(400);
  });

  it("malformed JSON is rejected with 400 and does not crash the server (C35 hardening)", async () => {
    const res = await postJson(fixedUrl, "{ not valid json ");
    expect(res.status).toBe(400);
    // server is still alive after the malformed request
    const ok = await postJson(fixedUrl, JSON.stringify({ aspectRatio: "9:16" }));
    expect(ok.status).toBe(200);
  });
});

describe("AIDV-572 source invariant (binds the guard to real index.ts wiring)", () => {
  const indexSrc = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  it("index.ts mounts express.json on /api/trpc", () => {
    expect(indexSrc).toMatch(/app\.use\(\s*["']\/api\/trpc["']\s*,\s*express\.json\(/);
  });

  it("the /api/trpc json parser is mounted before the tRPC middleware", () => {
    const parserIdx = indexSrc.search(
      /app\.use\(\s*["']\/api\/trpc["']\s*,\s*express\.json\(/
    );
    const trpcIdx = indexSrc.indexOf("createExpressMiddleware(");
    expect(parserIdx).toBeGreaterThan(-1);
    expect(trpcIdx).toBeGreaterThan(-1);
    expect(parserIdx).toBeLessThan(trpcIdx);
  });
});
