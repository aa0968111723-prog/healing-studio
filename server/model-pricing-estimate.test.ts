import { describe, expect, it } from "vitest";
import { estimatePoints } from "./services/modelPricing";

describe("estimatePoints precision billing", () => {
  it("adds duration surcharge on top of base points", () => {
    const result = estimatePoints("fal-ai/stable-audio", {
      durationSec: 30,
    });

    // base 5 + round(30 * 0.17) = 5 + 5 = 10
    expect(result.totalPoints).toBe(10);
    expect(result.breakdown).toContain("基礎 5 pts");
    expect(result.breakdown).toContain("時長加收 30s × 0.17 pts/s = +5 pts");
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
