import { describe, it, expect } from "vitest";
import {
  FAL_MODEL_CATALOG,
  findDuplicateModelIds,
  getFalModelById,
  getFalModelsByCategory,
  type FalCategory,
} from "./services/falModels";

describe("falModels catalog integrity", () => {
  it("contains no duplicate modelIds within any category", () => {
    const dups = findDuplicateModelIds();
    expect(
      dups,
      `Found duplicate modelIds (later entries unreachable):\n${dups
        .map(d => `  - [${d.category}] ${d.modelId} ×${d.count}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("image-to-3d has exactly one fal-ai/trellis entry", () => {
    const list = getFalModelsByCategory("image-to-3d");
    const trellis = list.filter(m => m.modelId === "fal-ai/trellis");
    expect(trellis).toHaveLength(1);
    // The surviving entry should be the premium variant with GLB/OBJ output
    expect(trellis[0].tier).toBe("premium");
    expect(trellis[0].outputSchema.objectUrl).toBe(true);
  });

  it("text-to-3d has exactly one fal-ai/hyper3d/rodin entry", () => {
    const list = getFalModelsByCategory("text-to-3d");
    const rodin = list.filter(m => m.modelId === "fal-ai/hyper3d/rodin");
    expect(rodin).toHaveLength(1);
    expect(rodin[0].tier).toBe("premium");
  });

  it("text-to-audio has exactly one fal-ai/mmaudio-v2 entry", () => {
    const list = getFalModelsByCategory("text-to-audio");
    const mma = list.filter(m => m.modelId === "fal-ai/mmaudio-v2");
    expect(mma).toHaveLength(1);
  });

  it("video-to-audio uses /video-to-audio variant rather than the bare modelId", () => {
    const list = getFalModelsByCategory("video-to-audio");
    const bare = list.filter(m => m.modelId === "fal-ai/mmaudio-v2");
    const v2a = list.filter(
      m => m.modelId === "fal-ai/mmaudio-v2/video-to-audio"
    );
    // Bare mmaudio-v2 was shadowed by the text-to-audio entry — it must be removed
    expect(bare).toHaveLength(0);
    expect(v2a).toHaveLength(1);
  });
});

describe("falModels catalog coverage", () => {
  it("text-to-image registers the Gemini family used by ImageStudio", () => {
    const list = getFalModelsByCategory("text-to-image");
    const ids = list.map(m => m.modelId);
    expect(ids).toContain("fal-ai/nano-banana-2");
    expect(ids).toContain("fal-ai/nano-banana-pro");
    expect(ids).toContain("fal-ai/imagen4/preview");
  });

  it("text-to-speech includes at least one ElevenLabs TTS route", () => {
    const list = getFalModelsByCategory("text-to-speech");
    const elevenLabs = list.filter(m =>
      m.modelId.startsWith("fal-ai/elevenlabs/")
    );
    expect(elevenLabs.length).toBeGreaterThanOrEqual(1);
    // Multilingual V2 (premium) should be present so voiceCompiler can route
    // through the FAL catalog instead of bypassing it via direct ElevenLabs API.
    expect(
      elevenLabs.some(m => m.modelId === "fal-ai/elevenlabs/tts/multilingual-v2")
    ).toBe(true);
  });

  it("every front-end falId from ImageStudio resolves via getFalModelById", () => {
    // Mirror the t2i falIds declared in client/src/pages/ImageStudio.tsx
    const t2iFalIds = [
      "fal-ai/nano-banana-2",
      "fal-ai/nano-banana-pro",
      "fal-ai/imagen4/preview",
    ];
    for (const id of t2iFalIds) {
      const cfg = getFalModelById(id, "text-to-image");
      expect(cfg, `expected catalog entry for ${id}`).toBeDefined();
      expect(cfg?.category).toBe("text-to-image");
    }
  });
});

describe("getFalModelById category narrowing", () => {
  it("returns the category-specific entry when category is provided", () => {
    // fal-ai/trellis exists in both image-to-3d and text-to-3d.
    // Without a category hint the first match wins; with a hint the right one is returned.
    const i23d = getFalModelById("fal-ai/trellis", "image-to-3d");
    const t23d = getFalModelById("fal-ai/trellis", "text-to-3d");
    expect(i23d?.category).toBe("image-to-3d");
    expect(t23d?.category).toBe("text-to-3d");
  });

  it("returns undefined when a model is not in the requested category", () => {
    const cfg = getFalModelById("fal-ai/imagen4/preview", "text-to-3d");
    expect(cfg).toBeUndefined();
  });

  it("falls back to a global search when category is omitted", () => {
    const cfg = getFalModelById("fal-ai/nano-banana-2");
    expect(cfg?.modelId).toBe("fal-ai/nano-banana-2");
    expect(cfg?.category).toBe("text-to-image");
  });
});

describe("falModels every catalog entry is well-formed", () => {
  it("every entry has matching category field and a non-empty label", () => {
    for (const [category, models] of Object.entries(
      FAL_MODEL_CATALOG
    ) as Array<[FalCategory, (typeof FAL_MODEL_CATALOG)[FalCategory]]>) {
      for (const m of models) {
        expect(m.category).toBe(category);
        expect(m.label.length).toBeGreaterThan(0);
        expect(m.modelId.startsWith("fal-ai/")).toBe(true);
        expect(m.timeoutMs).toBeGreaterThan(0);
      }
    }
  });
});
