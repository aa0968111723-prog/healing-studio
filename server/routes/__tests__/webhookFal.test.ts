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
const runPostGenForJobMock = vi.fn(async () => true);

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

vi.mock("../../services/postGenActions.js", () => ({
  runPostGenForJob: (...args: unknown[]) =>
    runPostGenForJobMock(...(args as [number])),
}));

import { falWebhookRouter } from "../webhookFal";
import { generationBus } from "../../generationEvents";

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
    runPostGenForJobMock.mockReset();
    runPostGenForJobMock.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.FAL_WEBHOOK_SECRET;
  });

  it("以 query string ?jobId 命中 backgroundJob 並標記 completed + 推 SSE", async () => {
    // 模擬 submitStudioJob 寫進去的 meta（studioType / modelId / prompt / label）
    // 一定要保留，後續 runPostGenForJob 才能反查使用者語意。
    getBackgroundJobMock.mockResolvedValue({
      id: 42,
      userId: 99,
      status: "processing",
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat",
        label: "🖼️ Nano Banana",
        requestId: "fal-uuid-abc",
      },
    } as any);
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribe(42, e => events.push(e));
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
    // 既有 meta 必須保留（studioType / modelId / prompt / label）
    const resultJson = patch.resultJson as Record<string, unknown>;
    expect(resultJson.studioType).toBe("image");
    expect(resultJson.modelId).toBe("fal-ai/nano-banana-2");
    expect(resultJson.prompt).toBe("a cute cat");
    expect(resultJson.label).toBe("🖼️ Nano Banana");
    // 也要把萃取到的 imageUrl 補上 + 統一鍵名 resultUrl
    expect(resultJson.imageUrl).toBe("https://fal.media/x.png");
    expect(resultJson.resultUrl).toBe("https://fal.media/x.png");
    // SSE 事件
    expect(events).toEqual([{ type: "complete", thoughtChain: [] }]);
    // 後置動作（資產庫/歷史/監控）必須被觸發 — 這是這次修復的核心
    expect(runPostGenForJobMock).toHaveBeenCalledWith(42);
    unsubscribe();
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

  it("status=ERROR 時把 backgroundJob 標記為 failed 並推 SSE error 事件", async () => {
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribe(42, e => events.push(e));
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
    expect(events).toEqual([{ type: "error", message: "model_blew_up" }]);
    unsubscribe();
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

  it("從實際 fal.ai webhook 的 nested payload.payload 也能萃取出 image_url", async () => {
    // fal.ai 真正的格式把 model output 包在 payload.payload，而非 top-level；
    // 沒這層相容會讓 job 標 completed 但 resultUrl 為空,前端持續顯示處理中
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/fal?jobId=42`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-uuid-xyz",
        status: "OK",
        payload: {
          images: [{ url: "https://fal.media/nested.png" }],
        },
      }),
    });
    await new Promise(r => setTimeout(r, 30));
    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("completed");
    const resultJson = patch.resultJson as Record<string, unknown>;
    expect(resultJson.imageUrl).toBe("https://fal.media/nested.png");
    expect(resultJson.mediaType).toBe("image");
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

  it("Kling 影片 webhook：nested payload.payload.video.url 也能萃取 videoUrl + resultUrl", async () => {
    // 真實 fal.ai Kling Pro i2v webhook shape:
    //   { request_id, status, payload: { video: { url, content_type, ... } } }
    // 過去 extractResultData 只 cover 兩層,卻沒處理 nested payload.video.url
    // 跟 root 兩種同時齊備的情況。改用 extractFalMediaUrl 後一律過。
    getBackgroundJobMock.mockResolvedValue({
      id: 99,
      userId: 7,
      status: "processing",
      resultJson: {
        studioType: "video",
        modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
        prompt: "a healing forest",
        label: "Kling Pro 圖生影",
        requestId: "fal-kling-uuid",
      },
    } as any);
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribe(99, e => events.push(e));
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/fal?jobId=99`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-kling-uuid",
        status: "OK",
        payload: {
          video: {
            url: "https://fal.media/files/abc/out.mp4",
            content_type: "video/mp4",
            file_size: 1234567,
          },
        },
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("completed");
    const resultJson = patch.resultJson as Record<string, unknown>;
    expect(resultJson.videoUrl).toBe("https://fal.media/files/abc/out.mp4");
    expect(resultJson.resultUrl).toBe("https://fal.media/files/abc/out.mp4");
    // 既有 meta 必須保留
    expect(resultJson.label).toBe("Kling Pro 圖生影");
    expect(resultJson.modelId).toBe(
      "fal-ai/kling-video/v2.1/pro/image-to-video"
    );
    // SSE complete 事件
    expect(events).toEqual([{ type: "complete", thoughtChain: [] }]);
    expect(runPostGenForJobMock).toHaveBeenCalledWith(99);
    unsubscribe();
    server.close();
  });

  it("OK 但完全沒任何 URL：改標 failed,讓 UI 顯示需重試而不是無預覽空卡", async () => {
    // 回歸測試:過去這條路會把 job 標 completed 但 resultUrl 為 undefined,
    // 使用者「成品輸出庫」就會看到一張無預覽無下載的空白卡片永遠卡著。
    getBackgroundJobMock.mockResolvedValue({
      id: 55,
      userId: 7,
      status: "processing",
      resultJson: {
        studioType: "video",
        modelId: "fal-ai/some-video/model",
        prompt: "test",
        label: "Test",
        requestId: "fal-malformed",
      },
    } as any);
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribe(55, e => events.push(e));
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/fal?jobId=55`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "fal-malformed",
        status: "OK",
        payload: { something_unknown: true },
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateBackgroundJobMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(patch.status).toBe("failed");
    expect(patch.errorMessage).toContain("無法解析結果連結");
    // SSE 必須推 error 事件,前端才知道要顯示失敗
    expect(events.length).toBe(1);
    expect((events[0] as { type: string }).type).toBe("error");
    // 沒 URL 時不應該觸發後置動作（資產庫/歷史/提示詞庫）
    expect(runPostGenForJobMock).not.toHaveBeenCalled();
    unsubscribe();
    server.close();
  });
});
