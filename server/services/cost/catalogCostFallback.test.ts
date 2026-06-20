/**
 * catalogCostFallback.test.ts — AIDV-14 真實價後援（catalog → USD）
 * ──────────────────────────────────────────────────────────────────────────
 * 驗收重點：
 *   - 線上四家供應商（fal/gemini/elevenlabs/suno）無 usage.cost 時，能用 modelPricing
 *     目錄真實單位價算出非 0 的 costUsd，並標 costSource=catalog。
 *   - 上游有真實計費（providerCostUsd≠0）時優先用，標 costSource=provider。
 *   - OpenRouter 不走 catalog 後援（其 usage.cost 才是真相）。
 *   - 目錄無此 model / model 空 → "0" / null（誠實留空，不亂編）。
 *   - 永不 throw、永遠回合法 DECIMAL(12,6) 字串。
 */
import { describe, it, expect } from "vitest";
import {
  catalogCostUsd,
  resolveCostUsdWithCatalog,
  extractCatalogSignals,
} from "./catalogCostFallback";

function isLegalDecimal12_6(s: string): boolean {
  if (typeof s !== "string") return false;
  if (!/^-?\d{1,6}(\.\d{1,6})?$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 999999.999999;
}

describe("catalogCostUsd — 目錄真實單位價 → USD", () => {
  it("fal 圖片（Flux Pro 1.1, base 4 pts）→ 0.04 USD", () => {
    // 4 pts / 100 = 0.04
    expect(catalogCostUsd("fal-ai/flux-pro/v1.1")).toBe("0.040000");
  });
  it("elevenlabs TTS 含字符數（base 4 + 2k×4 pts/1k）→ 真實單位價推算", () => {
    // base 4 + ceil(2000/1000)*4 = 4 + 8 = 12 pts → 0.12
    expect(catalogCostUsd("elevenlabs/eleven-v3", { charCount: 2000 })).toBe(
      "0.120000"
    );
  });
  it("gemini 影片含時長（Veo2 base 35 + (10-5)*7）→ 真實單位價推算", () => {
    // base 35 + (10-5)*7 = 70 pts → 0.70
    expect(catalogCostUsd("gemini/veo-2", { durationSec: 10 })).toBe("0.700000");
  });
  it("suno 每首歌（base 10 pts）→ 0.10 USD", () => {
    expect(catalogCostUsd("suno-v4")).toBe("0.100000");
  });
  it("目錄無此 model → 0（不拿未知 model 的計費保底當真實價）", () => {
    expect(catalogCostUsd("totally-unknown-model")).toBe("0");
  });
  it("空 / null model → 0", () => {
    expect(catalogCostUsd("")).toBe("0");
    expect(catalogCostUsd(null)).toBe("0");
    expect(catalogCostUsd(undefined)).toBe("0");
  });
  it("回傳永遠合法 DECIMAL(12,6)", () => {
    for (const m of ["fal-ai/flux/schnell", "suno-v4", "unknown", ""]) {
      expect(isLegalDecimal12_6(catalogCostUsd(m))).toBe(true);
    }
  });
});

describe("resolveCostUsdWithCatalog — 來源優先序與標記", () => {
  it("上游真實計費（providerCostUsd≠0）→ 用之，costSource=provider", () => {
    const r = resolveCostUsdWithCatalog({
      providerCostUsd: "0.009000",
      provider: "fal_ai",
      modelId: "fal-ai/flux-pro/v1.1",
    });
    expect(r.costUsd).toBe("0.009000");
    expect(r.costSource).toBe("provider");
  });
  it("無上游價（'0'）＋非 OpenRouter ＋命中目錄 → catalog 後援", () => {
    const r = resolveCostUsdWithCatalog({
      providerCostUsd: "0",
      provider: "fal_ai",
      modelId: "fal-ai/flux-pro/v1.1",
    });
    expect(r.costUsd).toBe("0.040000");
    expect(r.costSource).toBe("catalog");
  });
  it("線上四家（gemini/elevenlabs/suno）皆能用 catalog 後援補非 0 真實價", () => {
    expect(
      resolveCostUsdWithCatalog({
        providerCostUsd: "0",
        provider: "gemini",
        modelId: "gemini/imagen-3",
      }).costSource
    ).toBe("catalog");
    expect(
      resolveCostUsdWithCatalog({
        providerCostUsd: "0",
        provider: "elevenlabs",
        modelId: "elevenlabs/multilingual-v2",
      }).costSource
    ).toBe("catalog");
    expect(
      resolveCostUsdWithCatalog({
        providerCostUsd: "0",
        provider: "suno",
        modelId: "suno-v4",
      }).costSource
    ).toBe("catalog");
  });
  it("OpenRouter 無上游價 → 不走 catalog 後援（保持 0 / null）", () => {
    const r = resolveCostUsdWithCatalog({
      providerCostUsd: "0",
      provider: "openrouter",
      modelId: "fal-ai/flux-pro/v1.1",
    });
    expect(r.costUsd).toBe("0");
    expect(r.costSource).toBe(null);
  });
  it("無上游價 ＋ 目錄無此 model → 0 / null（誠實留空）", () => {
    const r = resolveCostUsdWithCatalog({
      providerCostUsd: "0",
      provider: "fal_ai",
      modelId: "unknown-model",
    });
    expect(r.costUsd).toBe("0");
    expect(r.costSource).toBe(null);
  });
});

describe("extractCatalogSignals — best-effort 從 body 撈用量", () => {
  it("撈時長 / 字符 / 圖片數", () => {
    expect(
      extractCatalogSignals({ duration: 8, num_images: 3 })
    ).toMatchObject({ durationSec: 8, imageCount: 3 });
  });
  it("text 字串長度推 charCount", () => {
    expect(extractCatalogSignals({ text: "hello" }).charCount).toBe(5);
  });
  it("明確 charCount 優先於 text", () => {
    expect(
      extractCatalogSignals({ charCount: 1200, text: "x" }).charCount
    ).toBe(1200);
  });
  it("空 / 非物件 → 空訊號（不 throw）", () => {
    expect(extractCatalogSignals(null)).toEqual({});
    expect(extractCatalogSignals(undefined)).toEqual({});
    expect(
      extractCatalogSignals({} as Record<string, unknown>)
    ).toEqual({});
  });
});
