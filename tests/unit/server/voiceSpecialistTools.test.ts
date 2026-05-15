/**
 * Unit tests for voiceSpecialistTools — 聲聲（voice-specialist）AI agent 工具集。
 *
 * 重點驗證新增的工具行為（不打外部 API、不寫 DB）：
 *   - recommendModel：依語言 / priority 推薦時能命中 registry 與真實 fal 路徑
 *   - listVoices：filter 行為正確，回傳的是真實 provider voice_id 而非假 ID
 *   - checkCloneSample：時長 / mime / size 三種規則，並且能依 engine 切門檻
 *   - detectLanguage：中 / 英 / 中英混雜 / 日 / 韓 的偵測正確
 *   - estimateVoiceCost：短代號自動轉成完整 fal 路徑後仍能查到 pricing
 */
import { describe, expect, it } from "vitest";

import {
  checkCloneSample,
  detectLanguage,
  estimateVoiceCost,
  listVoices,
  recommendModel,
} from "../../../server/services/spiritTools/voiceSpecialistTools";

describe("voiceSpecialistTools.recommendModel", () => {
  it("recommends a real fal modelId for premium voice prompts", () => {
    const result = recommendModel({
      prompt: "高品質療癒系女聲，情感豐富",
      priority: "quality",
    });
    expect(result.shortModelId).toMatch(/elevenlabs|playai/);
    // 推薦結果必須能對到完整 fal 路徑 — 否則 dispatch 會炸
    expect(result.falModelId).toMatch(/^fal-ai\//);
    expect(result.label.length).toBeGreaterThan(0);
  });

  it("priority=speed bumps tts-fast category to the top", () => {
    const result = recommendModel({ prompt: "短影音旁白", priority: "speed" });
    // tts-fast 類別應該在第一名（turbo / flash / kokoro / gemini flash）
    expect(result.category).toBe("tts-fast");
  });

  it("priority=cheap deprioritises ElevenLabs in favour of fal/* engines", () => {
    const cheap = recommendModel({ prompt: "練習短句", priority: "cheap" });
    const quality = recommendModel({ prompt: "練習短句", priority: "quality" });
    // 同一個 prompt 在不同 priority 下要能換出至少一次不一樣的引擎
    if (cheap.shortModelId === quality.shortModelId) {
      // 即使 top-1 一樣，cheap 的 alternatives 也應該有 fal/* 候選
      const altProviders = cheap.alternatives.map(a => a.shortModelId.split("/")[0]);
      expect(altProviders).toContain("fal");
    } else {
      expect(cheap.shortModelId.startsWith("elevenlabs/")).toBe(false);
    }
  });

  it("provides voicePresets[] that match the recommended engine", () => {
    const result = recommendModel({
      prompt: "中文配音",
      language: "zh-TW",
      priority: "quality",
    });
    // 有 presets 時，每一個 preset 的 recommendedEngine 必須等於 falModelId
    for (const p of result.voicePresets) {
      expect(p.recommendedEngine).toBe(result.falModelId);
    }
  });
});

describe("voiceSpecialistTools.listVoices", () => {
  it("returns real provider voice IDs (no fake zh-tw-female-1 placeholders)", () => {
    const { voices } = listVoices();
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      // 之前舊的假 ID（zh-tw-female-1 / en-us-male-1 …）應該完全消失
      expect(v.voiceId).not.toMatch(/^(zh-tw|en-us)-(female|male)-\d+$/);
      // recommendedEngine 必須是完整 fal 路徑
      expect(v.recommendedEngine).toMatch(/^fal-ai\//);
    }
  });

  it("filters by language", () => {
    const { voices } = listVoices({ language: "zh-TW" });
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v.language.toLowerCase()).toContain("zh-tw");
    }
  });

  it("filters by gender", () => {
    const { voices } = listVoices({ gender: "female" });
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) {
      expect(v.gender).toBe("female");
    }
  });
});

