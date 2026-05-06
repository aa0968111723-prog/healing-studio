import { describe, expect, it } from "vitest";
import {
  UNIFIED_MODEL_REGISTRY,
  getModelsByDomain,
  getModelById,
  queryModelsByPrompt,
  pickBestModelForDomain,
  inferDomainFromPrompt,
  recommendModels,
  generateModelRecommendationText,
  getModelRegistryStats,
  generateModelRegistrySummary,
  type ModelDomain,
} from "../../../shared/unifiedModelRegistry";

describe("unifiedModelRegistry", () => {
  describe("UNIFIED_MODEL_REGISTRY", () => {
    it("contains models from all domains", () => {
      expect(UNIFIED_MODEL_REGISTRY.length).toBeGreaterThan(0);

      const domains = new Set(UNIFIED_MODEL_REGISTRY.map(m => m.domain));
      expect(domains.has("image-upscale")).toBe(true);
      expect(domains.has("text-to-image")).toBe(true);
      expect(domains.has("image-to-3d")).toBe(true);
      expect(domains.has("audio-music")).toBe(true);
      expect(domains.has("voice-tts")).toBe(true);
    });

    it("all models have required fields", () => {
      UNIFIED_MODEL_REGISTRY.forEach(model => {
        expect(model.modelId).toBeTruthy();
        expect(model.label).toBeTruthy();
        expect(model.provider).toBeTruthy();
        expect(model.domain).toBeTruthy();
        expect(Array.isArray(model.strengths)).toBe(true);
        expect(Array.isArray(model.avoidWhen)).toBe(true);
        expect(Array.isArray(model.promptKeywords)).toBe(true);
      });
    });
  });

  describe("getModelsByDomain", () => {
    it("returns only image-upscale models", () => {
      const models = getModelsByDomain("image-upscale");
      expect(models.length).toBeGreaterThan(0);
      models.forEach(model => {
        expect(model.domain).toBe("image-upscale");
      });
    });

    it("returns only text-to-image models", () => {
      const models = getModelsByDomain("text-to-image");
      expect(models.length).toBeGreaterThan(0);
      models.forEach(model => {
        expect(model.domain).toBe("text-to-image");
      });
    });

    it("returns only image-to-3d models", () => {
      const models = getModelsByDomain("image-to-3d");
      expect(models.length).toBeGreaterThan(0);
      models.forEach(model => {
        expect(model.domain).toBe("image-to-3d");
      });
    });

    it("returns only audio-music models", () => {
      const models = getModelsByDomain("audio-music");
      expect(models.length).toBeGreaterThan(0);
      models.forEach(model => {
        expect(model.domain).toBe("audio-music");
      });
    });

    it("returns only voice-tts models", () => {
      const models = getModelsByDomain("voice-tts");
      expect(models.length).toBeGreaterThan(0);
      models.forEach(model => {
        expect(model.domain).toBe("voice-tts");
      });
    });
  });

  describe("getModelById", () => {
    it("finds existing model by ID", () => {
      const model = getModelById("fal-ai/seedvr/upscale/image");
      expect(model).toBeDefined();
      expect(model?.domain).toBe("image-upscale");
    });

    it("returns undefined for non-existent model", () => {
      const model = getModelById("non-existent-model-id");
      expect(model).toBeUndefined();
    });
  });

  describe("queryModelsByPrompt", () => {
    it("finds image upscale models for quality enhancement prompt", () => {
      const results = queryModelsByPrompt("Please enhance this photo to 4K high quality");
      expect(results.length).toBeGreaterThan(0);

      const upscaleResults = results.filter(r => r.domain === "image-upscale");
      expect(upscaleResults.length).toBeGreaterThan(0);
      expect(upscaleResults[0]?.score).toBeGreaterThan(0);
    });

    it("finds text-to-image models for generation prompt", () => {
      const results = queryModelsByPrompt("Create a photoreal cinematic product shot");
      expect(results.length).toBeGreaterThan(0);

      const textToImageResults = results.filter(r => r.domain === "text-to-image");
      expect(textToImageResults.length).toBeGreaterThan(0);
      expect(textToImageResults[0]?.score).toBeGreaterThan(0);
    });

    it("finds 3D models for 3D generation prompt", () => {
      const results = queryModelsByPrompt("Generate a 3D character model");
      expect(results.length).toBeGreaterThan(0);

      const skeletalResults = results.filter(
        r => r.domain === "image-to-3d" || r.domain === "image-to-world"
      );
      expect(skeletalResults.length).toBeGreaterThan(0);
    });

    it("respects domain filter", () => {
      const results = queryModelsByPrompt("enhance quality", {
        domains: ["image-upscale"],
      });

      results.forEach(r => {
        expect(r.domain).toBe("image-upscale");
      });
    });

    it("respects minScore filter", () => {
      const results = queryModelsByPrompt("enhance quality", {
        minScore: 1,
      });

      results.forEach(r => {
        expect(r.score).toBeGreaterThanOrEqual(1);
      });
    });

    it("respects limit option", () => {
      const results = queryModelsByPrompt("generate image", {
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("returns results sorted by score", () => {
      const results = queryModelsByPrompt("photoreal 4k quality enhance");
      expect(results.length).toBeGreaterThan(1);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });
  });

  describe("pickBestModelForDomain", () => {
    it("picks best image-upscale model for quality prompt", () => {
      const result = pickBestModelForDomain("image-upscale", "enhance to 4K photoreal quality");
      expect(result.domain).toBe("image-upscale");
      expect(result.modelId).toBe("fal-ai/seedvr/upscale/image");
      expect(result.score).toBeGreaterThan(0);
    });

    it("picks best text-to-image model for realistic prompt", () => {
      const result = pickBestModelForDomain("text-to-image", "photoreal cinematic shot");
      expect(result.domain).toBe("text-to-image");
      expect(result.modelId).toBe("fal-ai/flux-pro/v1.1");
      expect(result.score).toBeGreaterThan(0);
    });

    it("picks best 3D model for world generation prompt", () => {
      const result = pickBestModelForDomain("image-to-world", "create environment world scene");
      expect(result.domain).toBe("image-to-world");
      expect(result.score).toBeGreaterThan(0);
    });

    it("falls back to default model when no keywords match", () => {
      const result = pickBestModelForDomain("image-upscale", "xyz nonsemantic token");
      expect(result.domain).toBe("image-upscale");
      expect(result.score).toBe(0);
      expect(result.modelId).toBe("fal-ai/seedvr/upscale/image");
    });
  });

  describe("inferDomainFromPrompt", () => {
    it("infers image-upscale from upscale keywords", () => {
      const domains = inferDomainFromPrompt("Please upscale this image to 4K");
      expect(domains).toContain("image-upscale");
    });

    it("infers text-to-image from generation keywords", () => {
      const domains = inferDomainFromPrompt("Generate a beautiful photo");
      expect(domains).toContain("text-to-image");
    });

    it("infers image-to-3d from 3D keywords", () => {
      const domains = inferDomainFromPrompt("Create a 3D model");
      expect(domains).toContain("image-to-3d");
    });

    it("infers image-to-world from world keywords", () => {
      const domains = inferDomainFromPrompt("Generate an environment scene");
      expect(domains).toContain("image-to-world");
    });

    it("infers audio-music from music keywords", () => {
      const domains = inferDomainFromPrompt("Create a song with music");
      expect(domains).toContain("audio-music");
    });

    it("infers voice-tts from voice keywords", () => {
      const domains = inferDomainFromPrompt("Generate voice narration");
      expect(domains).toContain("voice-tts");
    });

    it("can infer multiple domains", () => {
      const domains = inferDomainFromPrompt("Generate a 4K quality 3D world scene");
      expect(domains.length).toBeGreaterThan(1);
    });

    it("returns all domains when no keywords match", () => {
      const domains = inferDomainFromPrompt("xyz abc nonsemantic");
      expect(domains).toEqual(["image-upscale", "text-to-image", "image-to-3d", "image-to-world", "audio-music", "voice-tts"]);
    });
  });

  describe("recommendModels", () => {
    it("recommends models based on prompt", () => {
      const results = recommendModels("Enhance my photo to 4K quality");
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("respects maxResults parameter", () => {
      const results = recommendModels("Create an image", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("includes domain information in results", () => {
      const results = recommendModels("Generate a photoreal image");
      results.forEach(result => {
        expect(result.domain).toBeTruthy();
        expect(result.modelId).toBeTruthy();
        expect(result.rationale).toBeTruthy();
      });
    });

    it("returns high-scoring matches first", () => {
      const results = recommendModels("Enhance 4K photoreal quality image");
      if (results.length > 1) {
        expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      }
    });
  });

  describe("generateModelRecommendationText", () => {
    it("generates readable text for recommendations", () => {
      const matches = recommendModels("Enhance to 4K quality");
      const text = generateModelRecommendationText(matches);

      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain("🥇");
    });

    it("handles empty matches array", () => {
      const text = generateModelRecommendationText([]);
      expect(text).toContain("沒有找到合適的模型");
    });

    it("includes model details in text", () => {
      const matches = recommendModels("4K quality");
      const text = generateModelRecommendationText(matches);

      expect(text).toContain("領域:");
      expect(text).toContain("優勢:");
    });
  });

  describe("getModelRegistryStats", () => {
    it("returns correct statistics", () => {
      const stats = getModelRegistryStats();

      expect(stats.total).toBe(UNIFIED_MODEL_REGISTRY.length);
      expect(stats.byDomain["image-upscale"]).toBeGreaterThan(0);
      expect(stats.byDomain["text-to-image"]).toBeGreaterThan(0);
      expect(stats.byDomain["image-to-3d"]).toBeGreaterThan(0);
      expect(stats.byDomain["audio-music"]).toBeGreaterThan(0);
      expect(stats.byDomain["voice-tts"]).toBeGreaterThan(0);
      expect(Object.keys(stats.byProvider).length).toBeGreaterThan(0);
    });

    it("domain counts sum to total", () => {
      const stats = getModelRegistryStats();
      const domainSum = Object.values(stats.byDomain).reduce((sum, count) => sum + count, 0);
      expect(domainSum).toBe(stats.total);
    });

    it("provider counts sum to total", () => {
      const stats = getModelRegistryStats();
      const providerSum = Object.values(stats.byProvider).reduce((sum, count) => sum + count, 0);
      expect(providerSum).toBe(stats.total);
    });
  });

  describe("generateModelRegistrySummary", () => {
    it("generates readable summary", () => {
      const summary = generateModelRegistrySummary();

      expect(summary).toBeTruthy();
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain("全站模型資訊摘要");
      expect(summary).toContain("依領域分類");
      expect(summary).toContain("依提供者分類");
    });

    it("includes model counts in summary", () => {
      const summary = generateModelRegistrySummary();
      const stats = getModelRegistryStats();

      expect(summary).toContain(`共有 ${stats.total} 個模型`);
    });

    it("includes usage instructions", () => {
      const summary = generateModelRegistrySummary();
      expect(summary).toContain("queryModelsByPrompt");
      expect(summary).toContain("recommendModels");
    });
  });
});
