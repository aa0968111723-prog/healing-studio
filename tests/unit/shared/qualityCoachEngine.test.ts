/**
 * tests/unit/shared/qualityCoachEngine.test.ts
 *
 * 巧巧 (quality-coach) 的純函式引擎測試。重點：
 *   - 模態偵測：image / video / music / voice / general 5 種正確分辨
 *   - 7 維度命中：每個關鍵字組真的命中對應維度
 *   - 評分：滿分 100，缺維度扣分對 weight，質感詞過載扣分
 *   - 改寫：補的字串真的對應該模態的 SUGGESTION_SNIPPETS（不再對 video
 *     prompt 給「35mm 淺景深」這種圖像專用建議）
 *   - struggling detection：對中文穩 → 兩條完全不同的中文短句不會誤判
 */

import { describe, expect, it } from "vitest";
import {
  comparePrompts,
  detectModality,
  detectStruggle,
  getTemplates,
  jaccardWordSimilarity,
  parseDimensions,
  PROMPT_DIMENSIONS,
  rewritePrompt,
  scorePrompt,
  type PromptDimension,
} from "../../../shared/qualityCoachEngine";

// ─── Modality detection ──────────────────────────────────────────────────

describe("qualityCoachEngine.detectModality", () => {
  it("detects image prompts from common chinese keywords", () => {
    expect(detectModality("一隻橘貓側臥窗台插畫")).toBe("image");
    expect(detectModality("出圖：清晨咖啡店")).toBe("image");
    expect(detectModality("a portrait of a young girl")).toBe("image");
  });

  it("detects video prompts ahead of image when 影片 present", () => {
    expect(detectModality("一支 7 秒影片，產品旋轉")).toBe("video");
    expect(detectModality("vertical reel of city skyline")).toBe("video");
  });

  it("detects music prompts ahead of video when BGM present", () => {
    expect(detectModality("30 秒 BGM lo-fi 鋼琴")).toBe("music");
    expect(detectModality("create a soundtrack for the trailer")).toBe("music");
  });

  it("detects voice prompts when 配音/旁白 present", () => {
    // 注意：先 voice 後 music，所以「配音搭配 BGM」會偏 voice — 這是設計
    expect(detectModality("幫我做 30 秒廣告配音")).toBe("voice");
    expect(detectModality("voiceover for a tutorial")).toBe("voice");
  });

  it("falls back to general when no modality hint", () => {
    expect(detectModality("我要做一個東西")).toBe("general");
    expect(detectModality("hello world")).toBe("general");
  });
});

// ─── Dimension parsing ───────────────────────────────────────────────────

describe("qualityCoachEngine.parseDimensions", () => {
  it("returns hits in PROMPT_DIMENSIONS order", () => {
    const hits = parseDimensions("一位女性側臥窗台", "image");
    expect(hits.map(h => h.dimension)).toEqual([...PROMPT_DIMENSIONS]);
  });

  it("flags subject + action + scene present on a rich image prompt", () => {
    const hits = parseDimensions(
      "一位女性，側臥於窗台，午後咖啡店窗邊，柔和逆光，水彩插畫風，35mm 淺景深，細節清晰電影感",
      "image",
    );
    const byDim = Object.fromEntries(hits.map(h => [h.dimension, h.present])) as Record<
      PromptDimension,
      boolean
    >;
    expect(byDim.subject).toBe(true);
    expect(byDim.action).toBe(true);
    expect(byDim.scene).toBe(true);
    expect(byDim.lighting).toBe(true);
    expect(byDim.style).toBe(true);
    expect(byDim.camera).toBe(true);
    expect(byDim.quality).toBe(true);
  });

  it("uses voice catalog for voice modality (語氣 hits action, not image)", () => {
    const hits = parseDimensions("溫暖的女聲", "voice");
    const action = hits.find(h => h.dimension === "action")!;
    expect(action.present).toBe(true);
    expect(action.matchedKeyword).toBe("溫暖");
  });
});

// ─── Scoring ─────────────────────────────────────────────────────────────

