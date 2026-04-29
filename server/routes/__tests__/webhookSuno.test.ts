/**
 * webhookSuno.test.ts — 驗證 Suno webhook 流程
 *
 * 涵蓋：
 *  - text / first 階段更新進度但不結束任務
 *  - complete 階段本地化 audio URL 並寫回 backgroundJob.resultJson
 *  - 缺 jobId 直接 drop
 *  - 缺 audio URL（生成失敗）標記 failed
 */

import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateBackgroundJobMock = vi.fn(async () => undefined);
const getBackgroundJobMock = vi.fn(async (id: number) => ({
  id,
  userId: 99,
  status: "processing",
  resultJson: {},
}));

vi.mock("../../db.js", () => ({
  getBackgroundJob: (...args: unknown[]) =>
    getBackgroundJobMock(...(args as [number])),
  updateBackgroundJob: (...args: unknown[]) =>
    updateBackgroundJobMock(...(args as [number, unknown])),
}));

vi.mock("../../services/internalMedia.js", () => ({
  localizeResultUrls: async (raw: unknown) => raw,
}));

import { sunoWebhookRouter } from "../webhookSuno";
import { generationBus } from "../../generationEvents";

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(sunoWebhookRouter);
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

describe("webhookSuno /api/webhook/suno", () => {
  beforeEach(() => {
    updateBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockResolvedValue(undefined);
    getBackgroundJobMock.mockReset();
    getBackgroundJobMock.mockResolvedValue({
      id: 5,
      userId: 99,
      status: "processing",
      resultJson: {},
    } as any);
  });

  it("complete 階段把 audio URL 寫回 backgroundJob 並推 SSE complete 事件", async () => {
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribe(5, e => events.push(e));
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/suno?jobId=5`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: 200,
        msg: "success",
        data: {
          task_id: "suno-abc",
          callbackType: "complete",
          data: [
            { id: "c1", audio_url: "https://suno/x.mp3", title: "T1", duration: 180 },
            { id: "c2", audio_url: "https://suno/y.mp3", title: "T2", duration: 180 },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    expect(updateBackgroundJobMock).toHaveBeenCalledTimes(1);
    const [jobId, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(jobId).toBe(5);
    expect(patch.status).toBe("completed");
    expect(patch.resultJson.audioUrl).toBe("https://suno/x.mp3");
    expect(patch.resultJson.clips).toHaveLength(2);
    expect(events).toEqual([{ type: "complete", thoughtChain: [] }]);
    unsubscribe();
    server.close();
  });

  it("text 階段只更新進度為 30，不結束任務", async () => {
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/suno?jobId=5`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { task_id: "suno-abc", callbackType: "text", data: [] },
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(patch.status).toBe("processing");
    expect(patch.progress).toBe(30);
    server.close();
  });

  it("complete 但無 audio URL 時標記為 failed", async () => {
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/suno?jobId=5`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: 500,
        msg: "credit insufficient",
        data: { task_id: "suno-abc", callbackType: "complete", data: [] },
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(patch.status).toBe("failed");
    expect(patch.errorMessage).toContain("credit insufficient");
    server.close();
  });

  it("缺 ?jobId 直接 drop（不打 DB）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/suno`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { task_id: "x", callbackType: "complete", data: [] },
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(updateBackgroundJobMock).not.toHaveBeenCalled();
    expect(getBackgroundJobMock).not.toHaveBeenCalled();
    server.close();
  });
});
