/**
 * voice-specialist-agent.test.ts
 *
 * Locks the 聲聲 (voice-specialist) AI agent surface — pure / synchronous
 * tools (pickVoice / recommendModel / planVoiceover / getVoices /
 * getEmotionTags / getTips / pickTtsEngine). The side-effect tools
 * (generateSpeech / cloneVoice / etc.) are integration-covered via
 * agentToolExecutor, so this file focuses on the agentic reasoning
 * contract: given input X the agent suggests Y.
 */
import { describe, expect, it } from "vitest";
import {
  getAvailableVoices,
  getEmotionTags,
  getVoiceGenerationTips,
  pickTtsEngine,
  pickVoice,
  planVoiceover,
  recommendModel,
} from "./services/spiritTools/voiceSpecialistTools";

describe("voice-specialist · pickTtsEngine", () => {
  it("routes Chinese / Japanese to Qwen 3 TTS", () => {
    expect(pickTtsEngine({ language: "zh-TW" })).toBe(
      "fal-ai/qwen-3-tts/text-to-speech/1.7b"
    );
    expect(pickTtsEngine({ language: "ja-JP" })).toBe(
      "fal-ai/qwen-3-tts/text-to-speech/1.7b"
    );
    expect(pickTtsEngine({ language: "ko-KR" })).toBe(
      "fal-ai/qwen-3-tts/text-to-speech/1.7b"
    );
  });

  it("routes English + emotion tags to V3", () => {
    expect(
      pickTtsEngine({ language: "en-US", hasEmotionTags: true })
    ).toBe("fal-ai/elevenlabs/tts/eleven-v3");
  });

  it("routes English + low latency to Flash", () => {
    expect(
      pickTtsEngine({ language: "en-US", needsLowLatency: true })
    ).toBe("fal-ai/elevenlabs/tts/flash-v2-5");
  });

  it("defaults English to Multilingual v2", () => {
    expect(pickTtsEngine({ language: "en-US" })).toBe(
      "fal-ai/elevenlabs/tts/multilingual-v2"
    );
  });
});

describe("voice-specialist · getAvailableVoices", () => {
  it("returns full catalog when no filter", () => {
    const r = getAvailableVoices();
    expect(r.success).toBe(true);
    expect(r.voices.length).toBeGreaterThan(10);
    expect(r.total).toBe(r.voices.length);
  });

  it("filters by gender", () => {
    const female = getAvailableVoices({ gender: "female" });
    expect(female.voices.every(v => v.gender === "female")).toBe(true);
    expect(female.voices.length).toBeGreaterThan(0);
  });

  it("filters by language prefix", () => {
    const zh = getAvailableVoices({ language: "zh" });
    expect(zh.voices.every(v => v.language.startsWith("zh"))).toBe(true);
    expect(zh.voices.length).toBeGreaterThan(0);
  });

  it("filters by mood (case-insensitive)", () => {
    const calm = getAvailableVoices({ mood: "ASMR" });
    expect(calm.voices.length).toBeGreaterThan(0);
    expect(
      calm.voices.every(v =>
        v.moods.some(m => m.toLowerCase().includes("asmr"))
      )
    ).toBe(true);
  });

  it("respects limit", () => {
    const r = getAvailableVoices({ limit: 3 });
    expect(r.voices.length).toBe(3);
  });

  it("returns valid ElevenLabs voice IDs (not the old placeholder zh-tw-female-1)", () => {
    const r = getAvailableVoices();
    const placeholderShape = /^[a-z]{2}-[a-z]{2}-(male|female)-\d+$/;
    expect(
      r.voices.some(v => placeholderShape.test(v.id))
    ).toBe(false);
  });
});

