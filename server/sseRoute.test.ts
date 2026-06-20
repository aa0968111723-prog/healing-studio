/**
 * AIDV-58 — SSE IDOR 修補測試
 *
 * 驗證兩個 SSE 端點在開串流之前正確做：
 *  - 驗證登入（未登入 → 401）
 *  - 擁有權檢查（非本人 / 查無 → 403）
 *  - 通過後正常開串流（200 + text/event-stream + connected 事件）
 *  - 非數字 id → 400
 *
 * 測試法仿 server/routes/__tests__/webhooks.test.ts：
 * 無 supertest，express + app.listen(0) + 全域 fetch，依賴用 vi.mock 攔截。
 */
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock auth（authenticateRequest）與 db（getter）——必須在 import router 之前 ──
const authenticateRequestMock = vi.fn();
const getBackgroundJobMock = vi.fn();
const getFineTunedModelMock = vi.fn();

vi.mock("./_core/googleAuth", () => ({
  authenticateRequest: (...args: unknown[]) => authenticateRequestMock(...args),
}));

vi.mock("./db", () => ({
  getBackgroundJob: (...args: unknown[]) => getBackgroundJobMock(...args),
  getFineTunedModel: (...args: unknown[]) => getFineTunedModelMock(...args),
}));

import { sseRouter } from "./sseRoute";

async function startTestServer() {
  const app = express();
  // sseRouter 自帶 /api/... 前綴，root 掛載（對齊 _core/index.ts 的 app.use(sseRouter)）
  app.use(sseRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * 讀第一段 chunk（拿到 connected 事件）即可斷言，避免等串流結束（最長 5 分鐘）造成 hang。
 * 讀完立刻 cancel reader 中斷連線。
 */
async function readFirstChunk(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(value);
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  getBackgroundJobMock.mockReset();
  getFineTunedModelMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SSE /api/generation-events/:jobId — IDOR 修補", () => {
  it("非數字 jobId → 400（auth 不被呼叫）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generation-events/abc`);
    expect(res.status).toBe(400);
    expect(authenticateRequestMock).not.toHaveBeenCalled();
    server.close();
  });

  it("未登入 → 401，且不開串流", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generation-events/123`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    // 未登入時不應查 job
    expect(getBackgroundJobMock).not.toHaveBeenCalled();
    server.close();
  });

  it("他人的 job（userId 不符）→ 403（IDOR 被擋）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getBackgroundJobMock.mockResolvedValue({ id: 123, userId: 999 });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generation-events/123`);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    server.close();
  });

  it("查無 job → 403", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getBackgroundJobMock.mockResolvedValue(undefined);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generation-events/123`);
    expect(res.status).toBe(403);
    server.close();
  });

  it("自己的 job → 200 開串流，含 connected 事件（合法流量不被擋）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getBackgroundJobMock.mockResolvedValue({ id: 123, userId: 1 });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generation-events/123`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const chunk = await readFirstChunk(res);
    expect(chunk).toContain('"type":"connected"');
    expect(chunk).toContain('"jobId":123');
    server.close();
  });
});

describe("SSE /api/model-training-events/:modelId — IDOR 修補", () => {
  it("非數字 modelId → 400（auth 不被呼叫）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/model-training-events/xyz`);
    expect(res.status).toBe(400);
    expect(authenticateRequestMock).not.toHaveBeenCalled();
    server.close();
  });

  it("未登入 → 401，且不開串流", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/model-training-events/456`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    expect(getFineTunedModelMock).not.toHaveBeenCalled();
    server.close();
  });

  it("他人的 model（userId 不符）→ 403（IDOR 被擋）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getFineTunedModelMock.mockResolvedValue({ id: 456, userId: 999 });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/model-training-events/456`);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    server.close();
  });

  it("查無 model → 403", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getFineTunedModelMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/model-training-events/456`);
    expect(res.status).toBe(403);
    server.close();
  });

  it("自己的 model → 200 開串流，含 connected 事件（合法流量不被擋）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    getFineTunedModelMock.mockResolvedValue({ id: 456, userId: 1 });
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/model-training-events/456`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const chunk = await readFirstChunk(res);
    expect(chunk).toContain('"type":"connected"');
    expect(chunk).toContain('"modelId":456');
    server.close();
  });
});
