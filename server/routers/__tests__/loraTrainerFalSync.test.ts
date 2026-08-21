/**
 * loraTrainerFalSync.test.ts — AIDV-45 router 層 fal 分流測試
 *
 * 釘住本分支動到的既有關鍵路徑（trainingDetail / syncReplicateStatus /
 * models.create）的 e2e 行為承諾：
 *  1. fal 模型查 trainingDetail → 觸發 checkAndSyncFalTraining；synced 後
 *     回傳「重讀後」的最新 model；絕不拿 fal request id 去問 Replicate。
 *  2. 等價承諾：replicate 模型（無 falModelId）走原 Replicate 路徑，
 *     checkAndSyncFalTraining 不被呼叫。
 *  3. models.syncReplicateStatus 的 fal 分支四種回傳形狀
 *     （synced-ready / synced-failed / 非終態 training / null）。
 *  4. models.create 持久化 trainingEngine（欄位對映）且 job resultJson
 *     帶 engine 欄（worker 引擎守門的資料來源）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetFineTunedModel,
  mockCreateFineTunedModel,
  mockUpdateFineTunedModel,
  mockCreateBackgroundJob,
  mockCheckAndSyncFalTraining,
  mockGetReplicateClient,
  mockTrainingsGet,
  mockPredictionsGet,
} = vi.hoisted(() => {
  const mockTrainingsGet = vi.fn();
  const mockPredictionsGet = vi.fn();
  return {
    mockGetFineTunedModel: vi.fn(),
    mockCreateFineTunedModel: vi.fn().mockResolvedValue(42),
    mockUpdateFineTunedModel: vi.fn().mockResolvedValue(undefined),
    mockCreateBackgroundJob: vi.fn().mockResolvedValue(900),
    mockCheckAndSyncFalTraining: vi.fn().mockResolvedValue(null),
    mockGetReplicateClient: vi.fn(() => ({
      trainings: { get: mockTrainingsGet },
      predictions: { get: mockPredictionsGet },
    })),
    mockTrainingsGet,
    mockPredictionsGet,
  };
});

vi.mock("../../db", () => ({
  // _core/trpc 與 middleware/brainContext 需要 getDb（named import）
  getDb: vi.fn(async () => null),
  getFineTunedModel: mockGetFineTunedModel,
  createFineTunedModel: mockCreateFineTunedModel,
  updateFineTunedModel: mockUpdateFineTunedModel,
  createBackgroundJob: mockCreateBackgroundJob,
}));

vi.mock("../../services/falTrainer", () => ({
  checkAndSyncFalTraining: mockCheckAndSyncFalTraining,
}));

vi.mock("../../services/replicateClient", () => ({
  getReplicateClient: mockGetReplicateClient,
}));

// models.ts 頂層 import 的重依賴 — 本測試不走這些路徑，mock 掉避免副作用
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
vi.mock("../../_core/llm", () => ({
  invokeLLM: vi.fn(),
  extractMessageText: vi.fn(),
}));
vi.mock("../../services/falDispatcher", () => ({
  dispatchImageGeneration: vi.fn(),
}));

import { loraTrainerRouter } from "../loraTrainer";
import { modelsRouter } from "../models";

const ORIGINAL_REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const ORIGINAL_FAL_KEY = process.env.FAL_API_KEY;

function callerCtx() {
  return {
    user: { id: 1, role: "user", name: "Tester" } as never,
    req: { headers: {}, header: () => undefined } as never,
    res: {} as never,
  } as never;
}

const loraCaller = () => loraTrainerRouter.createCaller(callerCtx());
const modelsCaller = () => modelsRouter.createCaller(callerCtx());

const falTrainingModel = {
  id: 5,
  userId: 1,
  name: "fal 模型",
  description: null,
  modelType: "image_subject",
  status: "training",
  trainingEngine: "fal",
  replicatePredictionId: "req-9",
  trainedLoraUrl: null,
  fileUrl: null,
  usageCount: 0,
  visibility: "private",
  configJson: {
    falModelId: "fal-ai/flux-lora-fast-training",
    falRequestId: "req-9",
    triggerWord: "tw",
  },
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

const replicateTrainingModel = {
  ...falTrainingModel,
  id: 7,
  name: "replicate 模型",
  trainingEngine: "replicate",
  replicatePredictionId: "rp-1",
  configJson: { triggerWord: "tw", predictionId: "rp-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = "test-replicate-token";
  process.env.FAL_API_KEY = "test-fal-key";
  mockCheckAndSyncFalTraining.mockResolvedValue(null);
  mockCreateFineTunedModel.mockResolvedValue(42);
  mockCreateBackgroundJob.mockResolvedValue(900);
});

afterEach(() => {
  if (ORIGINAL_REPLICATE_TOKEN === undefined)
    delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = ORIGINAL_REPLICATE_TOKEN;
  if (ORIGINAL_FAL_KEY === undefined) delete process.env.FAL_API_KEY;
  else process.env.FAL_API_KEY = ORIGINAL_FAL_KEY;
});

// ─── loraTrainer.trainingDetail ─────────────────────────────────────────────

describe("loraTrainer.trainingDetail — fal 分流", () => {
  it("fal 模型：觸發 checkAndSyncFalTraining；synced 後回傳重讀的 ready 模型；不打 Replicate", async () => {
    const readyModel = {
      ...falTrainingModel,
      status: "ready",
      trainedLoraUrl: "https://fal.media/out.safetensors",
      configJson: { ...falTrainingModel.configJson, completedAt: 1751500000000 },
    };
    // 第一次讀：training；synced 後重讀：ready
    mockGetFineTunedModel
      .mockResolvedValueOnce(falTrainingModel)
      .mockResolvedValueOnce(readyModel);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "COMPLETED",
      synced: true,
      modelStatus: "ready",
      outputUrl: "https://fal.media/out.safetensors",
    });

    const detail = await loraCaller().trainingDetail({ modelId: 5 });

    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledTimes(1);
    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledWith(falTrainingModel);
    // synced=true → 重讀 model，回傳最新 ready 狀態
    expect(mockGetFineTunedModel).toHaveBeenCalledTimes(2);
    expect(detail.status).toBe("ready");
    expect(detail.trainedLoraUrl).toBe("https://fal.media/out.safetensors");
    expect(detail.trainingEngine).toBe("fal");
    expect(detail.falInfo).toMatchObject({
      queueStatus: "COMPLETED",
      synced: true,
      modelStatus: "ready",
    });
    // fal 模型絕不拿 fal request id 去問 Replicate
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
    expect(detail.replicateInfo).toBeNull();
  });

  it("fal 模型未同步（非終態）→ falInfo 回報現況、模型維持 training", async () => {
    mockGetFineTunedModel.mockResolvedValue(falTrainingModel);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "IN_PROGRESS",
      synced: false,
    });

    const detail = await loraCaller().trainingDetail({ modelId: 5 });

    // 未 synced → 不重讀
    expect(mockGetFineTunedModel).toHaveBeenCalledTimes(1);
    expect(detail.status).toBe("training");
    expect(detail.falInfo).toMatchObject({
      queueStatus: "IN_PROGRESS",
      synced: false,
    });
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
  });

  it("等價承諾：replicate 模型（無 falModelId）走原 Replicate 路徑、不呼叫 fal 同步", async () => {
    mockGetFineTunedModel.mockResolvedValue(replicateTrainingModel);
    mockTrainingsGet.mockResolvedValue({
      id: "rp-1",
      status: "processing",
      created_at: "2026-07-01T00:00:00Z",
    });

    const detail = await loraCaller().trainingDetail({ modelId: 7 });

    expect(mockCheckAndSyncFalTraining).not.toHaveBeenCalled();
    expect(detail.trainingEngine).toBe("replicate");
    expect(detail.falInfo).toBeNull();
    expect(mockGetReplicateClient).toHaveBeenCalledTimes(1);
    expect(mockTrainingsGet).toHaveBeenCalledWith("rp-1");
    expect(detail.replicateInfo).toMatchObject({
      id: "rp-1",
      status: "processing",
    });
  });
});

// ─── models.syncReplicateStatus — fal 分支四種形狀 ─────────────────────────

describe("models.syncReplicateStatus — fal 分支", () => {
  it("synced-ready → { status:'ready', loraUrl, message:'訓練完成！' }", async () => {
    mockGetFineTunedModel.mockResolvedValue(falTrainingModel);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "COMPLETED",
      synced: true,
      modelStatus: "ready",
      outputUrl: "https://fal.media/out.safetensors",
    });

    const res = await modelsCaller().syncReplicateStatus({ modelId: 5 });

    expect(res).toEqual({
      status: "ready",
      loraUrl: "https://fal.media/out.safetensors",
      message: "訓練完成！",
    });
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
  });

  it("synced-failed → { status:'failed', message 帶 queueStatus 與 error }", async () => {
    mockGetFineTunedModel.mockResolvedValue(falTrainingModel);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "FAILED",
      synced: true,
      modelStatus: "failed",
      error: "dataset too small",
    });

    const res = await modelsCaller().syncReplicateStatus({ modelId: 5 });

    expect(res.status).toBe("failed");
    expect(res.message).toContain("FAILED");
    expect(res.message).toContain("dataset too small");
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
  });

  it("非終態（IN_PROGRESS）→ { status:'training', message 帶 queueStatus }", async () => {
    mockGetFineTunedModel.mockResolvedValue(falTrainingModel);
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "IN_PROGRESS",
      synced: false,
    });

    const res = await modelsCaller().syncReplicateStatus({ modelId: 5 });

    expect(res.status).toBe("training");
    expect(res.message).toContain("IN_PROGRESS");
  });

  it("null（無 request id / 無 FAL_API_KEY）→ 回模型現狀與提示訊息", async () => {
    mockGetFineTunedModel.mockResolvedValue(falTrainingModel);
    mockCheckAndSyncFalTraining.mockResolvedValue(null);

    const res = await modelsCaller().syncReplicateStatus({ modelId: 5 });

    expect(res.status).toBe("training");
    expect(res.message).toContain("尚無 Fal.ai request ID");
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
  });

  it("等價承諾：replicate 模型不進 fal 分支（無 predictionId → 原訊息）", async () => {
    mockGetFineTunedModel.mockResolvedValue({
      ...replicateTrainingModel,
      replicatePredictionId: null,
      configJson: { triggerWord: "tw" },
    });

    const res = await modelsCaller().syncReplicateStatus({ modelId: 7 });

    expect(mockCheckAndSyncFalTraining).not.toHaveBeenCalled();
    expect(res.message).toBe("尚無 Replicate prediction ID");
  });

  it("legacy 行（trainingEngine='replicate' 但 configJson.falModelId 存在）也走 fal 分支", async () => {
    mockGetFineTunedModel.mockResolvedValue({
      ...falTrainingModel,
      trainingEngine: "replicate",
    });
    mockCheckAndSyncFalTraining.mockResolvedValue({
      requestId: "req-9",
      queueStatus: "IN_QUEUE",
      synced: false,
    });

    const res = await modelsCaller().syncReplicateStatus({ modelId: 5 });

    expect(mockCheckAndSyncFalTraining).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("training");
    expect(res.message).toContain("IN_QUEUE");
    expect(mockGetReplicateClient).not.toHaveBeenCalled();
  });
});

// ─── models.create — trainingEngine 欄位對映持久化 ─────────────────────────

describe("models.create — trainingEngine 持久化", () => {
  it("fal 引擎：createFineTunedModel 寫入 trainingEngine='fal'，job resultJson 帶 engine='fal'", async () => {
    // FAL_API_KEY 移除 → 不觸發 fire-and-forget 派工，只驗證持久化
    delete process.env.FAL_API_KEY;

    const res = await modelsCaller().create({
      name: "fal 建模",
      modelType: "image_subject",
      trainingEngine: "fal",
      triggerWord: "tw",
      datasetImages: [
        { url: "https://img/1.jpg", fileKey: "k1", angle: "front" },
      ],
      subjectType: "synthetic",
    });

    expect(res).toEqual({ id: 42, jobId: 900 });
    expect(mockCreateFineTunedModel).toHaveBeenCalledWith(
      expect.objectContaining({ trainingEngine: "fal" })
    );
    expect(mockCreateBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "model_training",
        resultJson: expect.objectContaining({ modelId: 42, engine: "fal" }),
      })
    );
  });
});
