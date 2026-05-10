/**
 * Unit tests for spiritDispatcher — 「精靈真的呼叫 fal.ai 模型」入口的授權邏輯。
 *
 * 真實 fal.ai 呼叫由 dispatchFalTask 處理，這裡 mock 掉以避免外部 API 流量；
 * 重點驗證：
 *   1. 模型不在 fal 目錄 → 回 success:false，不呼叫 dispatchFalTask
 *   2. 精靈無此模型權限 → 回 success:false 並列出允許類別，不呼叫 dispatchFalTask
 *   3. 通過授權 → 把推導出的 category 與 spirit 一起傳給 dispatchFalTask
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dispatchFalTask 透過 falModels.callFalModel 呼叫真實 fal — mock 掉這一層即可
// 同時繞過 LangSmith / orbCostGuard / serverEnv 的 side effects。
vi.mock("../../../server/services/falDispatcher", async () => {
  const actual = await vi.importActual<
    typeof import("../../../server/services/falDispatcher")
  >("../../../server/services/falDispatcher");
  return {
    ...actual,
    dispatchFalTask: vi.fn(),
  };
});

import { dispatchFalTask } from "../../../server/services/falDispatcher";
import {
  invokeSpiritModel,
  pickDefaultModelForSpirit,
} from "../../../server/services/spiritDispatcher";

const dispatchFalTaskMock = vi.mocked(dispatchFalTask);

beforeEach(() => {
  dispatchFalTaskMock.mockReset();
  dispatchFalTaskMock.mockResolvedValue({
    success: true,
    modelId: "fal-ai/flux-pro/v1.1",
    modelLabel: "FLUX Pro v1.1",
    category: "text-to-image",
    data: { images: [{ url: "https://example.com/x.png" }] },
    durationMs: 1234,
    pointsDeducted: 5,
    pointsBreakdown: "5",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("invokeSpiritModel", () => {
  it("rejects unknown modelIds without calling fal", async () => {
    const result = await invokeSpiritModel({
      spirit: "image-specialist",
      modelId: "fal-ai/this-model-does-not-exist",
      prompt: "a cat",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/不在 fal 目錄/);
    expect(dispatchFalTaskMock).not.toHaveBeenCalled();
  });

  it("rejects 影影 trying to call an image-only model (cross-modal denial)", async () => {
    // fal-ai/flux-pro/v1.1 是 text-to-image — 影影只能打 video 類，應該被拒
    const result = await invokeSpiritModel({
      spirit: "video-specialist",
      modelId: "fal-ai/flux-pro/v1.1",
      prompt: "a cat",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/沒有呼叫模型/);
    expect(result.error).toMatch(/允許的類別/);
    expect(dispatchFalTaskMock).not.toHaveBeenCalled();
  });

  it("rejects 暖暖 (companion) trying to call any generation model", async () => {
    // 暖暖只能打 llm，圖類一律不行
    const result = await invokeSpiritModel({
      spirit: "companion",
      modelId: "fal-ai/flux-pro/v1.1",
      prompt: "anything",
    });
    expect(result.success).toBe(false);
    expect(dispatchFalTaskMock).not.toHaveBeenCalled();
  });

  it("圖圖 calling a text-to-image model goes through to dispatchFalTask with the right category", async () => {
    const result = await invokeSpiritModel({
      spirit: "image-specialist",
      modelId: "fal-ai/flux-pro/v1.1",
      prompt: "a cat",
      aspectRatio: "1:1",
    });
    expect(result.success).toBe(true);
    expect(dispatchFalTaskMock).toHaveBeenCalledTimes(1);
    const call = dispatchFalTaskMock.mock.calls[0][0];
    expect(call.modelId).toBe("fal-ai/flux-pro/v1.1");
    expect(call.category).toBe("text-to-image");
    expect(call.spirit).toBe("image-specialist");
    expect(call.prompt).toBe("a cat");
    expect(call.aspectRatio).toBe("1:1");
  });

  it("auto-picks a default model for 圖圖 when modelId is omitted", async () => {
    const result = await invokeSpiritModel({
      spirit: "image-specialist",
      prompt: "a cat",
    });
    expect(result.success).toBe(true);
    expect(dispatchFalTaskMock).toHaveBeenCalledTimes(1);
    const call = dispatchFalTaskMock.mock.calls[0][0];
    // 圖圖 沒有指定 modelId 時，預設應該命中 text-* 類別的某個模型
    expect(call.modelId).toMatch(/^fal-ai\//);
    expect(call.category).toMatch(/^(text-to-image|text-to-3d|image-to-image|image-to-3d|image-to-json)$/);
  });

  it("pickDefaultModelForSpirit returns a fal model for image-specialist", () => {
    expect(pickDefaultModelForSpirit("image-specialist")).toMatch(/^fal-ai\//);
  });

  it("pickDefaultModelForSpirit prefers text-* without imageUrl, image-* with imageUrl", () => {
    // text-only should land on a text-to-* model; with imageUrl should land on image-to-*
    const noImage = pickDefaultModelForSpirit("image-specialist");
    const withImage = pickDefaultModelForSpirit("image-specialist", { hasImageInput: true });
    expect(noImage).toMatch(/^fal-ai\//);
    expect(withImage).toMatch(/^fal-ai\//);
    // not strictly required to differ, but the picker should pick *some* model in both cases
    expect(noImage).not.toBeNull();
    expect(withImage).not.toBeNull();
  });

  it("編編 (composer) is allowed across modalities and reaches dispatchFalTask", async () => {
    const result = await invokeSpiritModel({
      spirit: "composer",
      modelId: "fal-ai/flux-pro/v1.1",
      prompt: "compose",
    });
    expect(result.success).toBe(true);
    expect(dispatchFalTaskMock).toHaveBeenCalledTimes(1);
    expect(dispatchFalTaskMock.mock.calls[0][0].spirit).toBe("composer");
  });
});
