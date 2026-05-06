import { describe, expect, it } from "vitest";
import {
  AUDIO_MODEL_REGISTRY,
  pickBestAudioModel,
  rankAudioModelsByPrompt,
} from "../../../shared/audioModelRegistry";

describe("audioModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(AUDIO_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks music generation prompt toward Suno V4", () => {
    const ranked = rankAudioModelsByPrompt("Create a complete song with vocals and lyrics");
    expect(ranked[0]?.modelId).toBe("suno-v4");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("ranks sound effects prompt toward ElevenLabs sound effects", () => {
    const ranked = rankAudioModelsByPrompt("Generate a short sound effect for a door closing");
    expect(ranked[0]?.modelId).toBe("elevenlabs/sound-effects");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("ranks background music prompt toward ElevenLabs Music", () => {
    const ranked = rankAudioModelsByPrompt("Create instrumental background music for a video");
    expect(ranked[0]?.modelId).toBe("elevenlabs/music");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestAudioModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("suno-v4");
    expect(picked.score).toBe(0);
  });

  it("correctly identifies Chinese keywords for music", () => {
    const ranked = rankAudioModelsByPrompt("創作一首完整的歌曲");
    expect(ranked[0]?.score).toBeGreaterThan(0);
    expect(ranked[0]?.matchedKeywords).toContain("歌曲");
  });

  it("ranks experimental music prompt toward ACE-Step", () => {
    const ranked = rankAudioModelsByPrompt("Create innovative experimental music");
    expect(ranked[0]?.modelId).toBe("fal/ace-step");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });
});
