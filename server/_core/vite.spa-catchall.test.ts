import express from "express";
import fs from "fs";
import { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveStatic } from "./vite";

let tempDir = "";
let originalEnv: string | undefined;
let server: import("http").Server | null = null;
let baseUrl = "";

function distPathForServeStatic() {
  // serveStatic in dev mode resolves to <repo>/dist/public; in non-dev to
  // server/_core/public. We force production-like behavior so the temp dir
  // we point at is actually consulted, by writing to that exact location.
  return path.resolve(__dirname, "public");
}

beforeEach(async () => {
  originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  tempDir = distPathForServeStatic();
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(path.join(tempDir, "assets", "js"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "index.html"), "<html>fresh</html>");
  fs.writeFileSync(
    path.join(tempDir, "assets", "js", "real-AABBCC.js"),
    "console.log('ok');"
  );

  const app = express();
  serveStatic(app);

  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const port = (server!.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = null;
  }
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  process.env.NODE_ENV = originalEnv;
});

describe("serveStatic SPA catch-all", () => {
  it("serves the real asset when the hashed file exists", async () => {
    const res = await fetch(`${baseUrl}/assets/js/real-AABBCC.js`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/javascript/);
  });

  it("returns 404 for a missing JS chunk instead of HTML", async () => {
    // The whole point of the fix: a stale browser asks for an old chunk
    // hash, the file doesn't exist, and we MUST NOT reply with index.html
    // (which the browser would try to evaluate as JS, causing the
    // "頁面暫時載入失敗" full-screen error).
    const res = await fetch(`${baseUrl}/assets/js/index-OLDHASH.js`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toMatch(/html/);
  });

  it("returns 404 for missing CSS", async () => {
    const res = await fetch(`${baseUrl}/assets/css/missing.css`);
    expect(res.status).toBe(404);
  });

  it("falls through to index.html for SPA navigation routes", async () => {
    const res = await fetch(`${baseUrl}/studio`, {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("fresh");
  });

  it("falls through to index.html for nested SPA routes", async () => {
    const res = await fetch(`${baseUrl}/admin/brain-pipeline`, {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("fresh");
  });
});
