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
const runPostGenForJobMock = vi.fn(async () => true);
const refundJobIfBilledMock = vi.fn(async () => false);

vi.mock("../../db.js", () => ({
  getBackgroundJob: (...args: unknown[]) =>
    getBackgroundJobMock(...(args as [number])),
  updateBackgroundJob: (...args: unknown[]) =>
    updateBackgroundJobMock(...(args as [number, unknown])),
}));

vi.mock("../../services/internalMedia.js", () => ({
  localizeResultUrls: async (raw: unknown) => raw,
}));

vi.mock("../../services/postGenActions.js", () => ({
  runPostGenForJob: (...args: unknown[]) =>
    runPostGenForJobMock(...(args as [number])),
  refundJobIfBilled: (...args: unknown[]) =>
    refundJobIfBilledMock(...(args as [number])),
  // 真實 handler 會呼叫 unifiedAssetPrefix 組統一前綴；mock 模組必須一併提供，
  // 否則 complete 成功路徑會丟 TypeError（被 try/catch 吞掉）→ updateBackgroundJob
  // 永遠不會被呼叫，導致這兩個 complete 測試假性失敗。
  unifiedAssetPrefix: (opts: { userId: number; source: string; modelId: string }) =>
    `generated/studio/${opts.userId}/${opts.source}/${opts.modelId}`,
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
    runPostGenForJobMock.mockReset();
    runPostGenForJobMock.mockResolvedValue(true);
    refundJobIfBilledMock.mockReset();
    refundJobIfBilledMock.mockResolvedValue(false);
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
    // resultUrl 用統一鍵名供下游 runPostGenForJob 讀取
    expect(patch.resultJson.resultUrl).toBe("https://suno/x.mp3");
    expect(patch.resultJson.clips).toHaveLength(2);
    expect(events).toEqual([{ type: "complete", thoughtChain: [] }]);
    unsubscribe();
    server.close();
  });

  it("complete 階段保留既有 meta 並觸發 runPostGenForJob（資產庫/歷史持久化）", async () => {
    // 模擬 proStudio.generateMusicSuno 寫入的識別資訊
    getBackgroundJobMock.mockResolvedValue({
      id: 5,
      userId: 99,
      status: "processing",
      resultJson: {
        studioType: "audio",
        modelId: "suno-v3.5",
        prompt: "lo-fi 治癒夜雨",
        sourceStudio: "music-studio",
        sunoTaskId: "suno-abc",
      },
    } as any);

    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/suno?jobId=5`, {
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
          ],
        },
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    // 既有 meta 必須保留（不能被 webhook 覆寫掉）
    expect(patch.resultJson.studioType).toBe("audio");
    expect(patch.resultJson.modelId).toBe("suno-v3.5");
    expect(patch.resultJson.prompt).toBe("lo-fi 治癒夜雨");
    expect(patch.resultJson.sourceStudio).toBe("music-studio");
    // 並且觸發資產庫/歷史持久化
    expect(runPostGenForJobMock).toHaveBeenCalledWith(5);
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
    // 失敗不該觸發資產庫寫入
    expect(runPostGenForJobMock).not.toHaveBeenCalled();
    // Suno 未回 audio URL → 必須退回 chargeForFalTask 預扣的點數
    expect(refundJobIfBilledMock).toHaveBeenCalledWith(5);
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
