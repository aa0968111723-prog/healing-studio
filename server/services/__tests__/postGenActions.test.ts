/**
 * postGenActions.test.ts —
 *  - doPostGenComplete writes asset/history/log
 *  - runPostGenForJob runs once and respects postGenComplete idempotency flag
 *  - runPostGenForJob falls back to imageUrl/videoUrl when resultUrl missing
 *    (webhookFal only writes those, not the unified resultUrl)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createDigitalAssetMock = vi.fn(async () => 1);
const createHistoryEntryMock = vi.fn(async () => 1);
const getBackgroundJobMock = vi.fn();
const updateBackgroundJobMock = vi.fn(async () => undefined);
const refundUserPointsMock = vi.fn(async () => undefined);
const insertMock = vi.fn(async () => undefined);
const getDbMock = vi.fn();
const addGenerationLogMock = vi.fn();

vi.mock("../../db", () => ({
  createDigitalAsset: (...args: unknown[]) =>
    createDigitalAssetMock(...(args as [unknown])),
  createHistoryEntry: (...args: unknown[]) =>
    createHistoryEntryMock(...(args as [unknown])),
  getBackgroundJob: (...args: unknown[]) =>
    getBackgroundJobMock(...(args as [number])),
  updateBackgroundJob: (...args: unknown[]) =>
    updateBackgroundJobMock(...(args as [number, unknown])),
  refundUserPoints: (...args: unknown[]) =>
    refundUserPointsMock(...(args as [number, number])),
  getDb: () => getDbMock(),
}));

vi.mock("../../../drizzle/schema", () => ({
  promptLibrary: { __mocked: true },
}));

vi.mock("../brainAutoRepair", () => ({
  addGenerationLog: (...args: unknown[]) =>
    addGenerationLogMock(...(args as [unknown])),
}));

import {
  doPostGenComplete,
  runPostGenForJob,
  refundJobIfBilled,
} from "../postGenActions";

describe("doPostGenComplete", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    addGenerationLogMock.mockReset();
    getDbMock.mockReset();
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
    });
  });

  it("writes to digital asset library, history, and AI monitoring on success", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/result.png",
      label: "🖼️ Nano Banana",
      sourceStudio: "image",
    });

    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.userId).toBe(7);
    expect(asset.assetType).toBe("image");
    expect(asset.fileUrl).toBe("https://cdn.example.com/result.png");

    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.userId).toBe(7);
    expect(historyEntry.modality).toBe("image");
    expect(historyEntry.resultUrl).toBe("https://cdn.example.com/result.png");
    // 在 parameterSnapshot 內帶 modelId，前端歷史 panel 才能反向 map 模型
    expect(
      (historyEntry.parameterSnapshot as Record<string, unknown>).modelId
    ).toBe("fal-ai/nano-banana-2");

    expect(addGenerationLogMock).toHaveBeenCalledTimes(1);
    const log = addGenerationLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(log.success).toBe(true);
    expect(log.sourceStudio).toBe("image");

    // 提示詞 ≥ 4 字元才寫入提示詞庫
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("does not insert history/asset if resultUrl is missing", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat",
      resultUrl: undefined,
    });

    expect(createDigitalAssetMock).not.toHaveBeenCalled();
    expect(createHistoryEntryMock).not.toHaveBeenCalled();
    // 監控仍記錄（成功=false）
    expect(addGenerationLogMock).toHaveBeenCalledTimes(1);
    const log = addGenerationLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(log.success).toBe(false);
  });

  it("records actual costCredits in history when provided", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling-video/v2.1/pro",
      prompt: "ocean waves at sunset",
      resultUrl: "https://cdn.example.com/result.mp4",
      costCredits: 42,
    });

    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.costCredits).toBe(42);
  });

  it("defaults costCredits to 1 when not provided (backward compat)", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cat",
      resultUrl: "https://cdn.example.com/result.png",
    });

    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.costCredits).toBe(1);
  });

  it("swallows DB errors so generation flow is not blocked", async () => {
    createDigitalAssetMock.mockRejectedValueOnce(new Error("DB exploded"));
    createHistoryEntryMock.mockRejectedValueOnce(new Error("Also exploded"));

    await expect(
      doPostGenComplete({
        userId: 7,
        modality: "image",
        modelId: "fal-ai/nano-banana-2",
        resultUrl: "https://cdn.example.com/result.png",
      })
    ).resolves.toBeUndefined();
  });
});

describe("runPostGenForJob", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    addGenerationLogMock.mockReset();
    getBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockResolvedValue(undefined);
    refundUserPointsMock.mockReset();
    refundUserPointsMock.mockResolvedValue(undefined);
    getDbMock.mockReset();
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs post-gen actions and sets postGenComplete flag on first call", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 42,
      userId: 7,
      jobType: "image",
      status: "completed",
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat",
        resultUrl: "https://cdn.example.com/result.png",
        label: "🖼️ Nano Banana",
      },
    });

    const ran = await runPostGenForJob(42);
    expect(ran).toBe(true);
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);

    expect(updateBackgroundJobMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        resultJson: expect.objectContaining({ postGenComplete: true }),
      })
    );
  });

  it("short-circuits when postGenComplete flag is already set (idempotent)", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 42,
      userId: 7,
      jobType: "image",
      status: "completed",
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat",
        resultUrl: "https://cdn.example.com/result.png",
        postGenComplete: true,
      },
    });

    const ran = await runPostGenForJob(42);
    expect(ran).toBe(false);
    expect(createDigitalAssetMock).not.toHaveBeenCalled();
    expect(createHistoryEntryMock).not.toHaveBeenCalled();
    expect(updateBackgroundJobMock).not.toHaveBeenCalled();
  });

  it("falls back to imageUrl when resultUrl is missing (webhook payload)", async () => {
    // webhookFal writes imageUrl (extracted from fal payload) rather than
    // resultUrl. runPostGenForJob must accept either.
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 99,
      userId: 7,
      jobType: "image",
      status: "completed",
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat",
        imageUrl: "https://cdn.example.com/from-webhook.png",
        mediaType: "image",
      },
    });

    const ran = await runPostGenForJob(99);
    expect(ran).toBe(true);
    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.fileUrl).toBe("https://cdn.example.com/from-webhook.png");
  });

  it("returns false when job is missing", async () => {
    getBackgroundJobMock.mockResolvedValueOnce(null);
    const ran = await runPostGenForJob(0);
    expect(ran).toBe(false);
    expect(createDigitalAssetMock).not.toHaveBeenCalled();
  });

  it("passes meta.costPoints through to history.costCredits", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 77,
      userId: 7,
      jobType: "video",
      status: "completed",
      resultJson: {
        studioType: "video",
        modelId: "fal-ai/kling-video/v2.1/pro",
        prompt: "ocean waves",
        resultUrl: "https://cdn.example.com/video.mp4",
        costPoints: 35,
      },
    });

    const ran = await runPostGenForJob(77);
    expect(ran).toBe(true);
    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.costCredits).toBe(35);
  });
});

describe("refundJobIfBilled", () => {
  beforeEach(() => {
    refundUserPointsMock.mockReset();
    refundUserPointsMock.mockResolvedValue(undefined);
    getBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockReset();
    updateBackgroundJobMock.mockResolvedValue(undefined);
  });

  it("refunds the costPoints amount and sets refunded flag", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 42,
      userId: 7,
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/flux-pro/v1.1",
        costPoints: 12,
      },
    });

    const refunded = await refundJobIfBilled(42);
    expect(refunded).toBe(true);
    expect(refundUserPointsMock).toHaveBeenCalledWith(7, 12);
    expect(updateBackgroundJobMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        resultJson: expect.objectContaining({
          refunded: true,
          refundedPoints: 12,
        }),
      })
    );
  });

  it("short-circuits when already refunded (idempotent across webhook + polling)", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 42,
      userId: 7,
      resultJson: {
        costPoints: 12,
        refunded: true,
        refundedPoints: 12,
      },
    });

    const refunded = await refundJobIfBilled(42);
    expect(refunded).toBe(false);
    expect(refundUserPointsMock).not.toHaveBeenCalled();
  });

  it("no-ops when costPoints is missing (legacy jobs created before the fix)", async () => {
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 42,
      userId: 7,
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/flux-pro/v1.1",
      },
    });

    const refunded = await refundJobIfBilled(42);
    expect(refunded).toBe(false);
    expect(refundUserPointsMock).not.toHaveBeenCalled();
  });

  it("no-ops when job is missing", async () => {
    getBackgroundJobMock.mockResolvedValueOnce(null);
    const refunded = await refundJobIfBilled(0);
    expect(refunded).toBe(false);
    expect(refundUserPointsMock).not.toHaveBeenCalled();
  });
});
