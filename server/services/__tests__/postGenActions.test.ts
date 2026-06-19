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
const createPromptAssetLinkMock = vi.fn(async () => 1);
const getBackgroundJobMock = vi.fn();
const updateBackgroundJobMock = vi.fn(async () => undefined);
const refundUserPointsMock = vi.fn(async () => undefined);
// dedupe 前檢 — doPostGenComplete 會用 generation_history.compiledPrompt
// 做存在檢查；mock 預設回空陣列代表「沒查到 → 繼續寫入」。
// 鏈形狀：select().from().where().limit()（無 orderBy）。
const selectFromDedupeMock = vi.fn(async () => [] as Array<{ id: number }>);
// AIDV-10 upsert-by-content 查既有 prompt_library 列 —
// 鏈形狀：select().from().where().orderBy().limit()（有 orderBy）。
// mock 預設回空陣列代表「沒查到 → 走 insert」。
const selectPromptMock = vi.fn(async () => [] as Array<{ id: number }>);
const insertMock = vi.fn(async () => undefined);
const getDbMock = vi.fn();

// 共用的 getDb() mock 工廠：
//   - dedupe 前檢走 where().limit()（直接命中 selectFromDedupeMock）
//   - upsert 查詢走 where().orderBy().limit()（命中 selectPromptMock）
// 兩條 select 用「有沒有 orderBy」區分，與生產程式碼一致。
function makeDbMock() {
  return {
    insert: () => ({ values: insertMock }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectFromDedupeMock,
          orderBy: () => ({ limit: selectPromptMock }),
        }),
      }),
    }),
  };
}
const addGenerationLogMock = vi.fn();

vi.mock("../../db", () => ({
  createDigitalAsset: (...args: unknown[]) =>
    createDigitalAssetMock(...(args as [unknown])),
  createHistoryEntry: (...args: unknown[]) =>
    createHistoryEntryMock(...(args as [unknown])),
  createPromptAssetLink: (...args: unknown[]) =>
    createPromptAssetLinkMock(...(args as [unknown])),
  getBackgroundJob: (...args: unknown[]) =>
    getBackgroundJobMock(...(args as [number])),
  updateBackgroundJob: (...args: unknown[]) =>
    updateBackgroundJobMock(...(args as [number, unknown])),
  refundUserPoints: (...args: unknown[]) =>
    refundUserPointsMock(...(args as [number, number])),
  getDb: () => getDbMock(),
}));

