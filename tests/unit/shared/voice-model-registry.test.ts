import { describe, expect, it } from "vitest";
import {
  VOICE_MODEL_REGISTRY,
  pickBestVoiceModel,
  rankVoiceModelsByPrompt,
} from "../../../shared/voiceModelRegistry";

describe("voiceModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(VOICE_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks premium voice prompt toward ElevenLabs V3", () => {
    const ranked = rankVoiceModelsByPrompt("Generate high quality natural voice with emotion");
    expect(ranked[0]?.modelId).toBe("elevenlabs/eleven-v3");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("ranks fast narration prompt toward ElevenLabs Turbo V2.5", () => {
    const ranked = rankVoiceModelsByPrompt("Quick narration for video content");
    expect(ranked[0]?.modelId).toBe("elevenlabs/turbo-v2.5");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("ranks multilingual prompt toward multilingual models", () => {
    const ranked = rankVoiceModelsByPrompt("Create multilingual voice synthesis");
    const topModelIds = ranked.slice(0, 3).map(m => m.modelId);
    expect(topModelIds).toContain("elevenlabs/multilingual-v2");
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestVoiceModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("elevenlabs/eleven-v3");
    expect(picked.score).toBe(0);
  });

  it("correctly identifies Chinese keywords for voice", () => {
    const ranked = rankVoiceModelsByPrompt("生成高品質語音配音");
    expect(ranked[0]?.score).toBeGreaterThan(0);
    expect(ranked[0]?.matchedKeywords.some(k => ["高品質", "語音", "配音"].includes(k))).toBe(true);
  });

  it("ranks casual conversation prompt toward conversational models", () => {
    const ranked = rankVoiceModelsByPrompt("Natural conversational voice");
    const topModel = VOICE_MODEL_REGISTRY.find(m => m.modelId === ranked[0]?.modelId);
    expect(topModel?.category).toMatch(/conversational|tts-premium/);
  });
});
