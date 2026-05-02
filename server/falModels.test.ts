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

  // DEF-Q1：Qwen3-TTS 1.7B 必須註冊在 text-to-speech catalog，否則 dispatcher
  // 對 modelId 為 fal-ai/qwen-3-tts/text-to-speech/1.7b 的請求會 catalog miss，
  // 自動降級到 fallback chain[0] = fal-ai/f5-tts（光球/導演/大腦選 Qwen 都會被換掉）。
  it("text-to-speech catalog includes Qwen3-TTS 1.7B canonical id", () => {
    const cfg = getFalModelById(
      "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      "text-to-speech"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.category).toBe("text-to-speech");
  });

  // DEF-V6：ElevenLabs TTS 家族四家全部要在 catalog（過去只有 turbo + multilingual）。
  // Flash / Eleven V3 缺席 → 光球選 Flash 經 dispatcher 會 catalog miss
  // 並降級到 fallback[0] = fal-ai/f5-tts，使用者選 Flash 卻被默默換成 f5-tts。
  it("text-to-speech catalog includes the full ElevenLabs TTS family", () => {
    const list = getFalModelsByCategory("text-to-speech");
    const ids = new Set(list.map(m => m.modelId));
    expect(ids.has("fal-ai/elevenlabs/tts/turbo-v2.5")).toBe(true);
    expect(ids.has("fal-ai/elevenlabs/tts/flash-v2.5")).toBe(true);
    expect(ids.has("fal-ai/elevenlabs/tts/multilingual-v2")).toBe(true);
    expect(ids.has("fal-ai/elevenlabs/tts/eleven-v3")).toBe(true);
  });

  // DEF-D1：Dia voice-clone 是獨立 endpoint（雖叫 voice-clone 實為多說話者
  // 對話 TTS），必須與基礎 fal-ai/dia-tts 並列在 catalog 內，否則 dispatcher
  // 對該 modelId 會 catalog miss → 降級到 f5-tts。
  it("text-to-speech catalog includes Dia voice-clone alongside base dia-tts", () => {
    const list = getFalModelsByCategory("text-to-speech");
    const ids = new Set(list.map(m => m.modelId));
    expect(ids.has("fal-ai/dia-tts")).toBe(true);
    expect(ids.has("fal-ai/dia-tts/voice-clone")).toBe(true);
  });

  // DEF-IVC1：ElevenLabs Instant Voice Cloning 必須在 catalog，否則
  // 大腦/光球選 ElevenLabs IVC 都會 catalog miss → 降級到 f5-tts，
  // ELEVENLABS_API_KEY proxy header 也不會被注入。
  it("text-to-speech catalog includes ElevenLabs IVC", () => {
    const cfg = getFalModelById(
      "fal-ai/elevenlabs/voice-cloning",
      "text-to-speech"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.tier).toBe("premium");
  });

  // DEF-DM1：Demucs 音幹分離。沒在 catalog → 任何 category-aware 路徑（光球
  // studio.separateStems / 導演若引用）會 catalog miss → 降級到 ace-step（音樂引擎），
  // 完全與 stem 分離無關，使用者 / agent 拿到的會是音樂生成輸出。
  it("text-to-audio catalog includes Demucs", () => {
    const cfg = getFalModelById("fal-ai/demucs", "text-to-audio");
    expect(cfg).toBeDefined();
    expect(cfg!.timeoutMs).toBeGreaterThan(60_000);
  });

  // DEF-AI1：ElevenLabs Audio Isolation。同 DEF-DM1 pattern — catalog miss
  // 會把「抽乾淨人聲」的請求降級成「生成音樂」，且 ELEVENLABS_API_KEY proxy
  // header 也不會被注入。
  it("text-to-audio catalog includes ElevenLabs Audio Isolation", () => {
    const cfg = getFalModelById(
      "fal-ai/elevenlabs/audio-isolation",
      "text-to-audio"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.tier).toBe("standard");
  });

  // DEF-MA1：FFmpeg merge-audios — 同 DEF-DM1 / DEF-AI1 pattern，catalog miss
  // 會把「合併已分離的軌道」降級成「生成音樂」。多步驟工作流的最後一塊（拆軌
  // → 替換人聲 → mergeAudios 合回成品）必須能在 dispatcher 端 catalog 命中。
  it("text-to-audio catalog includes FFmpeg merge-audios", () => {
    const cfg = getFalModelById(
      "fal-ai/ffmpeg-api/merge-audios",
      "text-to-audio"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.tier).toBe("fast");
  });

  // DEF-VCH1：ElevenLabs Voice Changer — catalog miss 會把「換聲音保留語氣」
  // 降級成「生成音樂」，且 ELEVENLABS_API_KEY proxy header 不會被注入。
  it("text-to-audio catalog includes ElevenLabs Voice Changer", () => {
    const cfg = getFalModelById(
      "fal-ai/elevenlabs/voice-changer",
      "text-to-audio"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.tier).toBe("standard");
  });

  // DEF-ASR1：audio-to-text 為 FalCategory 新增分類，過去 modelPricing 早有
  // category="audio-to-text" 但 falModels enum 缺，使得 ASR 模型無處註冊。
  // 現在 Nemotron / Wizper / Whisper 都應該在 audio-to-text catalog 內。
  it("audio-to-text catalog includes Nemotron / Wizper / Whisper", () => {
    const list = getFalModelsByCategory("audio-to-text");
    const ids = new Set(list.map(m => m.modelId));
    expect(ids.has("fal-ai/nemotron/asr/stream")).toBe(true);
    expect(ids.has("fal-ai/wizper")).toBe(true);
    expect(ids.has("fal-ai/whisper")).toBe(true);
  });

  // DEF-WAN1：Wan 2.2 Speech-to-Video — 說話人動畫。catalog miss 會把
  // 「靜態頭像 + 配音 → 對嘴影片」的請求降級到 image-to-video[0] = kling-pro
  // （純 i2v，不對嘴），使用者拿到的影片人物嘴型與配音對不上。
  it("image-to-video catalog includes Wan 2.2 speech-to-video", () => {
    const cfg = getFalModelById(
      "fal-ai/wan/v2.2-14b/speech-to-video",
      "image-to-video"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.tier).toBe("premium");
  });

  // DEF-EL1：ElevenLabs SFX 真實 endpoint 帶 /v2 後綴，必須在 text-to-audio
  // catalog 註冊，否則 dispatcher 會把所有 SFX 請求降級到 fal-ai/ace-step（音樂模型）。
  it("text-to-audio catalog includes ElevenLabs SFX v2 canonical id", () => {
    const cfg = getFalModelById(
      "fal-ai/elevenlabs/sound-effects/v2",
      "text-to-audio"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.category).toBe("text-to-audio");
  });

  // DEF-So1：Sonauto v2 真實 fal endpoint。
  it("text-to-audio catalog includes Sonauto v2 canonical id", () => {
    const cfg = getFalModelById(
      "sonauto/v2/text-to-music",
      "text-to-audio"
    );
    expect(cfg).toBeDefined();
    expect(cfg!.category).toBe("text-to-audio");
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
    // fal.ai dispatches a handful of partner-namespaced models too (e.g.
    // `xai/grok-imagine-image/edit`); they are still served through the FAL
    // provider so the catalog is allowed to reference them. The regex below
    // lists the prefixes that the FAL dispatcher knows how to invoke.
    const ALLOWED_PREFIXES = /^(fal-ai|xai)\//;
    for (const [category, models] of Object.entries(
      FAL_MODEL_CATALOG
    ) as Array<[FalCategory, (typeof FAL_MODEL_CATALOG)[FalCategory]]>) {
      for (const m of models) {
        expect(m.category).toBe(category);
        expect(m.label.length).toBeGreaterThan(0);
        expect(ALLOWED_PREFIXES.test(m.modelId)).toBe(true);
        expect(m.timeoutMs).toBeGreaterThan(0);
      }
    }
  });
});
