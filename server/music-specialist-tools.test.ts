/**
 * server/music-specialist-tools.test.ts
 *
 * 音音 (music-specialist) 真實工具集的單元測試。對齊 accountant-tools.test.ts
 * 的測試風格。
 *
 * 重點覆蓋：
 *   - recommendEngine：capability 過濾、duration 適配、tier 評分、缺金鑰降權
 *   - buildPrompt：四條 model-specific 分支（Suno / ACE-Step / Stable Audio /
 *     MusicGen / Sonauto / SFX）的 prompt 形狀
 *   - estimateMusicCost：對齊 modelPricing catalog
 *   - listEngines：capability 過濾 + 排序
 *   - generate / generateSoundEffect：modelId fallback 與缺金鑰降級
 *     （只測 modelIdUsed，dispatchGenerationJob 被 mock 掉，不真打 fal）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recommendEngine,
  buildPrompt,
  estimateMusicCost,
  listEngines,
  getMusicOptions,
  getMusicGenerationTips,
  generateMusic,
  generateSoundEffect,
} from "./services/spiritTools/musicSpecialistTools";

// ─── recommendEngine ──────────────────────────────────────────────────────────

describe("musicSpecialistTools.recommendEngine", () => {
  it("filters by capability and returns a primary recommendation", () => {
    const result = recommendEngine({ capability: "sfx", durationSec: 5 });
    expect(result.primary).not.toBeNull();
    // SFX 候選必須有 sfx capability — Suno 不應該出現
    expect(result.primary!.modelId).not.toMatch(/suno/i);
    expect(result.poolSize).toBeGreaterThan(0);
  });

  it("prefers vocal-capable engines when needsVocals=true", () => {
    const result = recommendEngine({
      capability: "music-vocals",
      durationSec: 90,
      needsVocals: true,
    });
    expect(result.primary).not.toBeNull();
    // music-vocals → 候選必須含 vocal 能力（Suno / ACE-Step / ElevenLabs Music）
    const vocalEngines = [
      "suno-v4",
      "suno-v3.5",
      "fal-ai/ace-step",
      "elevenlabs/music",
    ];
    expect(vocalEngines).toContain(result.primary!.modelId);
  });

  it("excludes vocals-only engines when needsVocals=false on music-instrumental", () => {
    const result = recommendEngine({
      capability: "music-instrumental",
      durationSec: 30,
      needsVocals: false,
    });
    expect(result.primary).not.toBeNull();
    // recommendEngine 對 needsVocals=false 只排除「只能出 vocal」的引擎；
    // both-capable（Suno / ACE-Step）會留下但純伴奏引擎會被加分 → primary
    // 不應該是 Suno（Suno 都是 vocal 為主），但 ACE-Step / Stable / MusicGen
    // 都合理。確認 primary 至少有 instrumental capability。
    const instrumentalOk = [
      "fal-ai/stable-audio",
      "fal-ai/musicgen",
      "fal-ai/ace-step",
      "fal-ai/mmaudio-v2",
      "gemini/lyria-2",
    ];
    expect(instrumentalOk).toContain(result.primary!.modelId);
  });

  it("prioritizes budget engines when prioritizeBudget=true", () => {
    const budgetResult = recommendEngine({
      capability: "music-instrumental",
      durationSec: 30,
      prioritizeBudget: true,
    });
    const qualityResult = recommendEngine({
      capability: "music-instrumental",
      durationSec: 30,
      prioritizeBudget: false,
    });

    expect(budgetResult.primary).not.toBeNull();
    expect(qualityResult.primary).not.toBeNull();
    // 預算模式下 primary 點數應該 ≤ 品質模式（或差不多）
    expect(budgetResult.primary!.totalPoints).toBeLessThanOrEqual(
      qualityResult.primary!.totalPoints + 5
    );
  });

  it("excludes specified engines via excludeModelIds", () => {
    const result = recommendEngine({
      capability: "music-vocals",
      excludeModelIds: ["suno-v4", "suno-v3.5"],
    });
    expect(result.primary).not.toBeNull();
    expect(result.primary!.modelId).not.toMatch(/suno/);
  });

  it("flags engines as notAvailable when their extra key env is missing", () => {
    const original = process.env.SUNO_API_KEY;
    delete process.env.SUNO_API_KEY;
    try {
      const result = recommendEngine({
        capability: "music-vocals",
        durationSec: 120,
      });
      // primary 不一定是 Suno，但 alternates 裡如果出現 Suno，它應該被標 notAvailable
      const sunoEntries = [result.primary, ...result.alternates].filter(
        (r): r is NonNullable<typeof r> => r !== null && r.modelId.startsWith("suno")
      );
      for (const e of sunoEntries) {
        expect(e.notAvailable).toBe(true);
        expect(e.missingKeyEnv).toBe("SUNO_API_KEY");
      }
    } finally {
      if (original !== undefined) process.env.SUNO_API_KEY = original;
    }
  });

  it("returns primary=null when no candidate matches capability", () => {
    // 自編一個不存在的 capability — 用 `as never` 強制繞過 TS，模擬 LLM 傳壞字串
    const result = recommendEngine({
      capability: "nonexistent" as never,
    });
    expect(result.primary).toBeNull();
    expect(result.alternates).toHaveLength(0);
    expect(result.poolSize).toBe(0);
  });
});

// ─── buildPrompt ──────────────────────────────────────────────────────────────

describe("musicSpecialistTools.buildPrompt", () => {
  it("formats Suno prompt with lyrics passthrough", () => {
    const result = buildPrompt({
      modelId: "suno-v4",
      mood: "uplifting",
      genre: "pop",
      lyrics: "[Verse]\nHello world",
    });
    expect(result.modelId).toBe("suno-v4");
    expect(result.lyrics).toBe("[Verse]\nHello world");
    expect(result.rationale).toContain("Suno");
  });

  it("formats ACE-Step prompt with lyrics when supplied", () => {
    const result = buildPrompt({
      modelId: "fal-ai/ace-step",
      mood: "energetic",
      genre: "rock",
      lyrics: "rocking the night",
      bpm: 120,
    });
    expect(result.modelId).toBe("fal-ai/ace-step");
    expect(result.lyrics).toBe("rocking the night");
    expect(result.prompt).toContain("120 BPM");
  });

  it("strips lyrics when targeting MusicGen (which doesn't accept lyrics)", () => {
    const result = buildPrompt({
      modelId: "fal-ai/musicgen",
      mood: "calm",
      lyrics: "would be ignored",
    });
    expect(result.lyrics).toBeUndefined();
    expect(result.prompt).toContain("calm");
  });

  it("adds seamless loop hint for Stable Audio when requested", () => {
    const result = buildPrompt({
      modelId: "fal-ai/stable-audio",
      mood: "ambient",
      seamlessLoop: true,
    });
    expect(result.prompt).toContain("seamless loop");
  });

  it("emits Sonauto tags string when targeting sonauto v2", () => {
    const result = buildPrompt({
      modelId: "sonauto/v2/text-to-music",
      mood: "epic",
      genre: "cinematic",
      instruments: ["strings", "drums"],
    });
    expect(result.tags).toBeDefined();
    expect(result.tags).toContain("cinematic");
    expect(result.tags).toContain("strings");
  });

  it("falls back to a sensible default prompt for SFX engines", () => {
    const result = buildPrompt({
      modelId: "fal-ai/elevenlabs/sound-effects/v2",
      references: "thunder rolling in the distance",
    });
    expect(result.prompt).toContain("thunder rolling");
    expect(result.rationale).toContain("SFX");
  });
});

// ─── estimateMusicCost ────────────────────────────────────────────────────────

describe("musicSpecialistTools.estimateMusicCost", () => {
  it("returns label and tier for a known audio model", () => {
    const result = estimateMusicCost({
      modelId: "fal-ai/stable-audio",
      durationSec: 30,
    });
    expect(result.modelId).toBe("fal-ai/stable-audio");
    expect(result.label).toBeTruthy();
    expect(result.tier).not.toBeNull();
    expect(result.totalPoints).toBeGreaterThan(0);
    expect(result.isUnknownModel).toBe(false);
  });

  it("flags unknown models with isUnknownModel=true and 5pts fallback", () => {
    const result = estimateMusicCost({ modelId: "fake-audio-engine" });
    expect(result.isUnknownModel).toBe(true);
    expect(result.totalPoints).toBe(5);
  });

  it("scales with duration for engines that have pointsPerSecond", () => {
    const short = estimateMusicCost({
      modelId: "fal-ai/stable-audio",
      durationSec: 30,
    });
    const long = estimateMusicCost({
      modelId: "fal-ai/stable-audio",
      durationSec: 120,
    });
    expect(long.totalPoints).toBeGreaterThanOrEqual(short.totalPoints);
  });
});

// ─── listEngines ──────────────────────────────────────────────────────────────

describe("musicSpecialistTools.listEngines", () => {
  it("returns all engines when no capability is specified", () => {
    const result = listEngines();
    expect(result.capability).toBe("all");
    expect(result.count).toBeGreaterThan(0);
    expect(result.rows.length).toBe(result.count);
  });

  it("filters to engines that include the requested capability", () => {
    const result = listEngines({ capability: "music-loop" });
    expect(result.capability).toBe("music-loop");
    for (const row of result.rows) {
      expect(row.capabilities).toContain("music-loop");
    }
  });

  it("orders rows by estimated30sPoints ascending", () => {
    const result = listEngines();
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i].estimated30sPoints).toBeGreaterThanOrEqual(
        result.rows[i - 1].estimated30sPoints
      );
    }
  });
});

// ─── getOptions / getTips ─────────────────────────────────────────────────────

describe("musicSpecialistTools.getOptions/getTips", () => {
  it("returns enriched genres / moods / capabilities", () => {
    const opts = getMusicOptions();
    expect(opts.success).toBe(true);
    expect(opts.genres.length).toBeGreaterThan(10);
    expect(opts.moods.length).toBeGreaterThan(10);
    expect(opts.capabilities).toContain("sfx");
    expect(opts.capabilities).toContain("music-vocals");
  });

  it("returns non-empty tips list", () => {
    const tips = getMusicGenerationTips();
    expect(tips.success).toBe(true);
    expect(tips.tips.length).toBeGreaterThan(3);
  });
});

// ─── generate / generateSoundEffect (with mocked dispatcher) ──────────────────

describe("musicSpecialistTools.generateMusic", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an explicit modelId when supplied", async () => {
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async (input: { modelId: string }) => ({
        jobId: "job_" + input.modelId,
        modality: "audio",
        modelId: input.modelId,
        raw: { success: true } as never,
      }),
    }));

    const { generateMusic: gen } = await import(
      "./services/spiritTools/musicSpecialistTools"
    );

    const result = await gen({
      userId: 999,
      prompt: "uplifting lo-fi piano",
      modelId: "fal-ai/stable-audio",
      duration: 30,
    });

    expect(result.success).toBe(true);
    expect(result.modelIdUsed).toBe("fal-ai/stable-audio");
    expect(result.jobId).toBe("job_fal-ai/stable-audio");
  });

  it("downgrades Suno → ACE-Step when SUNO_API_KEY is missing", async () => {
    const original = process.env.SUNO_API_KEY;
    delete process.env.SUNO_API_KEY;
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async (input: { modelId: string }) => ({
        jobId: "job_" + input.modelId,
        modality: "audio",
        modelId: input.modelId,
        raw: { success: true } as never,
      }),
    }));

    try {
      const { generateMusic: gen } = await import(
        "./services/spiritTools/musicSpecialistTools"
      );
      const result = await gen({
        userId: 999,
        prompt: "vocals song",
        modelId: "suno-v4",
      });
      expect(result.success).toBe(true);
      expect(result.modelIdUsed).toBe("fal-ai/ace-step");
    } finally {
      if (original !== undefined) process.env.SUNO_API_KEY = original;
    }
  });

  it("returns success=false when the dispatcher throws", async () => {
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async () => {
        throw new Error("upstream 503");
      },
    }));

    const { generateMusic: gen } = await import(
      "./services/spiritTools/musicSpecialistTools"
    );

    const result = await gen({
      userId: 999,
      prompt: "anything",
      modelId: "fal-ai/stable-audio",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("生成失敗");
  });
});

describe("musicSpecialistTools.generateSoundEffect", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks ElevenLabs SFX when the key is present", async () => {
    const original = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "test-key";
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async (input: { modelId: string }) => ({
        jobId: "sfx_" + input.modelId,
        modality: "audio",
        modelId: input.modelId,
        raw: { success: true } as never,
      }),
    }));

    try {
      const { generateSoundEffect: sfx } = await import(
        "./services/spiritTools/musicSpecialistTools"
      );
      const result = await sfx({
        userId: 999,
        description: "thunder crash",
        duration: 5,
      });
      expect(result.success).toBe(true);
      expect(result.modelIdUsed).toBe("fal-ai/elevenlabs/sound-effects/v2");
    } finally {
      if (original === undefined) delete process.env.ELEVENLABS_API_KEY;
      else process.env.ELEVENLABS_API_KEY = original;
    }
  });

  it("falls back to mmaudio-v2 when ELEVENLABS_API_KEY is missing", async () => {
    const original = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async (input: { modelId: string }) => ({
        jobId: "sfx_" + input.modelId,
        modality: "audio",
        modelId: input.modelId,
        raw: { success: true } as never,
      }),
    }));

    try {
      const { generateSoundEffect: sfx } = await import(
        "./services/spiritTools/musicSpecialistTools"
      );
      const result = await sfx({
        userId: 999,
        description: "door creak",
      });
      expect(result.success).toBe(true);
      expect(result.modelIdUsed).toBe("fal-ai/mmaudio-v2");
    } finally {
      if (original !== undefined) process.env.ELEVENLABS_API_KEY = original;
    }
  });

  it("downgrades explicit ElevenLabs request when the key is missing", async () => {
    const original = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    vi.doMock("./services/generationJobDispatcher", () => ({
      dispatchGenerationJob: async (input: { modelId: string }) => ({
        jobId: "sfx_" + input.modelId,
        modality: "audio",
        modelId: input.modelId,
        raw: { success: true } as never,
      }),
    }));

    try {
      const { generateSoundEffect: sfx } = await import(
        "./services/spiritTools/musicSpecialistTools"
      );
      const result = await sfx({
        userId: 999,
        description: "door creak",
        modelId: "fal-ai/elevenlabs/sound-effects/v2",
      });
      expect(result.success).toBe(true);
      expect(result.modelIdUsed).toBe("fal-ai/stable-audio");
    } finally {
      if (original !== undefined) process.env.ELEVENLABS_API_KEY = original;
    }
  });
});
