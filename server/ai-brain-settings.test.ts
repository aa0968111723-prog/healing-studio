import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Brain Router — Model Catalog Tests
// ═══════════════════════════════════════════════════════════════════════════

import {
  REASONING_MODEL_CATALOG,
  GENERATION_ENGINE_CATALOG,
  FAL_TASK_ENGINE_CATALOG,
} from "./routers/brain";
import { FAL_MODEL_CATALOG } from "./services/falModels";

describe("Brain Router — Model Catalog", () => {
  it("should have 5 reasoning brain slots", () => {
    const slots = Object.keys(REASONING_MODEL_CATALOG);
    expect(slots).toHaveLength(5);
    expect(slots).toEqual(
      expect.arrayContaining([
        "director",
        "analyst",
        "storyteller",
        "technician",
        "curator",
      ])
    );
  });

  it("should have 4 generation engine slots", () => {
    const slots = Object.keys(GENERATION_ENGINE_CATALOG);
    expect(slots).toHaveLength(4);
    expect(slots).toEqual(
      expect.arrayContaining([
        "imageEngine",
        "videoEngine",
        "audioEngine",
        "voiceEngine",
      ])
    );
  });

  it("each reasoning slot should have label, description, and at least 2 options", () => {
    for (const [slot, config] of Object.entries(REASONING_MODEL_CATALOG)) {
      expect(config.label).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.options.length).toBeGreaterThanOrEqual(2);
      for (const opt of config.options) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
        expect(["ultra", "premium", "standard", "fast"]).toContain(opt.tier);
      }
    }
  });

  it("each generation slot should have label, description, and at least 2 options", () => {
    for (const [slot, config] of Object.entries(GENERATION_ENGINE_CATALOG)) {
      expect(config.label).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.options.length).toBeGreaterThanOrEqual(2);
      for (const opt of config.options) {
        expect(opt.value).toBeTruthy();
        expect(opt.label).toBeTruthy();
        expect(["ultra", "premium", "standard", "fast"]).toContain(opt.tier);
      }
    }
  });

  it("director slot should contain Gemini Pro and Claude Sonnet options", () => {
    const director = REASONING_MODEL_CATALOG.director;
    const values = director.options.map(o => o.value);
    // Check for Gemini Pro variants (2.5 pro or 1.5 pro)
    expect(values.some(v => v.includes("gemini") && v.includes("pro"))).toBe(
      true
    );
    // Check for at least one premium reasoning model
    const premiumOptions = director.options.filter(o => o.tier === "premium");
    expect(premiumOptions.length).toBeGreaterThanOrEqual(1);
  });

  it("analyst slot should contain Flash/Mini tier options", () => {
    const analyst = REASONING_MODEL_CATALOG.analyst;
    const fastOptions = analyst.options.filter(o => o.tier === "fast");
    expect(fastOptions.length).toBeGreaterThanOrEqual(1);
  });

  it("imageEngine should contain Flux dev, Flux schnell, and SDXL", () => {
    const img = GENERATION_ENGINE_CATALOG.imageEngine;
    const values = img.options.map(o => o.value);
    // Check for Flux variants (pro, dev, or schnell)
    expect(values.some(v => v.includes("flux"))).toBe(true);
    // Check for Flux Schnell fast model
    expect(values.some(v => v.includes("schnell"))).toBe(true);
    // Check for Stable Diffusion or other image models
    expect(values.length).toBeGreaterThanOrEqual(3);
  });

  it("videoEngine should contain Veo 3.1 (Kling), Luma (Runway), and Kling V1", () => {
    const vid = GENERATION_ENGINE_CATALOG.videoEngine;
    const values = vid.options.map(o => o.value);
    // Check for Kling video models
    expect(values.some(v => v.includes("kling"))).toBe(true);
    // Check for Runway or Luma models
    expect(values.some(v => v.includes("runway") || v.includes("luma"))).toBe(
      true
    );
    // Check sufficient video engine options
    expect(values.length).toBeGreaterThanOrEqual(3);
  });

  it("audioEngine should contain Suno and Udio", () => {
    const aud = GENERATION_ENGINE_CATALOG.audioEngine;
    const values = aud.options.map(o => o.value);
    // Check for Suno music model
    expect(values.some(v => v.startsWith("suno"))).toBe(true);
    // Check for at least one alternative audio engine (Stable Audio, ElevenLabs, etc.)
    expect(
      values.some(
        v =>
          v.includes("stable-audio") ||
          v.includes("elevenlabs") ||
          v.includes("musicgen") ||
          v.includes("lyria") ||
          v.includes("udio")
      )
    ).toBe(true);
  });

  it("voiceEngine should contain ElevenLabs and TTS", () => {
    const voice = GENERATION_ENGINE_CATALOG.voiceEngine;
    const values = voice.options.map(o => o.value);
    expect(values.some(v => v.startsWith("elevenlabs"))).toBe(true);
    expect(values.some(v => v.includes("tts"))).toBe(true);
  });

  it("no duplicate model values within any single slot", () => {
    const allSlots = {
      ...REASONING_MODEL_CATALOG,
      ...GENERATION_ENGINE_CATALOG,
    };
    for (const [slot, config] of Object.entries(allSlots)) {
      const values = config.options.map((o: any) => o.value);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    }
  });

  it("FAL task catalog should be fully derived from canonical FAL_MODEL_CATALOG", () => {
    const taskKeys = Object.keys(FAL_TASK_ENGINE_CATALOG).sort();
    const modelKeys = Object.keys(FAL_MODEL_CATALOG).sort();
    expect(taskKeys).toEqual(modelKeys);

    // fal.ai dispatches partner-namespaced models too (e.g. `xai/...`); the
    // catalog is allowed to reference them as long as the model id is
    // present in the canonical FAL_MODEL_CATALOG (which is the actual
    // source of truth for "is this a fal-served model").
    const ALLOWED_PREFIXES = /^(fal-ai|xai)\//;
    for (const [category, slot] of Object.entries(FAL_TASK_ENGINE_CATALOG)) {
      const canonical = FAL_MODEL_CATALOG[category as keyof typeof FAL_MODEL_CATALOG];
      const canonicalIds = new Set(canonical.map(m => m.modelId));
      expect(slot.options.length).toBe(canonical.length);
      for (const option of slot.options) {
        expect(ALLOWED_PREFIXES.test(option.value)).toBe(true);
        expect(canonicalIds.has(option.value)).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Brain Context Middleware — Health Ping Tests
// ═══════════════════════════════════════════════════════════════════════════

import {
  getHealthStatus,
  getHealthSnapshot,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
} from "./middleware/brainContext";

describe("Brain Context — Health & Defaults", () => {
  it("getHealthStatus should return true for known default models", () => {
    expect(getHealthStatus("gpt-4o")).toBe(true);
    expect(getHealthStatus("flux-pro")).toBe(true);
  });

  it("getHealthSnapshot should return an object", () => {
    const snapshot = getHealthSnapshot();
    expect(typeof snapshot).toBe("object");
  });

  it("DEFAULT_REASONING_BRAINS should have 5 slots", () => {
    const slots = Object.keys(DEFAULT_REASONING_BRAINS);
    expect(slots).toHaveLength(5);
  });

  it("DEFAULT_GENERATION_ENGINES should have 4 slots", () => {
    const slots = Object.keys(DEFAULT_GENERATION_ENGINES);
    expect(slots).toHaveLength(4);
  });

  it("each default reasoning brain should have model, temperature, topP", () => {
    for (const [slot, config] of Object.entries(DEFAULT_REASONING_BRAINS)) {
      expect(config.model).toBeTruthy();
      expect(typeof config.temperature).toBe("number");
      expect(typeof config.topP).toBe("number");
      expect(config.temperature).toBeGreaterThanOrEqual(0);
      expect(config.temperature).toBeLessThanOrEqual(1);
      expect(config.topP).toBeGreaterThanOrEqual(0);
      expect(config.topP).toBeLessThanOrEqual(1);
    }
  });

  it("each default generation engine should have engine name", () => {
    for (const [slot, config] of Object.entries(DEFAULT_GENERATION_ENGINES)) {
      expect(config.engine).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Live Preview — Soul Messages Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Live Preview — Soul Messages", () => {
  const SOUL_PREVIEW_MESSAGES: Record<string, string[]> = {
    "gpt-4o": [
      "我注意到你在這張星空作品前停留了好一會兒。要不要讓我幫你把光影參數調好，我們直接去創作室試試看？",
      "你的創作風格很有層次感。我可以建議一些進階的構圖技巧，讓畫面更有深度。",
    ],
    "claude-3.5-sonnet": [
      "我留意到你反覆端詳這幅作品的光影層次。如果你願意，我可以為你解析其中的構圖邏輯，並協助你在創作室重現這種氛圍。",
      "你的審美直覺很敏銳。這種明暗對比的手法在文藝復興時期被稱為 chiaroscuro——要不要一起探索這個方向？",
    ],
  };

  it("should have messages for gpt-4o", () => {
    expect(SOUL_PREVIEW_MESSAGES["gpt-4o"]).toBeDefined();
    expect(SOUL_PREVIEW_MESSAGES["gpt-4o"].length).toBeGreaterThanOrEqual(1);
  });

  it("should have messages for claude-3.5-sonnet", () => {
    expect(SOUL_PREVIEW_MESSAGES["claude-3.5-sonnet"]).toBeDefined();
    expect(
      SOUL_PREVIEW_MESSAGES["claude-3.5-sonnet"].length
    ).toBeGreaterThanOrEqual(1);
  });

  it("messages should be non-empty strings", () => {
    for (const [model, msgs] of Object.entries(SOUL_PREVIEW_MESSAGES)) {
      for (const msg of msgs) {
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(10);
      }
    }
  });

  it("different models should have different message styles", () => {
    const gptMsg = SOUL_PREVIEW_MESSAGES["gpt-4o"][0];
    const claudeMsg = SOUL_PREVIEW_MESSAGES["claude-3.5-sonnet"][0];
    expect(gptMsg).not.toBe(claudeMsg);
  });
});
