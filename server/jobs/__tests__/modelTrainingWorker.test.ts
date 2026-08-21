/**
 * modelTrainingWorker.test.ts — AIDV-45 引擎守門測試
 *
 * 釘住的安全承諾：
 *  1. fal 引擎的 model_training 任務（resultJson.engine="fal" /
 *     falRequestId / 模型列 trainingEngine="fal" / configJson.falModelId）
 *     絕不進 Replicate 派工（runLoraTrainingJob 不得被呼叫），
 *     也不得被 datasetImages<3 的檢查標成 failed（fal 允許 >=1 張）。
 *  2. 卡住的 fal 任務絕不重置為 queued（否則下一輪就被 Replicate
 *     重派工 → 雙重派工雙重計費），改走 checkAndSyncFalTraining 輪詢回寫。
 *  3. 等價承諾：Replicate 任務的既有行為不變 — queued 會被派工、
 *     卡住且無 predictionId 會被重置 queued。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetQueuedJobsByType,
  mockGetStuckJobsByType,
  mockUpdateBackgroundJob,
  mockUpdateFineTunedModel,
  mockGetFineTunedModel,
  mockRunLoraTrainingJob,
  mockCheckAndSyncFalTraining,
  mockGetReplicateTrainingStatus,
} = vi.hoisted(() => ({
  mockGetQueuedJobsByType: vi.fn().mockResolvedValue([]),
  mockGetStuckJobsByType: vi.fn().mockResolvedValue([]),
  mockUpdateBackgroundJob: vi.fn().mockResolvedValue(undefined),
  mockUpdateFineTunedModel: vi.fn().mockResolvedValue(undefined),
  mockGetFineTunedModel: vi.fn().mockResolvedValue(undefined),
  mockRunLoraTrainingJob: vi.fn().mockResolvedValue(undefined),
  mockCheckAndSyncFalTraining: vi.fn().mockResolvedValue(null),
  mockGetReplicateTrainingStatus: vi.fn(),
}));

vi.mock("../../db", () => ({
  getQueuedJobsByType: mockGetQueuedJobsByType,
  getStuckJobsByType: mockGetStuckJobsByType,
  updateBackgroundJob: mockUpdateBackgroundJob,
  updateFineTunedModel: mockUpdateFineTunedModel,
  getFineTunedModel: mockGetFineTunedModel,
}));

vi.mock("../../services/loraTrainer", () => ({
  runLoraTrainingJob: mockRunLoraTrainingJob,
}));

vi.mock("../../services/falTrainer", () => ({
  checkAndSyncFalTraining: mockCheckAndSyncFalTraining,
}));

vi.mock("../../services/replicateClient", () => ({
  getReplicateTrainingStatus: mockGetReplicateTrainingStatus,
}));

import {
  processQueuedTrainingJobs,
  recoverStuckTrainingJobs,
} from "../modelTrainingWorker";

const ORIGINAL_REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

/** fire-and-forget 的動態 import 派工需要 flush 微任務/巨任務。 */
async function flushDispatch(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = "test-replicate-token";
  mockGetQueuedJobsByType.mockResolvedValue([]);
  mockGetStuckJobsByType.mockResolvedValue([]);
  mockGetFineTunedModel.mockResolvedValue(undefined);
  mockCheckAndSyncFalTraining.mockResolvedValue(null);
});

afterEach(() => {
  if (ORIGINAL_REPLICATE_TOKEN === undefined)
    delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = ORIGINAL_REPLICATE_TOKEN;
});

// ─── 共用夾具 ───────────────────────────────────────────────────────────────

const falQueuedJob = {
  id: 101,
  userId: 1,
  jobType: "model_training",
  status: "queued",
  resultJson: {
    modelId: 5,
    modelName: "fal 模型",
    engine: "fal",
    falModelId: "fal-ai/flux-lora-fast-training",
    falRequestId: "req-real-1",
  },
};

const falModelRow = {
  id: 5,
  userId: 1,
  name: "fal 模型",
  status: "training",
  trainingEngine: "fal",
  replicatePredictionId: "req-real-1",
  configJson: {
    falModelId: "fal-ai/flux-lora-fast-training",
    falRequestId: "req-real-1",
    // fal 允許 totalDataCount>=1 — 不足 3 張不可被 worker 標 failed
    datasetImages: [{ url: "https://img/1.jpg" }],
  },
};

const replicateModelRow = {
  id: 7,
  userId: 1,
  name: "replicate 模型",
  status: "pending",
  trainingEngine: "replicate",
  replicatePredictionId: null,
  configJson: {
    triggerWord: "tw",
    datasetImages: [
      { url: "https://img/1.jpg" },
      { url: "https://img/2.jpg" },
      { url: "https://img/3.jpg" },
    ],
  },
};

// ─── processQueuedTrainingJobs ──────────────────────────────────────────────

