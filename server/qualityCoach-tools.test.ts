/**
 * server/qualityCoach-tools.test.ts
 *
 * 巧巧 (quality-coach) server-side tool 包裝測試。
 * 重點：驗證 dispatchQualityCoach 對 unknown args / missing prompt 的容錯，
 * 以及 4 個工具的輸出 shape 跟 LLM 與 client 約定一致。
 */

import { describe, expect, it } from "vitest";
import {
  compare,
  diagnose,
  dispatchQualityCoach,
  getTemplatesTool,
  rewrite,
} from "./services/spiritTools/qualityCoachTools";

describe("qualityCoachTools.diagnose", () => {
  it("returns 7 dimension hits and 0-100 score", () => {
    const result = diagnose({
      prompt: "一位女性側臥窗台，午後逆光，水彩插畫風",
    });
    expect(result.dimensions).toHaveLength(7);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.oneLineSummary.length).toBeGreaterThan(0);
  });

  it("returns 0 score and friendly message for empty prompt", () => {
    const result = diagnose({ prompt: "" });
    expect(result.score).toBe(0);
    expect(result.dimensions).toHaveLength(0);
    expect(result.oneLineSummary).toContain("空");
  });

  it("respects explicit modality even if prompt looks ambiguous", () => {
    const result = diagnose({ prompt: "一位女性，溫暖的聲音", modality: "voice" });
    expect(result.modality).toBe("voice");
  });
});

describe("qualityCoachTools.rewrite", () => {
  it("appends missing dimensions and includes diagnosis by default", () => {
    const result = rewrite({ prompt: "一隻橘貓" });
    expect(result.rewritten.startsWith("一隻橘貓")).toBe(true);
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.diagnosis).toBeDefined();
    expect(result.diagnosis!.score).toBeGreaterThanOrEqual(0);
  });

  it("can suppress diagnosis when includeDiagnosis=false", () => {
    const result = rewrite({ prompt: "一隻橘貓", includeDiagnosis: false });
    expect(result.diagnosis).toBeUndefined();
  });
});

describe("qualityCoachTools.compare", () => {
  it("picks B when B covers more dimensions", () => {
    const result = compare({
      promptA: "一隻貓",
      promptB:
        "一隻橘貓，側臥窗台，午後咖啡店，柔和逆光，水彩插畫風，35mm 淺景深，細節清晰",
    });
    expect(result.winner).toBe("B");
    expect(result.gained.length).toBeGreaterThan(0);
  });
});

describe("qualityCoachTools.getTemplatesTool", () => {
  it("returns image templates with examples", () => {
    const result = getTemplatesTool({ modality: "image" });
    expect(result.count).toBeGreaterThan(0);
    expect(result.templates[0].modality).toBe("image");
    expect(result.templates[0].example.length).toBeGreaterThan(0);
  });

  it("filters by styleHint or falls back to full list", () => {
    const r1 = getTemplatesTool({ modality: "image", styleHint: "寫實" });
    expect(r1.templates.length).toBe(1);

    const r2 = getTemplatesTool({ modality: "image", styleHint: "不存在風格" });
    expect(r2.templates.length).toBeGreaterThan(0);
  });
});

describe("qualityCoachTools.dispatchQualityCoach", () => {
  it("errors cleanly when prompt is missing for diagnose", () => {
    const result = dispatchQualityCoach({
      name: "qualityCoach.diagnose",
      args: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("prompt is required");
  });

  it("errors cleanly when promptA/promptB missing for compare", () => {
    const result = dispatchQualityCoach({
      name: "qualityCoach.compare",
      args: { promptA: "a" },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/promptA and promptB/);
  });

  it("rejects unknown modality at the boundary and falls back to inference", () => {
    const result = dispatchQualityCoach({
      name: "qualityCoach.diagnose",
      args: { prompt: "一隻橘貓插畫", modality: "blah-blah" },
    });
    expect(result.ok).toBe(true);
    // unknown modality 應該 fallback 到 detectModality 推斷 → image
    expect((result.data as { modality: string }).modality).toBe("image");
  });

  it("returns wrapped result with data field for valid call", () => {
    const result = dispatchQualityCoach({
      name: "qualityCoach.rewrite",
      args: { prompt: "一隻橘貓" },
    });
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { rewritten: string }).rewritten).toContain("橘貓");
  });

  it("validates onlyFillDimensions list and ignores bogus entries", () => {
    const result = dispatchQualityCoach({
      name: "qualityCoach.rewrite",
      args: {
        prompt: "一隻橘貓",
        onlyFillDimensions: ["lighting", "not-a-real-dim"],
      },
    });
    expect(result.ok).toBe(true);
    const filled = (result.data as { filledDimensions: string[] }).filledDimensions;
    expect(filled).toContain("lighting");
    expect(filled).not.toContain("not-a-real-dim");
  });
});
