import { describe, it, expect } from "vitest";
import {
  IMAGE_TO_IMAGE_MODEL_REGISTRY,
  summarizeImageToImageModelRegistry,
  rankImageToImageModelsByPrompt,
  pickBestImageToImageModel,
} from "../../../shared/imageToImageModelRegistry";

describe("ImageToImageModelRegistry", () => {
  it("should contain at least 5 models", () => {
    expect(IMAGE_TO_IMAGE_MODEL_REGISTRY.length).toBeGreaterThanOrEqual(5);
  });

  it("should have valid model profiles", () => {
    for (const model of IMAGE_TO_IMAGE_MODEL_REGISTRY) {
      expect(model.modelId).toBeTruthy();
      expect(model.label).toBeTruthy();
      expect(model.provider).toBe("fal");
      expect(model.category).toMatch(/^(control|upscale|edit|pose|style-transfer)$/);
      expect(Array.isArray(model.strengths)).toBe(true);
      expect(Array.isArray(model.avoidWhen)).toBe(true);
      expect(Array.isArray(model.promptKeywords)).toBe(true);
    }
  });

  it("should summarize registry into JSON", () => {
    const summary = summarizeImageToImageModelRegistry(3);
    const parsed = JSON.parse(summary);

    expect(parsed.total).toBe(IMAGE_TO_IMAGE_MODEL_REGISTRY.length);
    expect(parsed.items.length).toBeLessThanOrEqual(3);
    expect(parsed.selectionPolicy).toBeDefined();
    expect(parsed.selectionPolicy.fallbackModelId).toBe("fal-ai/flux/dev/image-to-image");
  });

  it("should rank models by prompt keywords", () => {
    const matches = rankImageToImageModelsByPrompt(
      "I need to control the pose and structure of my character"
    );

    expect(matches.length).toBe(IMAGE_TO_IMAGE_MODEL_REGISTRY.length);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].matchedKeywords.length).toBeGreaterThan(0);
  });

  it("should pick ControlNet for control-related prompts", () => {
    const match = pickBestImageToImageModel("Use controlnet to maintain the structure");
    expect(match.modelId).toBe("fal-ai/flux/dev/controlnet");
    expect(match.category).toBe("control");
  });

  it("should pick DWPose for pose-related prompts", () => {
    const match = pickBestImageToImageModel("Extract the skeleton pose from this image");
    expect(match.modelId).toBe("fal-ai/dwpose");
    expect(match.category).toBe("pose");
  });

  it("should pick RemBG for background removal prompts", () => {
    const match = pickBestImageToImageModel("Remove the background and make it transparent");
    expect(match.modelId).toBe("fal-ai/imageutils/rembg");
    expect(match.category).toBe("edit");
  });

  it("should pick Flux i2i for style transfer prompts", () => {
    const match = pickBestImageToImageModel("Transform this into an artistic illustration style");
    expect(match.modelId).toBe("fal-ai/flux/dev/image-to-image");
    expect(match.category).toBe("style-transfer");
  });

  it("should fallback to Flux Dev i2i when no keywords match", () => {
    const match = pickBestImageToImageModel("random unrelated text xyz");
    expect(match.modelId).toBe("fal-ai/flux/dev/image-to-image");
    expect(match.score).toBe(0);
  });

  it("should include IP-Adapter FaceID for face-related prompts", () => {
    const matches = rankImageToImageModelsByPrompt("Keep the face identity while changing style");
    const faceModel = matches.find(m => m.modelId === "fal-ai/ip-adapter-face-id");

    expect(faceModel).toBeDefined();
    expect(faceModel!.score).toBeGreaterThan(0);
    expect(faceModel!.matchedKeywords).toContain("face");
  });

  it("should prioritize models with more keyword matches", () => {
    const matches = rankImageToImageModelsByPrompt(
      "Use pose control and structure to create a character with depth and composition"
    );

    // Models with multiple matches should rank higher
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
    expect(matches[1].score).toBeGreaterThanOrEqual(matches[2].score);
  });
});