describe("voice-specialist · pickVoice (agentic recommendation)", () => {
  it("recommends a Chinese voice when language=zh-TW", () => {
    const r = pickVoice({ language: "zh-TW" });
    expect(r.success).toBe(true);
    expect(r.primary?.language.startsWith("zh")).toBe(true);
    expect(r.reasoning).toContain("zh-TW");
  });

  it("matches scenario=meditation to a warm / asmr voice", () => {
    const r = pickVoice({ scenario: "meditation" });
    expect(r.primary).not.toBeNull();
    const moodHay = r.primary?.moods.join(" ").toLowerCase() ?? "";
    expect(
      moodHay.includes("meditation") ||
        moodHay.includes("asmr") ||
        moodHay.includes("warm") ||
        moodHay.includes("calm")
    ).toBe(true);
  });

  it("respects gender filter", () => {
    const r = pickVoice({ gender: "male", scenario: "narration" });
    expect(r.primary?.gender).toBe("male");
  });

  it("returns up to 2 alternates", () => {
    const r = pickVoice({ language: "en", gender: "female" });
    expect(r.alternates.length).toBeLessThanOrEqual(2);
    // alternates should not duplicate the primary
    for (const alt of r.alternates) {
      expect(alt.id).not.toBe(r.primary?.id);
    }
  });

  it("falls back to a voice even when no input matches", () => {
    const r = pickVoice({ mood: "totally-made-up-mood-9999" });
    expect(r.primary).not.toBeNull();
    // still returns *something* — primary is required for the agent to recover
  });
});

describe("voice-specialist · recommendModel", () => {
  it("picks Qwen 3 TTS for Chinese", () => {
    const r = recommendModel({ language: "zh-TW" });
    expect(r.modelId).toBe("fal-ai/qwen-3-tts/text-to-speech/1.7b");
    expect(r.modelName).toContain("Qwen");
    expect(r.alternates.length).toBeGreaterThan(0);
  });

  it("picks V3 for emotional English", () => {
    const r = recommendModel({
      language: "en-US",
      scenario: "advertisement",
    });
    expect(r.modelId).toBe("fal-ai/elevenlabs/tts/eleven-v3");
  });

  it("picks V3 for multi-speaker dialogue", () => {
    const r = recommendModel({
      language: "en-US",
      needsMultiSpeaker: true,
    });
    expect(r.modelId).toBe("fal-ai/elevenlabs/tts/eleven-v3");
  });

  it("picks Flash for low-latency English", () => {
    const r = recommendModel({
      language: "en-US",
      needsLowLatency: true,
    });
    expect(r.modelId).toBe("fal-ai/elevenlabs/tts/flash-v2-5");
  });

  it("defaults English to Multilingual v2", () => {
    const r = recommendModel({ language: "en-US" });
    expect(r.modelId).toBe("fal-ai/elevenlabs/tts/multilingual-v2");
  });

  it("reasoning is non-empty so the agent can explain itself", () => {
    const r = recommendModel({ language: "en-US", scenario: "podcast" });
    expect(r.reasoning.length).toBeGreaterThan(10);
  });
});

