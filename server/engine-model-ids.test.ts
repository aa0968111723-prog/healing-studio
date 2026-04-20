import { describe, it, expect } from "vitest";
import { normalizeEngineModelId } from "../shared/engineModelIds";

describe("normalizeEngineModelId", () => {
  it("normalizes common legacy Fal IDs to canonical IDs", () => {
    expect(normalizeEngineModelId("fal/flux-pro-1.1")).toBe(
      "fal-ai/flux-pro/v1.1"
    );
    expect(normalizeEngineModelId("fal/kling-v2.1-pro-t2v")).toBe(
      "fal-ai/kling-video/v2.1/pro/text-to-video"
    );
    expect(normalizeEngineModelId("fal/playai-tts")).toBe("fal-ai/f5-tts");
    expect(normalizeEngineModelId("fal/wan-v2v")).toBe(
      "fal-ai/wan/v2.1/video-to-video"
    );
  });

  it("returns original value when no alias exists", () => {
    expect(normalizeEngineModelId("fal-ai/flux/dev")).toBe("fal-ai/flux/dev");
    expect(normalizeEngineModelId("gemini/veo-3")).toBe("gemini/veo-3");
  });
});
