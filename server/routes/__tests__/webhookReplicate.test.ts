/**
 * webhookReplicate.test.ts — 驗證 Replicate 訓練 webhook 流程
 *
 * 涵蓋：
 *  - succeeded → status=ready，把 weights URL 寫到 trainedLoraUrl
 *  - failed → status=failed
 *  - canceled → status=failed
 *  - 中間狀態（starting/processing）不更新 DB
 *  - 缺 modelId 直接 drop
 */

import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateFineTunedModelMock = vi.fn(async () => undefined);
const getFineTunedModelMock = vi.fn(async (id: number) => ({
  id,
  userId: 99,
  status: "training",
  configJson: { triggerWord: "xyz" },
}));

vi.mock("../../db.js", () => ({
  getFineTunedModel: (...args: unknown[]) =>
    getFineTunedModelMock(...(args as [number])),
  updateFineTunedModel: (...args: unknown[]) =>
    updateFineTunedModelMock(...(args as [number, unknown])),
}));

import { replicateWebhookRouter } from "../webhookReplicate";
import { generationBus } from "../../generationEvents";

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(replicateWebhookRouter);
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

describe("webhookReplicate /api/webhook/replicate", () => {
  beforeEach(() => {
    updateFineTunedModelMock.mockReset();
    updateFineTunedModelMock.mockResolvedValue(undefined);
    getFineTunedModelMock.mockReset();
    getFineTunedModelMock.mockResolvedValue({
      id: 11,
      userId: 99,
      status: "training",
      configJson: { triggerWord: "xyz" },
    } as any);
  });

  it("succeeded 時把 status 改 ready、寫 trainedLoraUrl、推 SSE complete", async () => {
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribeTraining(11, e => events.push(e));
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/replicate?modelId=11`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rep-train-xyz",
        status: "succeeded",
        output: { weights: "https://replicate.delivery/lora.safetensors" },
        completed_at: "2026-04-29T10:00:00Z",
      }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));

    expect(updateFineTunedModelMock).toHaveBeenCalledTimes(1);
    const [modelId, patch] = updateFineTunedModelMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(modelId).toBe(11);
    expect(patch.status).toBe("ready");
    expect(patch.trainedLoraUrl).toBe(
      "https://replicate.delivery/lora.safetensors"
    );
    expect(patch.replicatePredictionId).toBe("rep-train-xyz");
    expect(patch.configJson.triggerWord).toBe("xyz"); // 保留既有 config
    expect(events).toEqual([{ type: "complete", thoughtChain: [] }]);
    unsubscribe();
    server.close();
  });

  it("failed 時標記為 failed 並推 SSE error", async () => {
    const events: unknown[] = [];
    const unsubscribe = generationBus.subscribeTraining(11, e => events.push(e));
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/replicate?modelId=11`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rep-train-xyz",
        status: "failed",
        error: "OOM during training step 480",
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateFineTunedModelMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(patch.status).toBe("failed");
    expect(events).toEqual([
      { type: "error", message: "OOM during training step 480" },
    ]);
    unsubscribe();
    server.close();
  });

  it("canceled 時也標記為 failed", async () => {
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/replicate?modelId=11`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "rep-train-xyz",
        status: "canceled",
      }),
    });
    await new Promise(r => setTimeout(r, 30));

    const [, patch] = updateFineTunedModelMock.mock.calls[0] as [
      number,
      Record<string, any>,
    ];
    expect(patch.status).toBe("failed");
    server.close();
  });

  it("中間狀態 processing 不更新 DB（避免覆蓋 training 狀態）", async () => {
    const { server, baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/webhook/replicate?modelId=11`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "rep-train-xyz", status: "processing" }),
    });
    await new Promise(r => setTimeout(r, 30));
    expect(updateFineTunedModelMock).not.toHaveBeenCalled();
    server.close();
  });

  it("缺 ?modelId 直接 drop（不打 DB）", async () => {
    const { server, baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/webhook/replicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", status: "succeeded", output: "u" }),
    });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(updateFineTunedModelMock).not.toHaveBeenCalled();
    server.close();
  });
});
