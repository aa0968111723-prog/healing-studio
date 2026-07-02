/**
 * falTrainer.test.ts — AIDV-45 fal LoRA 訓練「輪詢回寫 / fine_tuned_models 對映」測試
 *
 * Source-anchored 錨定點：
 *  1. runFalTrainingJob 走 queue.submit 拿「真實」request_id，且在開始輪詢前
 *     就把它回寫 fine_tuned_models.replicatePredictionId + configJson.falRequestId
 *     （突變回舊的 "pending" 佔位字串 → 測試立即紅）。
 *  2. 輪詢超時（status="pending"）不再誤標 failed —— 保持 training 讓
 *     checkAndSyncFalTraining 之後接手。
 *  3. extractFalLoraOutputUrl 的萃取優先序（diffusers_lora_file → config_file →
 *     model_url → lora_file_url → output）與 envelope 相容。
 *  4. checkAndSyncFalTraining：fal queue 終態 → 回寫模型 + 收尾 backgroundJob；
 *     非 fal 引擎 / 佔位 ID / 終態模型一律回 null 不打 API。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUpdateFineTunedModel,
  mockUpdateBackgroundJob,
  mockFindActiveJob,
  mockStoragePut,
  mockQueueSubmit,
  mockAwaitFalQueueResult,
} = vi.hoisted(() => ({
  mockUpdateFineTunedModel: vi.fn().mockResolvedValue(undefined),
  mockUpdateBackgroundJob: vi.fn().mockResolvedValue(undefined),
  mockFindActiveJob: vi.fn().mockResolvedValue(undefined),
  mockStoragePut: vi
    .fn()
    .mockResolvedValue({ url: "https://pub-x.r2.dev/lora-datasets/1/zip.zip" }),
  mockQueueSubmit: vi.fn(),
  mockAwaitFalQueueResult: vi.fn(),
}));

vi.mock("../../db", () => ({
  updateFineTunedModel: mockUpdateFineTunedModel,
  updateBackgroundJob: mockUpdateBackgroundJob,
  findActiveModelTrainingJobByModelId: mockFindActiveJob,
}));

vi.mock("../../storage", () => ({
  storagePut: mockStoragePut,
}));

vi.mock("@fal-ai/client", () => ({
  createFalClient: vi.fn(() => ({ queue: { submit: mockQueueSubmit } })),
}));

vi.mock("../falQueueAwaiter", () => ({
  awaitFalQueueResult: mockAwaitFalQueueResult,
}));

import {
  runFalTrainingJob,
  extractFalLoraOutputUrl,
  checkAndSyncFalTraining,
  type FalTrainingJobInput,
} from "../falTrainer";
import { FAL_QUEUE_BASE } from "../../_core/providerFacade";

const ORIGINAL_FAL_KEY = process.env.FAL_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FAL_API_KEY = "test-fal-key";
  mockStoragePut.mockResolvedValue({
    url: "https://pub-x.r2.dev/lora-datasets/1/zip.zip",
  });
  mockFindActiveJob.mockResolvedValue(undefined);
  // buildZipBuffer 會逐張下載訓練圖片 — stub 全域 fetch 回 1KB 假圖。
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1024),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_FAL_KEY === undefined) delete process.env.FAL_API_KEY;
  else process.env.FAL_API_KEY = ORIGINAL_FAL_KEY;
});

const baseInput: FalTrainingJobInput = {
  userId: 1,
  modelId: 5,
  jobId: 9,
  modelName: "測試角色",
  modelType: "image_subject",
  triggerWord: "mychar",
  steps: 1000,
  learningRate: 0.0004,
  imageUrls: [
    "https://v2.fal.media/files/a.jpg",
    "https://v2.fal.media/files/b.jpg",
  ],
  falModelId: "fal-ai/flux-lora-fast-training",
};

// ─── extractFalLoraOutputUrl ────────────────────────────────────────────────

describe("extractFalLoraOutputUrl", () => {
  it("優先取 diffusers_lora_file.url（flux-lora-fast-training 標準輸出）", () => {
    expect(
      extractFalLoraOutputUrl({
        diffusers_lora_file: { url: "https://fal.media/lora.safetensors" },
        config_file: { url: "https://fal.media/config.json" },
      })
    ).toBe("https://fal.media/lora.safetensors");
  });

  it("無 diffusers_lora_file 時退回 config_file.url", () => {
    expect(
      extractFalLoraOutputUrl({
        config_file: { url: "https://fal.media/config.json" },
      })
    ).toBe("https://fal.media/config.json");
  });

  it("支援 model_url / lora_file_url / output（字串與陣列）", () => {
    expect(extractFalLoraOutputUrl({ model_url: "https://m" })).toBe(
      "https://m"
    );
    expect(extractFalLoraOutputUrl({ lora_file_url: "https://l" })).toBe(
      "https://l"
    );
    expect(extractFalLoraOutputUrl({ output: "https://o" })).toBe("https://o");
    expect(extractFalLoraOutputUrl({ output: ["https://o0", "x"] })).toBe(
      "https://o0"
    );
  });

  it("支援 data envelope（queue result 包一層）", () => {
    expect(
      extractFalLoraOutputUrl({
        data: {
          diffusers_lora_file: { url: "https://fal.media/nested.safetensors" },
        },
      })
    ).toBe("https://fal.media/nested.safetensors");
  });

  it("空物件 / 非物件回 null", () => {
    expect(extractFalLoraOutputUrl({})).toBeNull();
    expect(extractFalLoraOutputUrl(null)).toBeNull();
    expect(extractFalLoraOutputUrl("str")).toBeNull();
  });
});

// ─── runFalTrainingJob ──────────────────────────────────────────────────────

describe("runFalTrainingJob（queue.submit + 真實 request_id 持久化）", () => {
  it("提交後、輪詢前就把真實 request_id 回寫 replicatePredictionId + configJson.falRequestId", async () => {
    mockQueueSubmit.mockResolvedValue({ request_id: "req-abc-123" });
    mockAwaitFalQueueResult.mockResolvedValue({
      status: "completed",
      request_id: "req-abc-123",
      modelId: baseInput.falModelId,
      raw: {
        diffusers_lora_file: { url: "https://fal.media/out.safetensors" },
      },
    });

    await runFalTrainingJob(baseInput);

    // request_id 持久化呼叫（欄位對映）
    const persistCall = mockUpdateFineTunedModel.mock.calls.find(
      ([, data]) =>
        (data as Record<string, unknown>).replicatePredictionId ===
        "req-abc-123"
    );
    expect(persistCall).toBeTruthy();
    expect(persistCall![0]).toBe(5);
    expect(
      (persistCall![1] as { configJson: Record<string, unknown> }).configJson
    ).toMatchObject({
      falRequestId: "req-abc-123",
      falModelId: "fal-ai/flux-lora-fast-training",
    });

    // 順序錨定：持久化必須發生在 awaitFalQueueResult 之前（伺服器中途重啟
    // 才有 ID 可以恢復輪詢）。
    const persistOrder =
      mockUpdateFineTunedModel.mock.invocationCallOrder[
        mockUpdateFineTunedModel.mock.calls.indexOf(persistCall!)
      ];
    const pollOrder = mockAwaitFalQueueResult.mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(pollOrder);

    // 完成回寫：status ready + trainedLoraUrl/fileUrl 對映
    const readyCall = mockUpdateFineTunedModel.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "ready"
    );
    expect(readyCall).toBeTruthy();
    expect(readyCall![1]).toMatchObject({
      trainedLoraUrl: "https://fal.media/out.safetensors",
      fileUrl: "https://fal.media/out.safetensors",
    });

    // backgroundJob 完結，resultJson 帶 outputUrl + falRequestId
    const jobDone = mockUpdateBackgroundJob.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "completed"
    );
    expect(jobDone).toBeTruthy();
    expect(jobDone![0]).toBe(9);
    expect(
      (jobDone![1] as { resultJson: Record<string, unknown> }).resultJson
    ).toMatchObject({
      outputUrl: "https://fal.media/out.safetensors",
      falRequestId: "req-abc-123",
    });
  });

  it("輪詢超時（pending）不誤標 failed — 保持 training 交給輪詢回寫", async () => {
    mockQueueSubmit.mockResolvedValue({ request_id: "req-slow" });
    mockAwaitFalQueueResult.mockResolvedValue({
      status: "pending",
      request_id: "req-slow",
      modelId: baseInput.falModelId,
      error: "await timed out after 3600000ms",
    });

    await runFalTrainingJob(baseInput);

    const failedModelCall = mockUpdateFineTunedModel.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "failed"
    );
    expect(failedModelCall).toBeUndefined();
    const failedJobCall = mockUpdateBackgroundJob.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "failed"
    );
    expect(failedJobCall).toBeUndefined();
    // job 留有「仍在進行中」的訊息（非終態）
    const lastJobUpdate =
      mockUpdateBackgroundJob.mock.calls[
        mockUpdateBackgroundJob.mock.calls.length - 1
      ];
    expect(String(lastJobUpdate[1].progressMessage)).toContain("仍在進行中");
  });

  it("fal 回報 failed → 模型與 job 都標 failed 並帶錯誤訊息", async () => {
    mockQueueSubmit.mockResolvedValue({ request_id: "req-bad" });
    mockAwaitFalQueueResult.mockResolvedValue({
      status: "failed",
      request_id: "req-bad",
      modelId: baseInput.falModelId,
      error: "GPU exploded",
    });

    await runFalTrainingJob(baseInput);

    expect(mockUpdateFineTunedModel).toHaveBeenCalledWith(5, {
      status: "failed",
    });
    const failedJob = mockUpdateBackgroundJob.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "failed"
    );
    expect(failedJob).toBeTruthy();
    expect(String(failedJob![1].errorMessage)).toContain("GPU exploded");
  });

  it("queue.submit 未回傳 request_id → 直接標 failed（不進輪詢）", async () => {
    mockQueueSubmit.mockResolvedValue({});

    await runFalTrainingJob(baseInput);

    expect(mockAwaitFalQueueResult).not.toHaveBeenCalled();
    expect(mockUpdateFineTunedModel).toHaveBeenCalledWith(5, {
      status: "failed",
    });
  });
});

// ─── checkAndSyncFalTraining（輪詢回寫）────────────────────────────────────

function makeFetchSeq(
  responses: Array<{ ok: boolean; status?: number; json?: unknown }>
) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? {},
    });
  }
  return fn as unknown as typeof fetch;
}

const trainingFalModel = {
  id: 5,
  status: "training",
  trainingEngine: "fal" as const,
  replicatePredictionId: "req-9",
  configJson: {
    falModelId: "fal-ai/flux-lora-fast-training",
    falRequestId: "req-9",
  },
};

describe("checkAndSyncFalTraining", () => {
  it("非 fal 引擎 / 終態 / 佔位 request_id / 無 API key → 回 null 且不打 API", async () => {
    // replicate 引擎（且無 falModelId）
    expect(
      await checkAndSyncFalTraining({
        id: 1,
        status: "training",
        trainingEngine: "replicate",
        replicatePredictionId: "rp-1",
        configJson: {},
      })
    ).toBeNull();
    // 已是終態
    expect(
      await checkAndSyncFalTraining({ ...trainingFalModel, status: "ready" })
    ).toBeNull();
    // 舊版佔位字串（"pending"/"completed"/"completed-no-url"）不是真實 ID
    expect(
      await checkAndSyncFalTraining({
        ...trainingFalModel,
        replicatePredictionId: null,
        configJson: {
          falModelId: "fal-ai/flux-lora-fast-training",
          falRequestId: "pending",
        },
      })
    ).toBeNull();
    // 無 FAL_API_KEY
    delete process.env.FAL_API_KEY;
    expect(await checkAndSyncFalTraining(trainingFalModel)).toBeNull();
    expect(mockUpdateFineTunedModel).not.toHaveBeenCalled();
  });

  it("COMPLETED → 回寫 ready + trainedLoraUrl 並收尾 backgroundJob", async () => {
    mockFindActiveJob.mockResolvedValue({
      id: 77,
      status: "processing",
      resultJson: { modelId: 5, engine: "fal" },
    });
    const fetchFn = makeFetchSeq([
      { ok: true, json: { status: "COMPLETED" } },
      {
        ok: true,
        json: {
          diffusers_lora_file: { url: "https://fal.media/sync.safetensors" },
        },
      },
    ]);

    const result = await checkAndSyncFalTraining(trainingFalModel, {
      fetchFn,
    });

    expect(result).toMatchObject({
      requestId: "req-9",
      queueStatus: "COMPLETED",
      synced: true,
      modelStatus: "ready",
      outputUrl: "https://fal.media/sync.safetensors",
    });
    // 查詢 URL 錨定（fal queue REST 形狀）
    expect(vi.mocked(fetchFn).mock.calls[0][0]).toBe(
      `${FAL_QUEUE_BASE}/fal-ai/flux-lora-fast-training/requests/req-9/status`
    );
    expect(vi.mocked(fetchFn).mock.calls[1][0]).toBe(
      `${FAL_QUEUE_BASE}/fal-ai/flux-lora-fast-training/requests/req-9`
    );
    // fine_tuned_models 回寫
    const readyCall = mockUpdateFineTunedModel.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "ready"
    );
    expect(readyCall).toBeTruthy();
    expect(readyCall![0]).toBe(5);
    expect(readyCall![1]).toMatchObject({
      trainedLoraUrl: "https://fal.media/sync.safetensors",
      fileUrl: "https://fal.media/sync.safetensors",
    });
    // backgroundJob 收尾
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ status: "completed", progress: 100 })
    );
  });

  it("IN_PROGRESS → 不寫庫，回報現況", async () => {
    const fetchFn = makeFetchSeq([
      { ok: true, json: { status: "IN_PROGRESS" } },
    ]);
    const result = await checkAndSyncFalTraining(trainingFalModel, {
      fetchFn,
    });
    expect(result).toMatchObject({
      requestId: "req-9",
      queueStatus: "IN_PROGRESS",
      synced: false,
    });
    expect(mockUpdateFineTunedModel).not.toHaveBeenCalled();
    expect(mockUpdateBackgroundJob).not.toHaveBeenCalled();
  });

  it("FAILED → 回寫模型 failed 並把 backgroundJob 標 failed", async () => {
    mockFindActiveJob.mockResolvedValue({
      id: 78,
      status: "processing",
      resultJson: { modelId: 5 },
    });
    const fetchFn = makeFetchSeq([
      { ok: true, json: { status: "FAILED", error: "dataset too small" } },
    ]);
    const result = await checkAndSyncFalTraining(trainingFalModel, {
      fetchFn,
    });
    expect(result).toMatchObject({
      queueStatus: "FAILED",
      synced: true,
      modelStatus: "failed",
      error: "dataset too small",
    });
    expect(mockUpdateFineTunedModel).toHaveBeenCalledWith(5, {
      status: "failed",
    });
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      78,
      expect.objectContaining({
        status: "failed",
        errorMessage: "dataset too small",
      })
    );
  });

  it("status 端點非 2xx → synced=false、queueStatus=HTTP_xxx、不寫庫", async () => {
    const fetchFn = makeFetchSeq([{ ok: false, status: 500 }]);
    const result = await checkAndSyncFalTraining(trainingFalModel, {
      fetchFn,
    });
    expect(result).toMatchObject({ queueStatus: "HTTP_500", synced: false });
    expect(mockUpdateFineTunedModel).not.toHaveBeenCalled();
  });

  it("legacy 行（trainingEngine 誤存 replicate 但有 configJson.falModelId）也走 fal 同步", async () => {
    const fetchFn = makeFetchSeq([{ ok: true, json: { status: "IN_QUEUE" } }]);
    const result = await checkAndSyncFalTraining(
      {
        ...trainingFalModel,
        trainingEngine: "replicate",
      },
      { fetchFn }
    );
    expect(result).toMatchObject({ queueStatus: "IN_QUEUE", synced: false });
  });
});