describe("processQueuedTrainingJobs — fal 引擎守門", () => {
  it("queued 的 fal 任務（resultJson.engine='fal'）→ 跳過，絕不進 Replicate 派工", async () => {
    mockGetQueuedJobsByType.mockResolvedValue([falQueuedJob]);

    await processQueuedTrainingJobs();
    await flushDispatch();

    expect(mockRunLoraTrainingJob).not.toHaveBeenCalled();
    // 不改 job 狀態（保持 queued 由 fal 流程/輪詢回寫接手）
    expect(mockUpdateBackgroundJob).not.toHaveBeenCalled();
    expect(mockUpdateFineTunedModel).not.toHaveBeenCalled();
  });

  it("legacy fal 任務（resultJson 無 engine、模型列 trainingEngine='fal'）→ 跳過且不因 datasetImages<3 標 failed", async () => {
    mockGetQueuedJobsByType.mockResolvedValue([
      {
        ...falQueuedJob,
        id: 102,
        resultJson: { modelId: 5, modelName: "fal 模型" }, // 舊 job：無 engine 欄
      },
    ]);
    mockGetFineTunedModel.mockResolvedValue(falModelRow);

    await processQueuedTrainingJobs();
    await flushDispatch();

    expect(mockRunLoraTrainingJob).not.toHaveBeenCalled();
    // 摧毀性行為釘死：不得把還在 fal 上訓練的模型/job 標 failed
    const failedJob = mockUpdateBackgroundJob.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "failed"
    );
    expect(failedJob).toBeUndefined();
    expect(mockUpdateFineTunedModel).not.toHaveBeenCalled();
  });

  it("等價承諾：Replicate queued 任務仍照舊派工", async () => {
    mockGetQueuedJobsByType.mockResolvedValue([
      {
        id: 103,
        userId: 1,
        jobType: "model_training",
        status: "queued",
        resultJson: { modelId: 7, modelName: "replicate 模型" },
      },
    ]);
    mockGetFineTunedModel.mockResolvedValue(replicateModelRow);

    await processQueuedTrainingJobs();
    await flushDispatch();

    // 先標 processing 再派工
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      103,
      expect.objectContaining({ status: "processing" })
    );
    expect(mockRunLoraTrainingJob).toHaveBeenCalledTimes(1);
    expect(mockRunLoraTrainingJob).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 7, jobId: 103 })
    );
  });
});

// ─── recoverStuckTrainingJobs ───────────────────────────────────────────────

describe("recoverStuckTrainingJobs — fal 引擎守門", () => {
  const stuckFalJob = {
    id: 201,
    userId: 1,
    jobType: "model_training",
    status: "processing",
    resultJson: {
      modelId: 5,
      modelName: "fal 模型",
      engine: "fal",
      falRequestId: "req-real-1",
      // 無 predictionId（fal 任務本來就沒有）
    },
  };

  it("卡住的 fal 任務 → 走 checkAndSyncFalTraining、絕不重置為 queued、絕不派工", async () => {
    mockGetStuckJobsByType.mockResolvedValue([stuckFalJob]);
    mockGetFineTunedModel.mockResolvedValue(falModelRow);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-real-1",
      queueStatus: "IN_PROGRESS",
      synced: false,
    });

    await recoverStuckTrainingJobs();
    await flushDispatch();

    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledTimes(1);
    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledWith(falModelRow);
    expect(mockRunLoraTrainingJob).not.toHaveBeenCalled();
    // 絕不重置 queued（否則下一輪被 Replicate 重派工 → 雙重計費）
    const requeueCall = mockUpdateBackgroundJob.mock.calls.find(
      ([, data]) => (data as Record<string, unknown>).status === "queued"
    );
    expect(requeueCall).toBeUndefined();
    // 未到終態 → touch updatedAt 重置卡住計時器
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      201,
      expect.objectContaining({
        progressMessage: expect.stringContaining("Fal.ai"),
      })
    );
    // 不拿 fal request id 去問 Replicate
    expect(mockGetReplicateTrainingStatus).not.toHaveBeenCalled();
  });

  it("卡住的 fal 任務、輪詢回寫已同步終態 → 不再 touch、不重置 queued", async () => {
    mockGetStuckJobsByType.mockResolvedValue([stuckFalJob]);
    mockGetFineTunedModel.mockResolvedValue(falModelRow);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-real-1",
      queueStatus: "COMPLETED",
      synced: true,
      modelStatus: "ready",
      outputUrl: "https://fal.media/out.safetensors",
    });

    await recoverStuckTrainingJobs();

    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledTimes(1);
    // synced=true → checkAndSyncFalTraining 內部已收尾 job，worker 不再另外寫
    expect(mockUpdateBackgroundJob).not.toHaveBeenCalled();
    expect(mockRunLoraTrainingJob).not.toHaveBeenCalled();
  });

  it("卡住的 fal 任務、模型已是終態（ready）→ 對帳收尾 job 為 completed", async () => {
    mockGetStuckJobsByType.mockResolvedValue([stuckFalJob]);
    mockGetFineTunedModel.mockResolvedValue({ ...falModelRow, status: "ready" });

    await recoverStuckTrainingJobs();

    expect(mockCheckAndSyncFalTraining).not.toHaveBeenCalled();
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      201,
      expect.objectContaining({ status: "completed", progress: 100 })
    );
  });

  it("等價承諾：卡住且無 predictionId 的 Replicate 任務仍重置為 queued", async () => {
    mockGetStuckJobsByType.mockResolvedValue([
      {
        id: 202,
        userId: 1,
        jobType: "model_training",
        status: "processing",
        resultJson: { modelId: 7, modelName: "replicate 模型" },
      },
    ]);
    mockGetFineTunedModel.mockResolvedValue(replicateModelRow);

    await recoverStuckTrainingJobs();

    expect(mockCheckAndSyncFalTraining).not.toHaveBeenCalled();
    expect(mockUpdateBackgroundJob).toHaveBeenCalledWith(
      202,
      expect.objectContaining({ status: "queued" })
    );
  });
});
