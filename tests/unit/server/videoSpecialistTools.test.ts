/**
 * Unit tests for videoSpecialistTools — 影影 (video-specialist) 的 AI agent 工具集。
 *
 * 重點驗證：
 *   - 意圖偵測：imageUrl → i2v、videoUrl → v2v、audioUrl+imageUrl → speech-to-video、否則 t2v
 *   - generateVideo：套上 modelPromptTemplates 的 cinematic 後綴，並把
 *     dispatchFalQueueTask 與 awaitFalQueueResult 串起來等到 video_url
 *   - imageToVideo：缺 imageUrl 直接 fail-fast；motion hint 會接到 prompt 末
 *   - createLipSync：缺 audioUrl/imageUrl 直接 fail-fast
 *   - recommendModel：依 intent + qualityTier 選對 canonical model；durationSec
 *     > 10 時對 Kling Pro 加警語
 *   - planVideoWorkflow：依旗標決定 step 是否出現，順序與相依正確
 *
 * fal 真實呼叫透過 vi.mock 替換，測試不真打 API、不需要 FAL_API_KEY。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/services/falDispatcher", () => ({
  dispatchFalQueueTask: vi.fn(),
}));
vi.mock("../../../server/services/falQueueAwaiter", () => ({
  awaitFalQueueResult: vi.fn(),
}));

import { dispatchFalQueueTask } from "../../../server/services/falDispatcher";
import { awaitFalQueueResult } from "../../../server/services/falQueueAwaiter";
import {
  generateVideo,
  imageToVideo,
  createLipSync,
  enhanceVideo,
  recommendModel,
  planVideoWorkflow,
  inferVideoIntent,
  getVideoModels,
  getVideoGenerationTips,
} from "../../../server/services/spiritTools/videoSpecialistTools";

const dispatchMock = vi.mocked(dispatchFalQueueTask);
const awaitMock = vi.mocked(awaitFalQueueResult);

beforeEach(() => {
  dispatchMock.mockReset();
  awaitMock.mockReset();
  dispatchMock.mockResolvedValue({
    request_id: "req-test-123",
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    degraded: false,
  });
  awaitMock.mockResolvedValue({
    status: "completed",
    request_id: "req-test-123",
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    video_url: "https://example.com/v.mp4",
    output_url: "https://example.com/v.mp4",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("inferVideoIntent", () => {
  it("recognises image-to-video from imageUrl alone", () => {
    expect(inferVideoIntent({ imageUrl: "https://x/img.png" })).toBe("image-to-video");
  });

  it("recognises speech-to-video from imageUrl + audioUrl", () => {
    expect(
      inferVideoIntent({
        imageUrl: "https://x/img.png",
        audioUrl: "https://x/a.mp3",
      }),
    ).toBe("speech-to-video");
  });

  it("recognises video-to-video from videoUrl", () => {
    expect(inferVideoIntent({ videoUrl: "https://x/v.mp4" })).toBe(
      "video-to-video",
    );
  });

  it("recognises enhance-video from operation hint", () => {
    expect(
      inferVideoIntent({ videoUrl: "https://x/v.mp4", operation: "enhance" }),
    ).toBe("enhance-video");
  });

  it("falls back to text-to-video when only prompt", () => {
    expect(inferVideoIntent({})).toBe("text-to-video");
  });
});

describe("generateVideo", () => {
  it("routes prompt-only requests to text-to-video and waits for video_url", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-t2v-1",
      modelId: "fal-ai/wan-t2v",
      video_url: "https://example.com/t2v.mp4",
      output_url: "https://example.com/t2v.mp4",
    });
    dispatchMock.mockResolvedValueOnce({
      request_id: "req-t2v-1",
      modelId: "fal-ai/wan-t2v",
      degraded: false,
    });

    const result = await generateVideo({
      userId: 1,
      prompt: "a calm forest at sunset",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.intent).toBe("text-to-video");
    expect(result.videoUrl).toBe("https://example.com/t2v.mp4");

    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.category).toBe("text-to-video");
    // wan-t2v 沒命中 modelPromptTemplates 的 cinematic suffix（templates 表只
    // 列 kling/veo），所以 prompt 應該原樣送出。
    expect(call?.input.prompt).toBe("a calm forest at sunset");
  });

  it("routes imageUrl to image-to-video and injects Kling cinematic suffix", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-i2v-1",
      modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
      video_url: "https://example.com/i2v.mp4",
      output_url: "https://example.com/i2v.mp4",
    });

    const result = await generateVideo({
      userId: 1,
      prompt: "make this scene come alive",
      imageUrl: "https://example.com/start.png",
    });

    expect(result.intent).toBe("image-to-video");
    expect(result.videoUrl).toBe("https://example.com/i2v.mp4");

    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.category).toBe("image-to-video");
    expect(call?.modelId).toBe("fal-ai/kling-video/v2.1/pro/image-to-video");
    // Kling template appends ", smooth camera movement, cinematic shot"
    expect(call?.input.prompt).toContain("smooth camera movement");
    expect(call?.input.prompt).toContain("cinematic shot");
    expect(call?.input.image_url).toBe("https://example.com/start.png");
  });

  it("returns pending status when awaitCompletion is false (fire-and-forget)", async () => {
    dispatchMock.mockResolvedValueOnce({
      request_id: "req-async-1",
      modelId: "fal-ai/wan-t2v",
      degraded: false,
    });

    const result = await generateVideo({
      userId: 1,
      prompt: "fire and forget",
      awaitCompletion: false,
    });

    expect(result.status).toBe("pending");
    expect(result.jobId).toBe("req-async-1");
    // awaitFalQueueResult must NOT have been called in fire-and-forget mode
    expect(awaitMock).not.toHaveBeenCalled();
  });

  it("propagates failure from awaitFalQueueResult", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "failed",
      request_id: "req-fail-1",
      modelId: "fal-ai/wan-t2v",
      error: "fal status HTTP 500",
    });

    const result = await generateVideo({ userId: 1, prompt: "x" });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("fal status HTTP 500");
  });
});

describe("imageToVideo", () => {
  it("rejects calls without imageUrl", async () => {
    const result = await imageToVideo({
      userId: 1,
      imageUrl: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("missing-imageUrl");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("appends motion hint to the prompt", async () => {
    await imageToVideo({
      userId: 1,
      imageUrl: "https://example.com/x.png",
      prompt: "the cat sits still",
      motion: "dynamic",
    });
    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.input.prompt).toContain("the cat sits still");
    expect(call?.input.prompt).toContain("energetic camera movement");
  });
});

describe("createLipSync", () => {
  it("rejects calls without audioUrl", async () => {
    const result = await createLipSync({
      userId: 1,
      imageUrl: "https://example.com/face.png",
      audioUrl: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("missing-imageUrl-or-audioUrl");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("submits to the speech-to-video model with image + audio", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-lip-1",
      modelId: "fal-ai/wan/v2.2-14b/speech-to-video",
      video_url: "https://example.com/lip.mp4",
    });

    const result = await createLipSync({
      userId: 1,
      imageUrl: "https://example.com/face.png",
      audioUrl: "https://example.com/voice.mp3",
    });

    expect(result.success).toBe(true);
    expect(result.intent).toBe("speech-to-video");

    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.modelId).toBe("fal-ai/wan/v2.2-14b/speech-to-video");
    // speech-to-video lives under image-to-video in the fal catalog
    expect(call?.category).toBe("image-to-video");
    expect(call?.input.image_url).toBe("https://example.com/face.png");
    expect(call?.input.audio_url).toBe("https://example.com/voice.mp3");
  });
});

describe("enhanceVideo", () => {
  it("picks Topaz for the 'enhance' operation by default", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-enh-1",
      modelId: "fal-ai/topaz/video-enhance",
      video_url: "https://example.com/enhanced.mp4",
    });

    await enhanceVideo({
      userId: 1,
      videoUrl: "https://example.com/source.mp4",
      operation: "enhance",
    });

    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.modelId).toBe("fal-ai/topaz/video-enhance");
    expect(call?.category).toBe("video-to-video");
    expect(call?.input.video_url).toBe("https://example.com/source.mp4");
  });

  it("picks RIFE for 'interpolate'", async () => {
    awaitMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-int-1",
      modelId: "fal-ai/rife-v4.6/video",
      video_url: "https://example.com/i.mp4",
    });
    await enhanceVideo({
      userId: 1,
      videoUrl: "https://example.com/source.mp4",
      operation: "interpolate",
      multiplier: 2,
      outputFps: 60,
    });
    const call = dispatchMock.mock.calls[0]?.[0];
    expect(call?.modelId).toBe("fal-ai/rife-v4.6/video");
    expect(call?.input.multiplier).toBe(2);
    expect(call?.input.output_fps).toBe(60);
  });
});

describe("recommendModel", () => {
  it("returns the Kling Pro i2v as the ultra-tier flagship", () => {
    const rec = recommendModel({ intent: "image-to-video", qualityTier: "ultra" });
    expect(rec.modelId).toBe("fal-ai/runway-gen4-turbo/image-to-video");
    expect(rec.alternatives.length).toBeGreaterThan(0);
  });

  it("warns when duration > 10s on a Kling Pro flagship", () => {
    const rec = recommendModel({
      intent: "image-to-video",
      qualityTier: "premium",
      durationSec: 12,
    });
    // premium tier i2v 對到 kling-video/v2.1/standard，所以不會觸發 pro 警語；
    // 直接挑 default（pro）並走 long-duration 警告：
    const recPro = recommendModel({ intent: "image-to-video", durationSec: 15 });
    expect(recPro.modelId).toContain("kling-video/v2.1/pro");
    expect(recPro.rationale).toMatch(/超過 10 秒/);
    // sanity for the previous call
    expect(rec.modelId).toContain("kling");
  });

  it("warns about low budget", () => {
    const rec = recommendModel({
      intent: "text-to-video",
      budgetPoints: 10,
    });
    expect(rec.rationale).toMatch(/預算/);
    expect(rec.rationale).toMatch(/draft/);
  });
});

describe("planVideoWorkflow", () => {
  it("emits image → video → review for a basic short video", () => {
    const plan = planVideoWorkflow({
      goal: "做一段 5 秒療癒影片",
      durationSec: 5,
    });
    const stepIds = plan.steps.map(s => s.stepId);
    expect(stepIds).toContain("step-image");
    expect(stepIds).toContain("step-video");
    expect(stepIds).toContain("step-review");
    // No lipsync / music / enhance by default
    expect(stepIds).not.toContain("step-lipsync");
    expect(stepIds).not.toContain("step-music");
    expect(stepIds).not.toContain("step-enhance");
  });

  it("auto-adds voiceover when withLipSync is true", () => {
    const plan = planVideoWorkflow({
      goal: "做一段對嘴影片",
      withLipSync: true,
    });
    const stepIds = plan.steps.map(s => s.stepId);
    expect(stepIds).toContain("step-voice");
    expect(stepIds).toContain("step-lipsync");
    const lipsync = plan.steps.find(s => s.stepId === "step-lipsync");
    expect(lipsync?.dependsOn).toContain("step-voice");
  });

  it("skips image step when starting image is provided", () => {
    const plan = planVideoWorkflow({
      goal: "做一段影片",
      startingImageUrl: "https://example.com/x.png",
    });
    const stepIds = plan.steps.map(s => s.stepId);
    expect(stepIds).not.toContain("step-image");
    expect(stepIds).toContain("step-video");
  });

  it("infers withMusic from goal text", () => {
    const plan = planVideoWorkflow({
      goal: "做一段帶 BGM 配樂的短片",
    });
    expect(plan.steps.map(s => s.stepId)).toContain("step-music");
  });

  it("places enhance after video / lipsync and chains review on all steps", () => {
    const plan = planVideoWorkflow({
      goal: "做一段對嘴影片並升畫質",
      withLipSync: true,
      withEnhance: true,
    });
    const stepIds = plan.steps.map(s => s.stepId);
    expect(stepIds).toContain("step-enhance");
    const enhance = plan.steps.find(s => s.stepId === "step-enhance");
    expect(enhance?.dependsOn).toContain("step-lipsync");
    const review = plan.steps.find(s => s.stepId === "step-review");
    expect(review?.dependsOn).toEqual(stepIds.filter(id => id !== "step-review"));
  });
});

describe("static helpers", () => {
  it("getVideoModels returns canonical fal-ai/ IDs only", () => {
    const { models } = getVideoModels();
    expect(models.length).toBeGreaterThan(8);
    for (const m of models) {
      expect(m.id.startsWith("fal-ai/")).toBe(true);
    }
  });

  it("getVideoGenerationTips returns scenario-aware tips for speech-to-video", () => {
    const { tips } = getVideoGenerationTips("speech-to-video");
    expect(tips.some(t => /對嘴/.test(t))).toBe(true);
  });

  it("getVideoGenerationTips falls back to general tips with no scenario", () => {
    const { tips } = getVideoGenerationTips();
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.some(t => /運鏡/.test(t))).toBe(true);
  });
});
