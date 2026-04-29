/**
 * webhookFal.test.ts — 驗證 fal.ai webhook 真的能找到並更新 backgroundJob
 *
 * 涵蓋：
 *  - ?jobId=<id> query string 直接命中
 *  - 沒帶 jobId 時透過 payload.request_id 反查 resultJson.requestId
 *  - 完成 / 失敗 / 進行中三種 status 走不同更新分支
 */

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── 蹲住 db 與 internalMedia 模組（避免真的去 S3 / DB） ─────────────
const updateBackgroundJobMock = vi.fn(async () => undefined);
const getBackgroundJobMock = vi.fn(async (id: number) => ({
  id,
  userId: 99,
  status: "processing",
  resultJson: {},
}));
const findProcessingJobByRequestIdMock = vi.fn();

vi.mock("../../db.js", () => ({
  getBackgroundJob: (...args: unknown[]) => getBackgroundJobMock(...(args as [number])),
  updateBackgroundJob: (...args: unknown[]) =>
    updateBackgroundJobMock(...(args as [number, unknown])),
  findProcessingJobByRequestId: (...args: unknown[]) =>
    findProcessingJobByRequestIdMock(...(args as [string])),
}));

vi.mock("../../services/internalMedia.js", () => ({
  // 直接回原物件，不打 S3
  localizeResultUrls: async (raw: unknown) => raw,
}));

import { falWebhookRouter } from "../webhookFal";

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(falWebhookRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Failed to bind test server");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("webhookFal /api/webhook/fal", () => {
  beforeEach(() => {
    updateBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockResolvedValue(undefined);
    getBackgroundJobMock.mockReset();
    getBackgroundJobMock.mockResolvedValue({
      id: 42,
      userId: 99,
      status: "processing",
      resultJson: {},
    } as any);
    findProcessingJobByRequestIdMock.mockReset();
    findProcessingJobByRequestIdMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.FAL_WEBHOOK_SECRET;
  });

  it("以 query string ?jobId 命中 backgroundJob 並標記 completed", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/fal?jobId=42`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-uuid-abc",
        status: "OK",
        images: [{ url: "https://fal.media/x.png" }],
      }),
    });
    expect(res.status).toBe(200);
    // 等微小事件循環確保 setTimeout/async 處理完成
    await new Promise(r => setTimeout(r, 30));

    expect(getBackgroundJobMock).toHaveBeenCalledWith(42);
    expect(updateBackgroundJobMock).toHaveBeenCalledTimes(1);
    const [jobId, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(jobId).toBe(42);
    expect(patch.status).toBe("completed");
    expect(patch.progress).toBe(100);
    server.close();
  });

  it("沒帶 jobId 時用 request_id 反查 resultJson.requestId", async () => {
    findProcessingJobByRequestIdMock.mockResolvedValue({
      id: 77,
      userId: 50,
      status: "processing",
      resultJson: { requestId: "fal-real-uuid" },
    } as any);
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/fal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-real-uuid",
        status: "COMPLETED",
        video: { url: "https://fal.media/v.mp4" },
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    expect(findProcessingJobByRequestIdMock).toHaveBeenCalledWith("fal-real-uuid");
    expect(updateBackgroundJobMock).toHaveBeenCalledTimes(1);
    const [jobId, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(jobId).toBe(77);
    expect(patch.status).toBe("completed");
    server.close();
  });

  it("status=ERROR 時把 backgroundJob 標記為 failed 並帶 errorMessage", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/fal?jobId=42`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-uuid",
        status: "ERROR",
        error: "model_blew_up",
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("failed");
    expect(patch.errorMessage).toBe("model_blew_up");
    server.close();
  });

  it("IN_PROGRESS / IN_QUEUE 只更新進度而不結束任務", async () => {
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/fal?jobId=42`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-uuid",
        status: "IN_PROGRESS",
      }),
    });
    await new Promise(r => setTimeout(r, 30));
    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("processing");
    expect(patch.progress).toBe(50);
    server.close();
  });

  it("既無 jobId 也找不到對應 requestId 時直接 drop（不更新 DB）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/fal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "stray-uuid",
        status: "OK",
        images: [{ url: "https://fal.media/x.png" }],
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    expect(findProcessingJobByRequestIdMock).toHaveBeenCalledWith("stray-uuid");
    expect(updateBackgroundJobMock).not.toHaveBeenCalled();
    server.close();
  });
});