describe("voice-specialist · planVoiceover (agentic)", () => {
  it("returns failure on empty script", () => {
    const r = planVoiceover({ script: "" });
    expect(r.success).toBe(false);
    expect(r.segments).toEqual([]);
  });

  it("splits multi-line script into segments", () => {
    const r = planVoiceover({
      script:
        "歡迎來到療癒工作室。今天我們要做的事情很簡單：深呼吸。\n你準備好了嗎？",
    });
    expect(r.success).toBe(true);
    expect(r.segments.length).toBeGreaterThanOrEqual(2);
    expect(r.segmentCount).toBe(r.segments.length);
    expect(r.estimatedDurationSec).toBeGreaterThan(0);
  });

  it("tags exclamation segments with [excited]", () => {
    const r = planVoiceover({ script: "太棒了！" });
    expect(r.segments[0].kind).toBe("exclamation");
    expect(r.segments[0].emotionTag).toBe("[excited]");
  });

  it("tags question segments with [curious]", () => {
    const r = planVoiceover({ script: "你聽到了嗎？" });
    expect(r.segments[0].kind).toBe("question");
    expect(r.segments[0].emotionTag).toBe("[curious]");
  });

  it("alternates S1 / S2 in multi-speaker mode", () => {
    const r = planVoiceover({
      script: "你好。\n我也好。\n那我們開始吧。",
      multiSpeaker: true,
    });
    expect(r.segments[0].speaker).toBe("S1");
    expect(r.segments[1].speaker).toBe("S2");
    expect(r.segments[2].speaker).toBe("S1");
  });

  it("recommends V3 for emotional / multi-speaker scripts", () => {
    const r = planVoiceover({
      script: "你聽到了嗎？\n我聽到了！",
      multiSpeaker: true,
    });
    expect(r.recommendedModelId).toBe("fal-ai/elevenlabs/tts/eleven-v3");
  });

  it("recommends Qwen for Chinese script without emotion", () => {
    const r = planVoiceover({
      script: "今天天氣很好。我們去散步吧。",
    });
    expect(r.recommendedModelId).toBe(
      "fal-ai/qwen-3-tts/text-to-speech/1.7b"
    );
  });

  it("estimates longer scripts with longer duration", () => {
    const short = planVoiceover({ script: "你好。" });
    const long = planVoiceover({
      script:
        "這是一個很長的劇本。我們有很多話要說。每一段都需要好好處理。請保持耐心。最後我們會完成。",
    });
    expect(long.estimatedDurationSec).toBeGreaterThan(
      short.estimatedDurationSec
    );
  });

  it("last segment has zero pause-after", () => {
    const r = planVoiceover({
      script: "第一段。第二段。第三段。",
    });
    expect(r.segments[r.segments.length - 1].pauseAfterMs).toBe(0);
  });

  it("respects custom charsPerSecond for duration estimate", () => {
    const fast = planVoiceover({
      script: "一二三四五六七八九十。",
      charsPerSecond: 10,
    });
    const slow = planVoiceover({
      script: "一二三四五六七八九十。",
      charsPerSecond: 2,
    });
    expect(slow.estimatedDurationSec).toBeGreaterThan(
      fast.estimatedDurationSec
    );
  });
});

describe("voice-specialist · getEmotionTags", () => {
  it("returns grouped V3 tags", () => {
    const r = getEmotionTags();
    expect(r.success).toBe(true);
    expect(r.groups.length).toBeGreaterThanOrEqual(3);
    const allTags = r.groups.flatMap(g => g.tags);
    expect(allTags).toContain("[excited]");
    expect(allTags).toContain("[whispers]");
    expect(allTags).toContain("[pause]");
  });
});

describe("voice-specialist · getVoiceGenerationTips", () => {
  it("returns general tips when no scenario", () => {
    const r = getVoiceGenerationTips();
    expect(r.success).toBe(true);
    expect(r.tips.length).toBeGreaterThan(3);
  });

  it("returns scenario-specific tips for meditation", () => {
    const r = getVoiceGenerationTips("meditation");
    expect(r.success).toBe(true);
    expect(r.tips.length).toBeGreaterThan(0);
    // Should mention something meditation-specific
    expect(
      r.tips.some(t => t.includes("冥想") || t.includes("耳語") || t.includes("Bella"))
    ).toBe(true);
  });

  it("returns scenario-specific tips for podcast", () => {
    const r = getVoiceGenerationTips("podcast");
    expect(
      r.tips.some(t => t.includes("S1") || t.includes("S2") || t.includes("對話"))
    ).toBe(true);
  });

  it("returns scenario-specific tips for asmr (case-insensitive)", () => {
    const r = getVoiceGenerationTips("ASMR");
    expect(
      r.tips.some(t => t.includes("whispers") || t.includes("Nicole"))
    ).toBe(true);
  });

  it("falls back to general tips for unknown scenario", () => {
    const r = getVoiceGenerationTips("totally-unknown-scenario");
    expect(r.tips.length).toBeGreaterThan(0);
  });
});
