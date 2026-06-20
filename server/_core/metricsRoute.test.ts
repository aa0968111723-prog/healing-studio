/**
 * AIDV-58（H3）— /api/metrics admin-only 守門測試
 *
 * 驗證 /api/metrics：
 *  - 未登入（authenticateRequest → null）→ 401，不回傳 metrics
 *  - 已登入但 role="user" → 403（demo DEMO_USER 即此情形）
 *  - 已登入但 role="leader" → 403（leader 不算 admin）
 *  - role="admin" → 200 + { ok:true, metrics, cache, featureFlags }
 *  - authenticateRequest throw（DB 短暫錯誤）→ fail-closed 401
 *
 * 測試法仿 sseRoute.test.ts：express + app.listen(0) + 全域 fetch，依賴用 vi.mock 攔截。
 */
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authenticateRequestMock = vi.fn();

vi.mock("./googleAuth", () => ({
  authenticateRequest: (...args: unknown[]) => authenticateRequestMock(...args),
}));

// DatabaseManager / metrics / cache / featureFlags：提供最小 stub，避免依賴真實 DB / 全域狀態。
vi.mock("./DatabaseManager", () => ({
  getDatabaseManager: () => ({
    getPoolStats: () => ({ active: 0, idle: 0, queued: 0, total: 0 }),
    getConnectionHealth: () => ({ healthy: true }),
    getPerformanceStats: () => ({ avgMs: 1 }),
  }),
}));

vi.mock("./metrics", () => ({
  metrics: {
    setDatabaseMetrics: vi.fn(),
    getSnapshot: () => ({ requests: 0 }),
  },
}));

vi.mock("./cache", () => ({
  cache: { getStats: () => ({ hits: 0, misses: 0 }) },
}));

vi.mock("./featureFlags", () => ({
  featureFlags: { getAllStatuses: () => ({ FEATURE_X: true }) },
}));

import { metricsRouter } from "./metricsRoute";

async function startTestServer() {
  const app = express();
  app.use(metricsRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/metrics — admin-only 守門", () => {
  it("未登入 → 401，不回傳 metrics", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.metrics).toBeUndefined();
    expect(body.featureFlags).toBeUndefined();
    server.close();
  });

  it("已登入但 role=user（含 demo DEMO_USER）→ 403", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1, role: "user" });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.featureFlags).toBeUndefined();
    server.close();
  });

  it("已登入但 role=leader → 403（leader 不算 admin）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 2, role: "leader" });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(403);
    server.close();
  });

  it("role=admin → 200 + metrics/cache/featureFlags", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 3, role: "admin" });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.metrics).toBeDefined();
    expect(body.cache).toBeDefined();
    expect(body.featureFlags).toBeDefined();
    server.close();
  });

  it("authenticateRequest throw（DB 短暫錯誤）→ fail-closed 401", async () => {
    authenticateRequestMock.mockRejectedValue(new Error("DB connection error"));
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(401);
    server.close();
  });
});