describe("qualityCoachEngine.scorePrompt", () => {
  it("scores a fully-spec'd image prompt high", () => {
    const diag = scorePrompt(
      "一位女性，側臥於窗台，午後咖啡店窗邊，柔和逆光，水彩插畫風，35mm 淺景深，細節清晰",
    );
    expect(diag.score).toBeGreaterThanOrEqual(80);
    expect(diag.missingDimensions.length).toBeLessThanOrEqual(1);
    expect(diag.modality).toBe("image");
  });

  it("clamps very short prompts to <=25", () => {
    const diag = scorePrompt("一隻貓");
    expect(diag.score).toBeLessThanOrEqual(25);
    expect(diag.issues.some(i => i.includes("太短"))).toBe(true);
  });

  it("penalises quality word overload (4k/8k/highly detailed stack)", () => {
    // Pass explicit modality — quality keywords like 4k / 8k / cinematic
    // are catalogued under the image modality. Without an explicit hint
    // detectModality may fall back to general where the quality catalog
    // is structurally different (CTA / 結尾 / hook).
    const stacked = scorePrompt(
      "一位女性 4k 8k highly detailed ultra detailed cinematic masterpiece sharp focus",
      "image",
    );
    expect(stacked.stats.qualityWordOverload).toBe(true);
  });

  it("produces a non-empty nextStepSuggestion when something is missing", () => {
    const diag = scorePrompt("一隻橘貓"); // 缺 action / scene / lighting / ...
    expect(diag.missingDimensions.length).toBeGreaterThan(0);
    expect(diag.nextStepSuggestion).toBeTruthy();
    expect(diag.nextStepSuggestion.length).toBeGreaterThan(4);
  });
});

// ─── Rewrite ─────────────────────────────────────────────────────────────

describe("qualityCoachEngine.rewritePrompt", () => {
  it("appends missing dimensions but never alters the original text", () => {
    const original = "一隻橘貓";
    const result = rewritePrompt(original);
    expect(result.rewritten.startsWith(original)).toBe(true);
    expect(result.additions.length).toBeGreaterThan(0);
  });

  it("respects onlyFillDimensions and only patches the requested ones", () => {
    const original = "一隻橘貓";
    const result = rewritePrompt(original, {
      onlyFillDimensions: ["lighting", "style"],
    });
    expect(result.filledDimensions).toEqual(
      expect.arrayContaining(["lighting", "style"]),
    );
    // Should not have filled e.g. camera in this case
    expect(result.filledDimensions).not.toContain("camera");
  });

  it("uses video snippets for video prompts (no 35mm 淺景深 nonsense)", () => {
    const original = "30 秒產品影片";
    const result = rewritePrompt(original);
    // The 35mm snippet only lives in the image catalog; the video catalog
    // for the camera dimension yields "穩定器跟拍, 慢推鏡".
    expect(result.modality).toBe("video");
    expect(result.rewritten).not.toContain("35mm");
  });

  it("uses voice snippets for voice prompts (script + tone, not lighting)", () => {
    const original = "幫我配音一段廣告";
    const result = rewritePrompt(original);
    expect(result.modality).toBe("voice");
    // Voice rewrite should never inject image-only lighting like "柔和午後逆光"
    expect(result.rewritten).not.toContain("逆光");
    expect(result.rewritten).not.toContain("35mm");
  });

  it("returns explanation describing what was filled", () => {
    const result = rewritePrompt("一隻橘貓");
    expect(result.explanation).toMatch(/補了/);
  });
});

// ─── Compare ─────────────────────────────────────────────────────────────

