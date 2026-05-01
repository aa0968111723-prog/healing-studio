/**
 * orb-train-lora-tool.test.ts
 *
 * Verifies the new `studio.trainLora` tool dispatcher:
 *   - Creates the fineTunedModel + backgroundJob rows up front
 *   - Returns { modelId, jobId, status: "queued", monitorUrl } immediately
 *   - Validates modelType, name, dataset minimums, env keys
 *   - Honours the requiresHuman approval gate
 *
 * The actual fal/replicate training jobs are mocked so the test doesn't
 * wait 5–30 minutes for a real job. We assert that the dispatcher kicks
 * off the right runner with the right input.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockCreateFineTunedModel = vi.fn().mockResolvedValue(42);
const mockCreateBackgroundJob = vi.fn().mockResolvedValue(99);
const mockRunFalTrainingJob = vi.fn().mockResolvedValue(undefined);
const mockRunLoraTrainingJob = vi.fn().mockResolvedValue(undefined);
const mockResolveFalTrainingModel = vi
  .fn()
  .mockReturnValue("fal-ai/flux-lora-fast-training");

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createFineTunedModel: mockCreateFineTunedModel,
    createBackgroundJob: mockCreateBackgroundJob,
  };
});

vi.mock("./services/falTrainer", () => ({
  runFalTrainingJob: mockRunFalTrainingJob,
  resolveFalTrainingModel: mockResolveFalTrainingModel,
}));

vi.mock("./services/loraTrainer", () => ({
  runLoraTrainingJob: mockRunLoraTrainingJob,
}));

import { executeOrbToolCalls } from "./services/agentToolExecutor";

const ORIGINAL_FAL = process.env.FAL_API_KEY;
const ORIGINAL_REPLICATE = process.env.REPLICATE_API_TOKEN;

beforeEach(() => {
  process.env.FAL_API_KEY = "test-fal-key";
  process.env.REPLICATE_API_TOKEN = "test-replicate-token";
  mockCreateFineTunedModel.mockClear();
  mockCreateBackgroundJob.mockClear();
  mockRunFalTrainingJob.mockClear();
  mockRunLoraTrainingJob.mockClear();
  mockResolveFalTrainingModel.mockClear();
  mockResolveFalTrainingModel.mockReturnValue("fal-ai/flux-lora-fast-training");
});

afterEach(() => {
  process.env.FAL_API_KEY = ORIGINAL_FAL;
  process.env.REPLICATE_API_TOKEN = ORIGINAL_REPLICATE;
});

const baseTrainArgs = {
  modelType: "image_subject",
  name: "我的貓咪",
  triggerWord: "mycat",
  trainingEngine: "fal",
  datasetImages: [
    { url: "https://cdn.example/cat1.png" },
    { url: "https://cdn.example/cat2.png" },
    { url: "https://cdn.example/cat3.png" },
  ],
};

describe("studio.trainLora orb tool", () => {
  it("creates model + job rows and returns the queued envelope", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [{ name: "studio.trainLora", args: baseTrainArgs }],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].ok).toBe(true);
    expect(out[0].data).toMatchObject({
      modelId: 42,
      jobId: 99,
      status: "queued",
      modelType: "image_subject",
      modelName: "我的貓咪",
      triggerWord: "mycat",
      trainingEngine: "fal",
      datasetSize: 3,
      monitorUrl: "/training-jobs?jobId=99",
    });
    expect(mockCreateFineTunedModel).toHaveBeenCalledTimes(1);
    expect(mockCreateBackgroundJob).toHaveBeenCalledTimes(1);
  });

  it("dispatches the fal training runner with derived steps + the resolved fal modelId", async () => {
    await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.trainLora",
          args: { ...baseTrainArgs, epochs: 25, learningRate: 0.0002, isStyle: true },
        },
      ],
      userId: 7,
      userRole: "user",
      approved: true,
    });
    // Wait a tick for the fire-and-forget background dispatch.
    await new Promise(r => setTimeout(r, 0));
    expect(mockResolveFalTrainingModel).toHaveBeenCalledWith("image_subject");
    expect(mockRunFalTrainingJob).toHaveBeenCalledTimes(1);
    const args = mockRunFalTrainingJob.mock.calls[0][0];
    expect(args.userId).toBe(7);
    expect(args.modelId).toBe(42);
    expect(args.jobId).toBe(99);
    expect(args.steps).toBe(2_500); // 25 epochs * 100 = 2_500 (within ceiling)
    expect(args.learningRate).toBeCloseTo(0.0002);
    expect(args.isStyle).toBe(true);
    expect(args.imageUrls).toEqual([
      "https://cdn.example/cat1.png",
      "https://cdn.example/cat2.png",
      "https://cdn.example/cat3.png",
    ]);
    expect(args.falModelId).toBe("fal-ai/flux-lora-fast-training");
  });

  it("routes to the replicate runner when trainingEngine='replicate'", async () => {
    await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.trainLora",
          args: { ...baseTrainArgs, trainingEngine: "replicate" },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    await new Promise(r => setTimeout(r, 0));
    expect(mockRunLoraTrainingJob).toHaveBeenCalledTimes(1);
    expect(mockRunFalTrainingJob).not.toHaveBeenCalled();
  });

  it("requires approval for the high-risk training tool", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [{ name: "studio.trainLora", args: baseTrainArgs }],
      userId: 1,
      userRole: "user",
      approved: false,
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toBe("confirmation-required");
    expect(mockCreateFineTunedModel).not.toHaveBeenCalled();
  });

  it("rejects unsupported modelType", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.trainLora",
          args: { ...baseTrainArgs, modelType: "not_a_thing" },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/unsupported-training-model-type/);
  });

  it("rejects an empty dataset (need at least one image or video)", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.trainLora",
          args: { ...baseTrainArgs, datasetImages: [], datasetVideos: [] },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/training-dataset-empty/);
  });

  it("rejects when the engine's API key is missing", async () => {
    process.env.FAL_API_KEY = "";
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [{ name: "studio.trainLora", args: baseTrainArgs }],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toMatch(/FAL_API_KEY/);
  });

  it("accepts mixed dataset (raw URL strings + {url, fileKey} objects)", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.trainLora",
          args: {
            ...baseTrainArgs,
            datasetImages: [
              "https://cdn.example/raw.png",
              { url: "https://cdn.example/structured.png", fileKey: "k1" },
            ],
          },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(out[0].ok).toBe(true);
    expect((out[0].data as { datasetSize: number }).datasetSize).toBe(2);
  });
});
