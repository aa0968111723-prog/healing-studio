/**
 * postGenActions.test.ts —
 *  - doPostGenComplete writes asset/history/log
 *  - runPostGenForJob runs once and respects postGenComplete idempotency flag
 *  - runPostGenForJob falls back to imageUrl/videoUrl when resultUrl missing
 *    (webhookFal only writes those, not the unified resultUrl)
 *  - unifiedAssetPrefix produces generated/studio/<userId>/<source>/<model>
 *    so director / image / video / pro studios all land under the same tree
 *  - doPostGenComplete honours dedupeMarker / parameterSnapshot / thumbnailUrl
 *    so imageStudio / videoStudio / proStudio's per-request dedupe still works
 *    after migrating off ad-hoc createDigitalAsset / createHistoryEntry
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createDigitalAssetMock = vi.fn(async () => 1);
const createHistoryEntryMock = vi.fn(async () => 1);
const getBackgroundJobMock = vi.fn();
const updateBackgroundJobMock = vi.fn(async () => undefined);
const refundUserPointsMock = vi.fn(async () => undefined);
// dedupe 前檢 — doPostGenComplete 會用 generation_history.compiledPrompt
// 做存在檢查；mock 預設回空陣列代表「沒查到 → 繼續寫入」。
const selectFromDedupeMock = vi.fn(async () => [] as Array<{ id: number }>);
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
  // doPostGenComplete 的 dedupe 前檢用 generation_history.compiledPrompt
  // 做 SELECT；mock object 隨意，drizzle-orm 比較會走 mocked and()/eq()。
  generationHistory: { id: "gh.id", userId: "gh.userId", compiledPrompt: "gh.cp" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}));

vi.mock("../brainAutoRepair", () => ({
  addGenerationLog: (...args: unknown[]) =>
    addGenerationLogMock(...(args as [unknown])),
}));

import {
  doPostGenComplete,
  runPostGenForJob,
  refundJobIfBilled,
  unifiedAssetPrefix,
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
    selectFromDedupeMock.mockReset();
    selectFromDedupeMock.mockResolvedValue([]);
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: selectFromDedupeMock,
          }),
        }),
      }),
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
    selectFromDedupeMock.mockReset();
    selectFromDedupeMock.mockResolvedValue([]);
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: selectFromDedupeMock,
          }),
        }),
      }),
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

describe("unifiedAssetPrefix", () => {
  it("emits generated/studio/<userId>/<source>/<sanitized-model>", () => {
    // 沿用 routers.ts checkStudioJob 的 sanitiser（保留 \w / - / /，其他全
    // 轉底線）— 點號 . 也屬於「其他」，會被轉成 _，避免在 S3 key 內混雜
    // 不同 sanitisation 策略。
    expect(
      unifiedAssetPrefix({
        userId: 42,
        source: "director",
        modelId: "fal-ai/kling-video/v2.1",
      })
    ).toBe("generated/studio/42/director/fal-ai/kling-video/v2_1");
  });

  it("strips path-unsafe chars from modelId (colons, dots, query strings)", () => {
    expect(
      unifiedAssetPrefix({
        userId: 7,
        source: "image",
        modelId: "fal-ai/flux:pro@v1.1?seed=1",
      })
    ).toBe("generated/studio/7/image/fal-ai/flux_pro_v1_1_seed_1");
  });

  it("omits modelId segment when not supplied (e.g. webhook with only jobId)", () => {
    expect(
      unifiedAssetPrefix({
        userId: 9,
        source: "webhook",
      })
    ).toBe("generated/studio/9/webhook");
  });

  it("inserts subfolder between source and model (gemini async case)", () => {
    expect(
      unifiedAssetPrefix({
        userId: 3,
        source: "creative",
        subfolder: "gemini-async",
        modelId: "imagen-3",
      })
    ).toBe("generated/studio/3/creative/gemini-async/imagen-3");
  });

  it("never lets two studios collide on a user's path tree", () => {
    // 同一個使用者、不同 source 必須產出不同前綴，否則「我的資產」
    // 反向掃描就會把導演 AI 跟 image studio 的成品混在一起。
    const userId = 100;
    const modelId = "fal-ai/nano-banana-pro";
    const prefixes = (
      ["director", "image", "video", "pro", "creative", "background", "webhook", "suno", "replicate"] as const
    ).map(source => unifiedAssetPrefix({ userId, source, modelId }));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    // 全部都在同一個使用者的命名空間下
    for (const p of prefixes) {
      expect(p.startsWith("generated/studio/100/")).toBe(true);
    }
  });
});

describe("doPostGenComplete with caller-supplied dedupe / parameter snapshot", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    addGenerationLogMock.mockReset();
    getDbMock.mockReset();
    selectFromDedupeMock.mockReset();
    selectFromDedupeMock.mockResolvedValue([]);
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: selectFromDedupeMock,
          }),
        }),
      }),
    });
  });

  it("uses dedupeMarker as compiledPrompt so per-request dedupe still works", async () => {
    // imageStudio / videoStudio / proStudio 都靠 compiledPrompt === dedupeMarker
    // 做下一輪輪詢的 short-circuit。dedupeMarker 不能被 promptText 吃掉。
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat",
      resultUrl: "https://cdn.example.com/result.png",
      sourceStudio: "image",
      dedupeMarker: "[imageStudio:fal-ai/nano-banana-2:req-abc]",
    });

    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.compiledPrompt).toBe(
      "[imageStudio:fal-ai/nano-banana-2:req-abc]"
    );
    // prompt 還是原本的提示詞，dedupeMarker 只覆寫 compiledPrompt
    expect(historyEntry.prompt).toBe("a cute cat");
  });

  it("merges caller's parameterSnapshot into the canonical {modelId, sourceStudio} shape", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling-video",
      prompt: "a cat dancing",
      resultUrl: "https://cdn.example.com/video.mp4",
      sourceStudio: "video",
      parameterSnapshot: {
        sourceStudio: "video", // caller can override; takes precedence
        requestId: "req-xyz",
        aspectRatio: "9:16",
      },
    });

    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const snapshot = historyEntry.parameterSnapshot as Record<string, unknown>;
    expect(snapshot.modelId).toBe("fal-ai/kling-video");
    expect(snapshot.sourceStudio).toBe("video");
    expect(snapshot.requestId).toBe("req-xyz");
    expect(snapshot.aspectRatio).toBe("9:16");
  });

  it("forwards thumbnailUrl + costCredits to both asset + history", async () => {
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      resultUrl: "https://cdn.example.com/result.png",
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      costCredits: 12,
    });

    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");

    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(historyEntry.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
    expect(historyEntry.costCredits).toBe(12);
  });

  it("writes sourceStudio + modelId + backgroundJobId into digital_asset_library (0047 migration)", async () => {
    // 0047 新增的來源追蹤欄位 — 讓「我的資產」可依工作室與 AI 模型分類，
    // 並反向連回 backgroundJobs 取得原始任務細節（fal request_id 等）。
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling-video/v2.1",
      prompt: "a cat dancing",
      resultUrl: "https://cdn.example.com/video.mp4",
      sourceStudio: "director",
      backgroundJobId: 999,
    });

    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.sourceStudio).toBe("director");
    expect(asset.modelId).toBe("fal-ai/kling-video/v2.1");
    expect(asset.backgroundJobId).toBe(999);

    // generation_history.parameterSnapshot 也應該帶 backgroundJobId
    // 讓歷史頁點選後能反向查到原始任務。
    const historyEntry = createHistoryEntryMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const snapshot = historyEntry.parameterSnapshot as Record<string, unknown>;
    expect(snapshot.backgroundJobId).toBe(999);
    expect(snapshot.modelId).toBe("fal-ai/kling-video/v2.1");
    expect(snapshot.sourceStudio).toBe("director");
  });

  it("nulls sourceStudio / modelId / backgroundJobId when caller doesn't supply them (back-compat)", async () => {
    // 舊呼叫端、手動上傳、未來不走 backgroundJob 的路徑都要能直接走
    // doPostGenComplete 而不違反 schema —— 三個欄位皆 nullable。
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      resultUrl: "https://cdn.example.com/x.png",
    });

    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.sourceStudio).toBeNull();
    expect(asset.backgroundJobId).toBeNull();
    // modelId 一律寫入（最多 MAX_MODEL_HINT_LENGTH 字元）
    expect(asset.modelId).toBe("fal-ai/nano-banana-2");
  });

  it("propagates jobId into doPostGenComplete via runPostGenForJob", async () => {
    // runPostGenForJob 必須把 jobId 透傳給 doPostGenComplete，否則資產庫
    // 的 backgroundJobId 永遠是 null，使用者點開歷史也無從追蹤。
    getBackgroundJobMock.mockResolvedValueOnce({
      id: 4242,
      userId: 7,
      jobType: "image",
      status: "completed",
      resultJson: {
        studioType: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat",
        resultUrl: "https://cdn.example.com/x.png",
        sourceStudio: "director",
      },
    });

    const ran = await runPostGenForJob(4242);
    expect(ran).toBe(true);

    const asset = createDigitalAssetMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(asset.backgroundJobId).toBe(4242);
    expect(asset.sourceStudio).toBe("director");
  });
});

describe("doPostGenComplete dedupe pre-check (Codex P1 review fix)", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    addGenerationLogMock.mockReset();
    selectFromDedupeMock.mockReset();
    getDbMock.mockReset();
    getDbMock.mockReturnValue({
      insert: () => ({ values: insertMock }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: selectFromDedupeMock,
          }),
        }),
      }),
    });
  });

  it("short-circuits writes when dedupeMarker already exists in generation_history", async () => {
    // imageStudio / videoStudio / proStudio 都是輪詢端點，每 3 秒會打一次；
    // 命中 COMPLETED 就會呼叫 doPostGenComplete。沒有前檢就會每輪重複寫
    // generation_history + digital_asset_library + promptLibrary + monitoring。
    // dedupeMarker 命中時整個 post-gen 流程都應跳過。
    selectFromDedupeMock.mockResolvedValueOnce([{ id: 999 }]); // 既有紀錄

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat",
      resultUrl: "https://cdn.example.com/x.png",
      sourceStudio: "image",
      dedupeMarker: "[imageStudio:fal-ai/nano-banana-2:req-abc]",
    });

    // 所有寫入路徑都應 short-circuit
    expect(createDigitalAssetMock).not.toHaveBeenCalled();
    expect(createHistoryEntryMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled(); // promptLibrary
    expect(addGenerationLogMock).not.toHaveBeenCalled(); // monitoring
  });

  it("proceeds with all writes when dedupeMarker not yet stored (first poll hit)", async () => {
    selectFromDedupeMock.mockResolvedValueOnce([]); // 沒有既有紀錄

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat",
      resultUrl: "https://cdn.example.com/x.png",
      sourceStudio: "image",
      dedupeMarker: "[imageStudio:fal-ai/nano-banana-2:req-abc]",
    });

    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
  });

  it("never queries dedupe when caller does not pass dedupeMarker", async () => {
    // creative sync / director / runPostGenForJob 等不靠 dedupeMarker
    // （靠 backgroundJob.resultJson.postGenComplete 旗標）的路徑，
    // dedupe 查詢不該被觸發，避免額外 DB round-trip。
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      resultUrl: "https://cdn.example.com/x.png",
    });

    expect(selectFromDedupeMock).not.toHaveBeenCalled();
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to writes when dedupe query throws (best-effort, never blocks)", async () => {
    // 如果 dedupe 查詢失敗（DB 暫時不可用、schema 不存在等），不應該
    // 因此卡住主流程 — 寧可偶爾重複一筆，也不要完全沒寫。
    selectFromDedupeMock.mockRejectedValueOnce(new Error("DB down"));

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      resultUrl: "https://cdn.example.com/x.png",
      dedupeMarker: "[imageStudio:fal-ai/nano-banana-2:req-abc]",
    });

    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
  });
});
