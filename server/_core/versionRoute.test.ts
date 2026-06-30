/**
 * AIDV-952 — /api/version build-version 端點測試
 *
 * 驗證：
 *  - RAILWAY_GIT_COMMIT_SHA 存在 → echoed full commit + 7-char shortCommit
 *  - RAILWAY_GIT_COMMIT_SHA 不存在 → "dev" fallback，不拋錯，deploymentId 為 null
 *  - 無需認證（不回 401/403）
 *  - Cache-Control: no-store 存在（防 CDN 快取舊 SHA，AIDV-259 同源理由）
 *
 * 測試法仿 metricsRoute.test.ts：express + app.listen(0) + 全域 fetch。
 * handler 每次請求即時讀 process.env，故直接設/刪環境變數即可覆蓋兩個分支。
 */
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { versionRouter } from "./versionRoute";

async function startTestServer() {
  const app = express();
  app.use(versionRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

const SHA_ENV = "RAILWAY_GIT_COMMIT_SHA";
const DEP_ENV = "RAILWAY_DEPLOYMENT_ID";
let savedSha: string | undefined;
let savedDep: string | undefined;

beforeEach(() => {
  savedSha = process.env[SHA_ENV];
  savedDep = process.env[DEP_ENV];
  delete process.env[SHA_ENV];
  delete process.env[DEP_ENV];
});

afterEach(() => {
  if (savedSha === undefined) delete process.env[SHA_ENV];
  else process.env[SHA_ENV] = savedSha;
  if (savedDep === undefined) delete process.env[DEP_ENV];
  else process.env[DEP_ENV] = savedDep;
});

describe("GET /api/version — build-version 自我檢查端點（AIDV-952）", () => {
  it("RAILWAY_GIT_COMMIT_SHA 存在 → 回 full commit + 7-char shortCommit + deploymentId", async () => {
    process.env[SHA_ENV] = "0123456789abcdef0123456789abcdef01234567";
    process.env[DEP_ENV] = "dep-abc-123";
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(body.shortCommit).toBe("0123456");
    expect(body.deploymentId).toBe("dep-abc-123");
    expect(typeof body.ts).toBe("number");
    server.close();
  });

  it("RAILWAY_GIT_COMMIT_SHA 不存在 → 'dev' fallback，shortCommit 也是 'dev'，deploymentId 為 null", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit).toBe("dev");
    expect(body.shortCommit).toBe("dev");
    expect(body.deploymentId).toBeNull();
    server.close();
  });

  it("空字串 SHA 也視為 'dev'（避免回報空 commit）", async () => {
    process.env[SHA_ENV] = "   ";
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/version`);
    const body = await res.json();
    expect(body.commit).toBe("dev");
    server.close();
  });

  it("無需認證 → 不回 401/403", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    server.close();
  });

  it("Cache-Control: no-store 存在（防 CDN 快取舊 SHA）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    server.close();
  });
});
