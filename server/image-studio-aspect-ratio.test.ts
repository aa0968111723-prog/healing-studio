import { describe, expect, it } from "vitest";
import { normalizeAspectRatio } from "./routers/imageStudio";

// ─── SeeDream v4 支援的比例 ───────────────────────────────────────────────────
const SEEDREAM_V4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

// ─── Google Imagen 4 支援的比例 ───────────────────────────────────────────────
const IMAGEN4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

// ─── Nano Banana Pro Edit 支援的比例（完整集合）────────────────────────────────
const NANO_BANANA_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3",
  "4:1", "1:4", "21:9", "auto",
] as const;

describe("normalizeAspectRatio — SeeDream v4", () => {
  it("passes through supported ratios unchanged", () => {
    for (const r of SEEDREAM_V4_RATIOS) {
      expect(normalizeAspectRatio(r, SEEDREAM_V4_RATIOS)).toBe(r);
    }
  });

  it("maps 'auto' to '1:1' (closest square)", () => {
    expect(normalizeAspectRatio("auto", SEEDREAM_V4_RATIOS)).toBe("1:1");
  });

  it("maps wide ratio 21:9 to 16:9 (closest wide)", () => {
    expect(normalizeAspectRatio("21:9", SEEDREAM_V4_RATIOS)).toBe("16:9");
  });

  it("maps 4:1 to 16:9 (closest wide among supported)", () => {
    expect(normalizeAspectRatio("4:1", SEEDREAM_V4_RATIOS)).toBe("16:9");
  });

  it("maps tall ratio 1:4 to 9:16 (closest tall)", () => {
    expect(normalizeAspectRatio("1:4", SEEDREAM_V4_RATIOS)).toBe("9:16");
  });

  it("maps 1:2 to 2:3 (closest tall)", () => {
    // 1:2 = 0.5, 9:16 = 0.5625, 2:3 = 0.667 → 9:16 is closest
    expect(normalizeAspectRatio("1:2", SEEDREAM_V4_RATIOS)).toBe("9:16");
  });
});

describe("normalizeAspectRatio — Google Imagen 4", () => {
  it("passes through supported ratios unchanged", () => {
    for (const r of IMAGEN4_RATIOS) {
      expect(normalizeAspectRatio(r, IMAGEN4_RATIOS)).toBe(r);
    }
  });

  it("maps 'auto' to '1:1'", () => {
    expect(normalizeAspectRatio("auto", IMAGEN4_RATIOS)).toBe("1:1");
  });

  it("maps 3:2 to 4:3 (closest supported wide)", () => {
    // 3:2 = 1.5, 4:3 ≈ 1.33, 16:9 ≈ 1.78 → 4:3 is closer
    expect(normalizeAspectRatio("3:2", IMAGEN4_RATIOS)).toBe("4:3");
  });

  it("maps 2:3 to 3:4 (closest supported tall)", () => {
    // 2:3 ≈ 0.667, 3:4 = 0.75, 9:16 ≈ 0.5625 → 3:4 is closer
    expect(normalizeAspectRatio("2:3", IMAGEN4_RATIOS)).toBe("3:4");
  });

  it("maps 21:9 to 16:9 (closest wide)", () => {
    expect(normalizeAspectRatio("21:9", IMAGEN4_RATIOS)).toBe("16:9");
  });

  it("maps 4:1 to 16:9 (only wide option available)", () => {
    expect(normalizeAspectRatio("4:1", IMAGEN4_RATIOS)).toBe("16:9");
  });
});

describe("normalizeAspectRatio — Nano Banana Pro Edit (full set)", () => {
  it("passes through 'auto' unchanged (supported)", () => {
    expect(normalizeAspectRatio("auto", NANO_BANANA_RATIOS)).toBe("auto");
  });

  it("passes through common ratios unchanged", () => {
    for (const r of ["1:1", "16:9", "9:16", "4:3", "3:4", "4:1", "1:4", "21:9"]) {
      expect(normalizeAspectRatio(r, NANO_BANANA_RATIOS)).toBe(r);
    }
  });

  it("maps unknown ratio 5:3 to closest (16:9 ≈ 1.78 vs 5:3 ≈ 1.67)", () => {
    // 5:3 ≈ 1.667, 4:3 ≈ 1.333, 3:2 = not in set, 16:9 ≈ 1.778
    // diff: 4:3=0.333, 16:9=0.111 → 16:9 is closest
    expect(normalizeAspectRatio("5:3", NANO_BANANA_RATIOS)).toBe("16:9");
  });
});

describe("normalizeAspectRatio — edge cases", () => {
  it("handles malformed ratio string gracefully", () => {
    const ratios = ["1:1", "16:9"] as const;
    // Should return first supported ratio when can't parse
    expect(normalizeAspectRatio("invalid", ratios)).toBe("1:1");
    expect(normalizeAspectRatio("0:0", ratios)).toBe("1:1");
  });

  it("handles 'auto' when 1:1 is not supported", () => {
    const ratios = ["16:9", "9:16"] as const;
    expect(normalizeAspectRatio("auto", ratios)).toBe("16:9");
  });
});
