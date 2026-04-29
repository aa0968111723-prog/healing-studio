import { describe, expect, it } from "vitest";
import {
  FAL_MODEL_CAPABILITIES,
  findCompatibleModel,
  getModelCapability,
  getModelFeature,
  isModelCompatibleWith,
  listIncompatibleFeatures,
} from "../shared/falModelCapabilities";

describe("falModelCapabilities", () => {
  it("registers core image models with expected capability flags", () => {
    const sd = getModelCapability("fal-ai/stable-diffusion-v35-large");
    expect(sd?.features.tokenWeights).toBe(true);
    expect(sd?.features.loraInjection).toBe(true);
    expect(sd?.features.aspectRatioWide).toBe(true);

    const fluxDev = getModelCapability("fal-ai/flux/dev");
    expect(fluxDev?.features.tokenWeights).toBe(false); // FLUX 不解析 (token:weight)
    expect(fluxDev?.features.loraInjection).toBe(true);

    const nanoBanana = getModelCapability("fal-ai/nano-banana-2");
    expect(nanoBanana?.features.tokenWeights).toBe(false);
    expect(nanoBanana?.features.loraInjection).toBe(false);
  });

  it("getModelFeature returns false for unknown models without throwing", () => {
    expect(getModelFeature("fal-ai/unknown-model", "tokenWeights")).toBe(false);
    expect(getModelFeature("fal-ai/unknown-model", "loraInjection")).toBe(false);
  });

  it("isModelCompatibleWith allows unknown models (don't break user)", () => {
    expect(
      isModelCompatibleWith("fal-ai/unknown-model", { tokenWeights: true })
    ).toBe(true);
  });

  it("isModelCompatibleWith blocks model when active feature missing", () => {
    expect(
      isModelCompatibleWith("fal-ai/nano-banana-2", { tokenWeights: true })
    ).toBe(false);
    expect(
      isModelCompatibleWith("fal-ai/nano-banana-2", { tokenWeights: false })
    ).toBe(true);
  });

  it("listIncompatibleFeatures enumerates only the missing features", () => {
    const missing = listIncompatibleFeatures("fal-ai/nano-banana-2", {
      tokenWeights: true,
      loraInjection: true,
      aspectRatioWide: true,
    });
    expect(missing).toEqual(
      expect.arrayContaining(["tokenWeights", "loraInjection"])
    );
    expect(missing).not.toContain("aspectRatioWide"); // nano-banana 支援寬比例
  });

  it("findCompatibleModel returns SD-family for tokenWeights+lora image task", () => {
    const found = findCompatibleModel("image", {
      tokenWeights: true,
      loraInjection: true,
    });
    expect(found).not.toBeNull();
    const cap = getModelCapability(found!);
    expect(cap?.features.tokenWeights).toBe(true);
    expect(cap?.features.loraInjection).toBe(true);
  });

  it("findCompatibleModel returns null when no model satisfies (impossible combo)", () => {
    // Voice 模態無任何模型支援 LoRA
    const found = findCompatibleModel("voice", { loraInjection: true });
    expect(found).toBeNull();
  });

  it("FLUX schnell does NOT advertise loraInjection", () => {
    expect(getModelFeature("fal-ai/flux/schnell", "loraInjection")).toBe(false);
  });

  it("Imagen does NOT support 21:9 wide ratio", () => {
    expect(getModelFeature("fal-ai/imagen4/preview", "aspectRatioWide")).toBe(
      false
    );
    expect(
      getModelFeature("fal-ai/imagen4/preview", "aspectRatioStandard")
    ).toBe(true);
  });

  it("registry entries all have valid modality enum values", () => {
    for (const cap of FAL_MODEL_CAPABILITIES) {
      expect(["image", "video", "audio", "voice"]).toContain(cap.modality);
    }
  });
});