vi.mock("../../../drizzle/schema", () => ({
  // AIDV-10 upsert 查詢用到 promptLibrary.id / userId / category / content。
  promptLibrary: {
    __mocked: true,
    id: "pl.id",
    userId: "pl.userId",
    category: "pl.category",
    content: "pl.content",
  },
  // doPostGenComplete 的 dedupe 前檢用 generation_history.compiledPrompt
  // 做 SELECT；mock object 隨意，drizzle-orm 比較會走 mocked and()/eq()。
  generationHistory: { id: "gh.id", userId: "gh.userId", compiledPrompt: "gh.cp" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  asc: (col: unknown) => ({ __asc: col }),
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
  findOrCreatePromptByContent,
} from "../postGenActions";

describe("doPostGenComplete", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    createPromptAssetLinkMock.mockReset();
    createPromptAssetLinkMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    addGenerationLogMock.mockReset();
    getDbMock.mockReset();
    selectFromDedupeMock.mockReset();
    selectFromDedupeMock.mockResolvedValue([]);
    getDbMock.mockReturnValue(makeDbMock());
    delete process.env.ENABLE_PROMPT_ASSET_LINKS;
  });

  afterEach(() => {
    delete process.env.ENABLE_PROMPT_ASSET_LINKS;
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

  it("links prompt to asset when ENABLE_PROMPT_ASSET_LINKS is on", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    // mysql2 driver 形狀：[ResultSetHeader]；prompt_library 寫入回 insertId=55
    insertMock.mockResolvedValue([{ insertId: 55 }] as never);
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/result.png",
    });

    expect(createPromptAssetLinkMock).toHaveBeenCalledTimes(1);
    expect(createPromptAssetLinkMock).toHaveBeenCalledWith({
      promptId: 55,
      assetId: 99,
      relation: "derived",
    });
  });

  it("writes the caller-provided relation (variant) instead of the default derived", async () => {
    // AIDV-9：座艙重骰/改寫/延長要帶 variant/rewrite/extended。預設仍 derived。
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    insertMock.mockResolvedValue([{ insertId: 55 }] as never);
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling-video/v2.1",
      prompt: "ocean waves at sunset — re-rolled variant",
      resultUrl: "https://cdn.example.com/variant.mp4",
      relation: "variant",
    });

    expect(createPromptAssetLinkMock).toHaveBeenCalledTimes(1);
    expect(createPromptAssetLinkMock).toHaveBeenCalledWith({
      promptId: 55,
      assetId: 99,
      relation: "variant",
    });
  });

  it("does NOT link when the flag is off (default) even with both ids available", async () => {
    // 旗標未設（預設 OFF）
    insertMock.mockResolvedValue([{ insertId: 55 }] as never);
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/result.png",
    });

    expect(createPromptAssetLinkMock).not.toHaveBeenCalled();
    // 既有寫入不受影響
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
  });

  it("skips the link when the prompt is too short for the library (no promptId)", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "猫", // < MIN_PROMPT_LENGTH_FOR_LIBRARY → 不進提示詞庫 → 無 promptId
      resultUrl: "https://cdn.example.com/result.png",
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(createPromptAssetLinkMock).not.toHaveBeenCalled();
    // 資產照常寫入
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
  });

  it("link failure is swallowed and does not break history/log writes", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    insertMock.mockResolvedValue([{ insertId: 55 }] as never);
    createDigitalAssetMock.mockResolvedValue(99);
    createPromptAssetLinkMock.mockRejectedValue(new Error("FK violation"));

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/result.png",
    });

    expect(createPromptAssetLinkMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
    expect(addGenerationLogMock).toHaveBeenCalledTimes(1);
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
    getDbMock.mockReturnValue(makeDbMock());
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
    getDbMock.mockReturnValue(makeDbMock());
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
    getDbMock.mockReturnValue(makeDbMock());
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

// ════════════════════════════════════════════════════════════════════════
// AIDV-10 — prompt_library upsert-by-content 去重
// ════════════════════════════════════════════════════════════════════════

describe("findOrCreatePromptByContent (AIDV-10 pure helper)", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue([{ insertId: 100 }]);
    selectPromptMock.mockReset();
    selectPromptMock.mockResolvedValue([]);
  });

  const baseParams = {
    userId: 7,
    content: "a cute cat sitting on the moon",
    category: "image" as const,
    title: "a cute cat sitting on the moon",
    modelHint: "fal-ai/nano-banana-2",
  };

  it("C1 命中既有列 → 重用既有 id，完全不 insert", async () => {
    selectPromptMock.mockResolvedValueOnce([{ id: 42 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      ...baseParams,
    });

    expect(id).toBe(42);
    expect(insertMock).not.toHaveBeenCalled();
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
  });

  it("C2 未命中 → insert 新列，回傳 insertId", async () => {
    selectPromptMock.mockResolvedValueOnce([]);
    insertMock.mockResolvedValueOnce([{ insertId: 77 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      ...baseParams,
    });

    expect(id).toBe(77);
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    // insert 的 values 帶完整 content（非截斷 title）與 category。
    const values = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(values.content).toBe("a cute cat sitting on the moon");
    expect(values.category).toBe("image");
    expect(values.userId).toBe(7);
  });

  it("C3 命中多列（歷史髒資料）→ orderBy id asc 取最小 id（第一筆）", async () => {
    // 生產程式碼用 orderBy(asc(id)).limit(1)，DB 只回最小 id 那筆；
    // 這裡模擬 DB 已套用排序＋limit，回單一最早列。
    selectPromptMock.mockResolvedValueOnce([{ id: 11 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      ...baseParams,
    });

    expect(id).toBe(11);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("A3 極長 content：用完整 content 查/寫，title 才截斷（兩者解耦）", async () => {
    const longContent = "x".repeat(5000);
    selectPromptMock.mockResolvedValueOnce([]);
    insertMock.mockResolvedValueOnce([{ insertId: 5 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      userId: 7,
      content: longContent,
      category: "image",
      title: longContent.slice(0, 80), // 呼叫端截斷後的 title
      modelHint: "fal-ai/nano-banana-2",
    });

    expect(id).toBe(5);
    const values = insertMock.mock.calls[0][0] as Record<string, unknown>;
    // content 完整、title 截斷 → 兩個前 80 字相同、後文不同的提示詞不會被誤併。
    expect((values.content as string).length).toBe(5000);
    expect((values.title as string).length).toBe(80);
  });

  it("A4 unicode content（中文+emoji）原樣比對，不做正規化", async () => {
    const unicodeContent = "貓咪在月球上🌙🐱 variation selector";
    selectPromptMock.mockResolvedValueOnce([{ id: 88 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      userId: 7,
      content: unicodeContent,
      category: "image",
      title: unicodeContent.slice(0, 80),
      modelHint: "m",
    });

    expect(id).toBe(88);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("E1 SELECT 拋錯 → 安全 fallback 成 insert（never blocks）", async () => {
    selectPromptMock.mockRejectedValueOnce(new Error("DB down on select"));
    insertMock.mockResolvedValueOnce([{ insertId: 33 }]);

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      ...baseParams,
    });

    // 查詢失敗不拋、不阻斷 → 退回 insert 取得新 id。
    expect(id).toBe(33);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("E2/E3 SELECT 與 INSERT 皆拋錯 → 回 null，不向上拋", async () => {
    selectPromptMock.mockRejectedValueOnce(new Error("select boom"));
    insertMock.mockRejectedValueOnce(new Error("insert boom"));

    const id = await findOrCreatePromptByContent({
      dbConn: makeDbMock(),
      ...baseParams,
    });

    expect(id).toBeNull();
  });

  it("E5 insertId 異常（undefined/0/NaN）→ 回 null", async () => {
    selectPromptMock.mockResolvedValue([]);

    insertMock.mockResolvedValueOnce(undefined as never);
    expect(
      await findOrCreatePromptByContent({ dbConn: makeDbMock(), ...baseParams })
    ).toBeNull();

    insertMock.mockResolvedValueOnce([{ insertId: 0 }] as never);
    expect(
      await findOrCreatePromptByContent({ dbConn: makeDbMock(), ...baseParams })
    ).toBeNull();

    insertMock.mockResolvedValueOnce([{ insertId: NaN }] as never);
    expect(
      await findOrCreatePromptByContent({ dbConn: makeDbMock(), ...baseParams })
    ).toBeNull();
  });
});

describe("doPostGenComplete upsert-by-content integration (AIDV-10)", () => {
  beforeEach(() => {
    createDigitalAssetMock.mockReset();
    createDigitalAssetMock.mockResolvedValue(1);
    createHistoryEntryMock.mockReset();
    createHistoryEntryMock.mockResolvedValue(1);
    createPromptAssetLinkMock.mockReset();
    createPromptAssetLinkMock.mockResolvedValue(1);
    insertMock.mockReset();
    insertMock.mockResolvedValue([{ insertId: 100 }]);
    addGenerationLogMock.mockReset();
    getDbMock.mockReset();
    selectFromDedupeMock.mockReset();
    selectFromDedupeMock.mockResolvedValue([]);
    selectPromptMock.mockReset();
    selectPromptMock.mockResolvedValue([]);
    getDbMock.mockReturnValue(makeDbMock());
    delete process.env.ENABLE_PROMPT_ASSET_LINKS;
  });

  afterEach(() => {
    delete process.env.ENABLE_PROMPT_ASSET_LINKS;
  });

  it("命中既有 content → 重用 id 建邊，不再 insert prompt_library", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    selectPromptMock.mockResolvedValueOnce([{ id: 500 }]); // 既有列
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/result.png",
    });

    // 重用既有列：prompt_library insert 0 次
    expect(insertMock).not.toHaveBeenCalled();
    // junction 邊用「重用的既有 promptId=500」＋新 assetId=99
    expect(createPromptAssetLinkMock).toHaveBeenCalledWith({
      promptId: 500,
      assetId: 99,
      relation: "derived",
    });
  });

  it("D1 連兩次同 content → 只有一列 prompt、兩 asset 都連同一 prompt", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";

    // 第一次：未命中 → insert，回 insertId=300
    selectPromptMock.mockResolvedValueOnce([]);
    insertMock.mockResolvedValueOnce([{ insertId: 300 }]);
    createDigitalAssetMock.mockResolvedValueOnce(901); // 第一個 asset

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "ocean waves at sunset",
      resultUrl: "https://cdn.example.com/a.png",
    });

    // 第二次：同 content → 命中第一次那列（id=300），不 insert
    selectPromptMock.mockResolvedValueOnce([{ id: 300 }]);
    createDigitalAssetMock.mockResolvedValueOnce(902); // 第二個 asset

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "ocean waves at sunset",
      resultUrl: "https://cdn.example.com/b.png",
    });

    // 整個流程 prompt_library 只 insert 一次（第一次）。
    expect(insertMock).toHaveBeenCalledTimes(1);
    // 兩條 junction 邊：同 promptId=300、不同 assetId。
    expect(createPromptAssetLinkMock).toHaveBeenCalledTimes(2);
    expect(createPromptAssetLinkMock).toHaveBeenNthCalledWith(1, {
      promptId: 300,
      assetId: 901,
      relation: "derived",
    });
    expect(createPromptAssetLinkMock).toHaveBeenNthCalledWith(2, {
      promptId: 300,
      assetId: 902,
      relation: "derived",
    });
  });

  it("A1/A2 content 過短（< 4 字元）→ 完全不查不寫，無 promptId", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "貓", // < MIN_PROMPT_LENGTH_FOR_LIBRARY
      resultUrl: "https://cdn.example.com/x.png",
    });

    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(createPromptAssetLinkMock).not.toHaveBeenCalled();
    // 資產照常寫入 — 去重不影響其他寫入路徑。
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
  });

  it("E1 upsert 查詢拋錯 → fallback insert，生成鏈其餘照常", async () => {
    selectPromptMock.mockRejectedValueOnce(new Error("select exploded"));
    insertMock.mockResolvedValueOnce([{ insertId: 44 }]);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/x.png",
    });

    // SELECT 失敗 → 退回 insert
    expect(insertMock).toHaveBeenCalledTimes(1);
    // 資產 / 歷史 / 監控全照常
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
    expect(addGenerationLogMock).toHaveBeenCalledTimes(1);
  });

  it("E2 upsert insert 拋錯 → savedPromptId=null，資產/歷史/監控不中斷、不建邊", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    selectPromptMock.mockResolvedValueOnce([]); // 未命中
    insertMock.mockRejectedValueOnce(new Error("insert exploded"));
    createDigitalAssetMock.mockResolvedValue(99);

    await expect(
      doPostGenComplete({
        userId: 7,
        modality: "image",
        modelId: "fal-ai/nano-banana-2",
        prompt: "a cute cat sitting on the moon",
        resultUrl: "https://cdn.example.com/x.png",
      })
    ).resolves.toBeUndefined();

    // 無有效 promptId → 不建邊
    expect(createPromptAssetLinkMock).not.toHaveBeenCalled();
    // 其餘寫入照常
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
    expect(createHistoryEntryMock).toHaveBeenCalledTimes(1);
    expect(addGenerationLogMock).toHaveBeenCalledTimes(1);
  });

  it("F1 同輸入重跑 N 次 → prompt_library 收斂為一列（首次 insert，其後命中重用）", async () => {
    // 首次未命中 insert
    selectPromptMock.mockResolvedValueOnce([]);
    insertMock.mockResolvedValueOnce([{ insertId: 700 }]);
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling",
      prompt: "a recurring prompt text",
      resultUrl: "https://cdn.example.com/1.mp4",
    });
    // 第二、三次都命中既有列
    selectPromptMock.mockResolvedValue([{ id: 700 }]);
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling",
      prompt: "a recurring prompt text",
      resultUrl: "https://cdn.example.com/2.mp4",
    });
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "fal-ai/kling",
      prompt: "a recurring prompt text",
      resultUrl: "https://cdn.example.com/3.mp4",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("B2 同 content 不同 category（image vs video）→ 各自查，scope 含 category", async () => {
    // category 納入 upsert 鍵：同一句話生圖 vs 生影分開。這裡驗證 select
    // 的 where 條件帶 category（透過 selectPromptMock 被呼叫 + insert 行為）。
    selectPromptMock.mockResolvedValueOnce([]); // image 未命中
    insertMock.mockResolvedValueOnce([{ insertId: 1 }]);
    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "m",
      prompt: "same words different modality",
      resultUrl: "https://cdn.example.com/i.png",
    });
    selectPromptMock.mockResolvedValueOnce([]); // video 也未命中（scope 含 category）
    insertMock.mockResolvedValueOnce([{ insertId: 2 }]);
    await doPostGenComplete({
      userId: 7,
      modality: "video",
      modelId: "m",
      prompt: "same words different modality",
      resultUrl: "https://cdn.example.com/v.mp4",
    });

    // 兩個 modality 各 insert 一列。
    expect(insertMock).toHaveBeenCalledTimes(2);
    const cats = insertMock.mock.calls.map(
      c => (c[0] as Record<string, unknown>).category
    );
    expect(cats).toEqual(["image", "video"]);
  });

  it("E4 getDb 回 null → 跳過整個提示詞庫，savedPromptId=null，其餘照走", async () => {
    process.env.ENABLE_PROMPT_ASSET_LINKS = "true";
    getDbMock.mockReturnValue(null);
    createDigitalAssetMock.mockResolvedValue(99);

    await doPostGenComplete({
      userId: 7,
      modality: "image",
      modelId: "fal-ai/nano-banana-2",
      prompt: "a cute cat sitting on the moon",
      resultUrl: "https://cdn.example.com/x.png",
    });

    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(createPromptAssetLinkMock).not.toHaveBeenCalled();
    expect(createDigitalAssetMock).toHaveBeenCalledTimes(1);
  });
});