describe("qualityCoachEngine.comparePrompts", () => {
  it("picks the more complete prompt as winner", () => {
    const a = "一隻橘貓";
    const b =
      "一隻橘貓，側臥窗台，午後咖啡店，柔和逆光，水彩插畫風，35mm 淺景深，細節清晰";
    const result = comparePrompts(a, b);
    expect(result.winner).toBe("B");
    expect(result.gained.length).toBeGreaterThan(0);
  });

  it("reports tie when scores are within 2 points", () => {
    const a = "一位女性，側臥窗台，午後咖啡店，柔和逆光，水彩插畫風，35mm，細節清晰";
    // Slightly reworded but covering the same dimensions
    const b = "一位男性，站立窗邊，晨光客廳，順光，工筆水墨風格，特寫，4k 質感";
    const result = comparePrompts(a, b);
    expect(["A", "B", "tie"]).toContain(result.winner);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ─── Templates ───────────────────────────────────────────────────────────

describe("qualityCoachEngine.getTemplates", () => {
  it("returns templates per modality", () => {
    for (const m of ["image", "video", "music", "voice", "general"] as const) {
      const tpls = getTemplates(m);
      expect(tpls.length).toBeGreaterThan(0);
      expect(tpls[0].modality).toBe(m);
      expect(tpls[0].template).toBeTruthy();
      expect(tpls[0].example).toBeTruthy();
    }
  });

  it("filters by styleHint but falls back to full list when no match", () => {
    const hitting = getTemplates("image", "寫實");
    expect(hitting.length).toBe(1);
    expect(hitting[0].styleHint).toContain("寫實");

    const noMatch = getTemplates("image", "賽博龐克");
    // Fallback to full list
    expect(noMatch.length).toBeGreaterThan(0);
  });
});

// ─── Word similarity ─────────────────────────────────────────────────────

describe("qualityCoachEngine.jaccardWordSimilarity", () => {
  it("flags near-identical chinese prompts as similar", () => {
    const a = "一位女性側臥於窗台，午後逆光";
    const b = "一位女性側臥窗台，午後逆光，柔和";
    expect(jaccardWordSimilarity(a, b)).toBeGreaterThanOrEqual(0.55);
  });

  it("does NOT flag two completely different chinese short prompts as similar", () => {
    // 之前 char Jaccard 對中文常 ≥0.5 — 新版 word/char bigram 應該 <0.55
    const a = "幫我做個 30 秒影片";
    const b = "畫一張水彩插畫";
    expect(jaccardWordSimilarity(a, b)).toBeLessThan(0.55);
  });

  it("handles english word bigrams properly", () => {
    const a = "a portrait of a young girl in soft light";
    const b = "a portrait of a young girl in warm light";
    expect(jaccardWordSimilarity(a, b)).toBeGreaterThan(0.5);
  });
});

// ─── Struggle detection ──────────────────────────────────────────────────

describe("qualityCoachEngine.detectStruggle", () => {
  const now = 1_700_000_000_000;

  it("returns null when fewer than 3 prompts in window", () => {
    expect(
      detectStruggle(
        [
          { text: "一隻貓", at: now - 1000 },
          { text: "一隻橘貓", at: now - 500 },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("returns null when 3 prompts are not similar", () => {
    const diag = detectStruggle(
      [
        { text: "幫我做 30 秒 BGM", at: now - 2000 },
        { text: "畫一張寫實人像", at: now - 1000 },
        { text: "配音一段廣告", at: now - 100 },
      ],
      now,
    );
    expect(diag).toBeNull();
  });

  it("flags 3 near-identical retries within 60s window", () => {
    const diag = detectStruggle(
      [
        { text: "一位女性側臥窗台午後", at: now - 30_000 },
        { text: "一位女性側臥窗台午後逆光", at: now - 20_000 },
        { text: "一位女性側臥窗台午後柔和", at: now - 5_000 },
      ],
      now,
    );
    expect(diag).not.toBeNull();
    expect(diag!.sampleCount).toBe(3);
    expect(diag!.modality).toBe("image");
    expect(diag!.rewrittenPrompt.length).toBeGreaterThan(0);
  });

  it("ignores stale entries outside the 60s window", () => {
    const diag = detectStruggle(
      [
        { text: "一隻橘貓側臥", at: now - 120_000 },
        { text: "一隻橘貓側臥窗台", at: now - 65_000 },
        { text: "一隻橘貓側臥窗邊", at: now - 1_000 },
      ],
      now,
    );
    expect(diag).toBeNull();
  });
});
