import { describe, expect, it } from "vitest";
import {
  getImageEditModelCatalog,
  suggestImageEditModelsByPrompt,
} from "./services/orbModelCatalog";

describe("orbModelCatalog image edit database", () => {
  it("exposes image-edit catalog entries", () => {
    const catalog = getImageEditModelCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    expect(catalog.some(item => item.modelId === "fal-ai/gpt-image-1.5/edit")).toBe(true);
  });

  it("prefers fast models for speed prompts", () => {
    const models = suggestImageEditModelsByPrompt("請幫我快速修圖，保留主體");
    expect(models[0]?.tier).toBe("fast");
  });
});
