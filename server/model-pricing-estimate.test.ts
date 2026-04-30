import { describe, expect, it } from "vitest";
import { estimatePoints } from "./services/modelPricing";

describe("estimatePoints precision billing", () => {
  it("does not double-bill the baseline duration covered by basePoints", () => {
    // Stable Audio basePoints=5 已含 30 秒 baseline → 30 秒應只收 5 pts
    const result = estimatePoints("fal-ai/stable-audio", {
      durationSec: 30,
    });

    expect(result.totalPoints).toBe(5);
    expect(result.breakdown).toContain("基礎 5 pts");
    expect(result.breakdown).not.toContain("時長加收");
  });

  it("charges duration surcharge only for time above the baseline", () => {
    // Stable Audio: 60 秒 = 5 + round((60-30) × 0.17) = 5 + 5 = 10
    const result = estimatePoints("fal-ai/stable-audio", {
      durationSec: 60,
    });

    expect(result.totalPoints).toBe(10);
    expect(result.breakdown).toContain(
      "時長加收 (60s − 含 30s 起跳) × 0.17 pts/s = +5 pts"
    );
  });

  it("default Studio video engine charges baseCostUsd-aligned points at baseline", () => {
    // Kling V2.1 Standard t2v 預設 — 5 秒應剛好 30 pts ($0.30)
    const result = estimatePoints(
      "fal-ai/kling-video/v2.1/standard/text-to-video",
      { durationSec: 5 }
    );
    expect(result.totalPoints).toBe(30);
  });

  it("default Studio audio engine charges baseCostUsd-aligned points at baseline", () => {
    // ACE-Step 預設 — 60 秒應剛好 8 pts ($0.08)
    const result = estimatePoints("fal-ai/ace-step", { durationSec: 60 });
    expect(result.totalPoints).toBe(8);
  });

  it("default Studio voice engine bills per-character via fal proxy", () => {
    // 過去 fal-ai/elevenlabs/tts/turbo-v2.5 缺 pointsPer1kChars，永遠收 3 pts；
    // 修復後與直連版 elevenlabs/turbo-v2.5 同樣 1 pt/1k chars。
    const short = estimatePoints("fal-ai/elevenlabs/tts/turbo-v2.5", {
      charCount: 100,
    });
    expect(short.totalPoints).toBe(2); // base 1 + ceil(0.1 × 1) = 2

    const long = estimatePoints("fal-ai/elevenlabs/tts/turbo-v2.5", {
      charCount: 5000,
    });
    expect(long.totalPoints).toBe(6); // base 1 + ceil(5 × 1) = 6
  });

  it("adds text surcharge on top of base points", () => {
    const result = estimatePoints("elevenlabs/eleven-v3", {
      charCount: 1500,
    });

    // base 4 + ceil(1.5 * 4) = 4 + 6 = 10
    expect(result.totalPoints).toBe(10);
    expect(result.breakdown).toContain("字符加收 1500 字符 × 4 pts/1k = +6 pts");
  });

  it("ignores invalid negative input and keeps minimum base", () => {
    const result = estimatePoints("elevenlabs/turbo-v2.5", {
      charCount: -100,
      durationSec: Number.NaN,
    });

    expect(result.totalPoints).toBe(1);
    expect(result.breakdown).toBe("基礎 1 pts");
  });

  it("applies max cap and emits explicit clamp note", () => {
    const result = estimatePoints("elevenlabs/eleven-v3", {
      charCount: 100_000,
    });

    expect(result.totalPoints).toBe(200);
    expect(result.breakdown).toContain("封頂上限 200 pts");
  });
});