describe("voiceSpecialistTools.checkCloneSample", () => {
  it("fails when duration is below the minimum for ElevenLabs IVC", () => {
    const result = checkCloneSample({ durationSec: 15, engine: "elevenlabs" });
    expect(result.ok).toBe(false);
    const durationCheck = result.checks.find(c => c.name === "duration");
    expect(durationCheck?.status).toBe("fail");
  });

  it("passes for a 60s sample on Qwen clone (lower bar)", () => {
    const result = checkCloneSample({ durationSec: 60, engine: "qwen" });
    expect(result.ok).toBe(true);
    expect(result.engine).toBe("qwen");
  });

  it("warns when sample is between min and recommended", () => {
    const result = checkCloneSample({ durationSec: 35, engine: "elevenlabs" });
    expect(result.ok).toBe(true); // warn, not fail
    const durationCheck = result.checks.find(c => c.name === "duration");
    expect(durationCheck?.status).toBe("warn");
  });

  it("flags file size > 25 MB as fail (fal upload limit)", () => {
    const result = checkCloneSample({ durationSec: 60, sizeMb: 30 });
    expect(result.ok).toBe(false);
    const sizeCheck = result.checks.find(c => c.name === "size");
    expect(sizeCheck?.status).toBe("fail");
  });

  it("rejects non-audio mime types", () => {
    const result = checkCloneSample({
      durationSec: 60,
      mimeType: "video/mp4",
    });
    expect(result.ok).toBe(false);
    const mimeCheck = result.checks.find(c => c.name === "mimeType");
    expect(mimeCheck?.status).toBe("fail");
  });
});

describe("voiceSpecialistTools.detectLanguage", () => {
  it("detects pure Chinese as zh", () => {
    const result = detectLanguage("這是一段純中文的測試文字");
    expect(result.language).toBe("zh");
    expect(result.cjkCharCount).toBeGreaterThan(5);
    expect(result.recommendedFalModelId).toMatch(/multilingual/);
  });

  it("detects pure English as en and routes to ElevenLabs V3", () => {
    const result = detectLanguage("Hello there, this is a pure English test sentence.");
    expect(result.language).toBe("en");
    expect(result.recommendedShortModelId).toBe("elevenlabs/eleven-v3");
  });

  it("detects mixed Chinese-English content as mixed", () => {
    const result = detectLanguage("我們用 ElevenLabs Multilingual V2 來測試 mixed content");
    expect(result.language).toBe("mixed");
    expect(result.recommendedFalModelId).toMatch(/multilingual/);
  });

  it("detects Japanese kana as ja", () => {
    const result = detectLanguage("こんにちは、これはテストです");
    expect(result.language).toBe("ja");
  });

  it("detects Korean hangul as ko", () => {
    const result = detectLanguage("안녕하세요 테스트입니다");
    expect(result.language).toBe("ko");
  });

  it("returns a fallback recommendation for empty input", () => {
    const result = detectLanguage("");
    expect(result.language).toBe("other");
    expect(result.recommendedFalModelId).toMatch(/^fal-ai\//);
  });
});

describe("voiceSpecialistTools.estimateVoiceCost", () => {
  it("resolves short modelId to full fal path and returns real pricing", async () => {
    const result = await estimateVoiceCost({
      modelId: "elevenlabs/eleven-v3",
      charCount: 1000,
    });
    expect(result.resolvedModelId).toBe("fal-ai/elevenlabs/tts/eleven-v3");
    expect(result.isUnknownModel).toBe(false);
    expect(result.totalPoints).toBeGreaterThan(0);
  });

  it("accepts a full fal modelId untouched", async () => {
    const result = await estimateVoiceCost({
      modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      charCount: 500,
    });
    expect(result.resolvedModelId).toBe("fal-ai/qwen-3-tts/text-to-speech/1.7b");
    expect(result.isUnknownModel).toBe(false);
  });

  it("flags unknown modelId so the LLM can apologise instead of hallucinating", async () => {
    const result = await estimateVoiceCost({
      modelId: "made-up/not-in-catalog",
      charCount: 100,
    });
    expect(result.isUnknownModel).toBe(true);
  });
});
