/**
 * videoCatalogConsistency.test.ts — SSOT 一致性守門
 *
 * 這層測試是 brain-config-gap-audit-2026-04-20.md 標的 P2 補位：
 *   - router 真的會呼叫的 modelId 必須有定價且在 falModels catalog
 *   - UI 顯示用的 modelId 必須有定價（pricing badge / cost guard 才不會 0 分）
 *   - dispatcher fallback 鏈裡的 modelId 必須有定價（fallback 觸發時不會崩）
 *   - brain GENERATION_ENGINE_CATALOG.videoEngine 暴露的 fal-ai 選項必須有定價
 *
 * 任何漂移都會在 CI 立刻出問題，避免「UI 可選、執行時不可用」的 silent drift。
 */

import { describe, expect, it } from "vitest";
import {
  T2V_ROUTER_IDS,
  I2V_ROUTER_IDS,
  V2V_ROUTER_IDS,
  ENHANCE_ROUTER_IDS,
  CONTROL_ROUTER_IDS,
  CONTROL_CATEGORY_BY_ID,
  ALL_VIDEO_ROUTER_IDS,
  ALL_VIDEO_PRICING_IDS,
} from "../../../shared/videoModelCatalog";
import { MODEL_PRICING_CATALOG } from "../modelPricing";
import { FAL_MODEL_CATALOG } from "../falModels";
import { GENERATION_ENGINE_CATALOG } from "../../routers/brain";
import { normalizeEngineModelId } from "../../../shared/engineModelIds";

describe("video catalog SSOT consistency", () => {
  it("every router-called video id has pricing", () => {
    const pricingIds = new Set(Object.keys(MODEL_PRICING_CATALOG));
    const missing = ALL_VIDEO_ROUTER_IDS.filter(id => !pricingIds.has(id));
    expect(missing, `pricing missing for: ${missing.join(", ")}`).toEqual([]);
  });

  it("every UI-displayed video id has pricing (so UI badge can show points)", () => {
    const pricingIds = new Set(Object.keys(MODEL_PRICING_CATALOG));
    const missing = ALL_VIDEO_PRICING_IDS.filter(id => !pricingIds.has(id));
    expect(missing, `pricing missing for: ${missing.join(", ")}`).toEqual([]);
  });

  it("every router-called t2v id is in falModels text-to-video catalog", () => {
    const ids = new Set(
      FAL_MODEL_CATALOG["text-to-video"].map(m => m.modelId)
    );
    const missing = T2V_ROUTER_IDS.filter(id => !ids.has(id));
    expect(missing, `falModels t2v missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("every router-called i2v id is in falModels image-to-video catalog", () => {
    const ids = new Set(
      FAL_MODEL_CATALOG["image-to-video"].map(m => m.modelId)
    );
    const missing = I2V_ROUTER_IDS.filter(id => !ids.has(id));
    expect(missing, `falModels i2v missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("every router-called v2v id is in falModels video-to-video catalog", () => {
    const ids = new Set(
      FAL_MODEL_CATALOG["video-to-video"].map(m => m.modelId)
    );
    const missing = V2V_ROUTER_IDS.filter(id => !ids.has(id));
    expect(missing, `falModels v2v missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("every router-called enhance id is in falModels (enhance lives under video-to-video)", () => {
    const ids = new Set(
      FAL_MODEL_CATALOG["video-to-video"].map(m => m.modelId)
    );
    const missing = ENHANCE_ROUTER_IDS.filter(id => !ids.has(id));
    expect(missing, `falModels enhance missing: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("every router-called control id is in falModels (per-id category mapping)", () => {
    const i2vIds = new Set(
      FAL_MODEL_CATALOG["image-to-video"].map(m => m.modelId)
    );
    const v2vIds = new Set(
      FAL_MODEL_CATALOG["video-to-video"].map(m => m.modelId)
    );
    const missing = CONTROL_ROUTER_IDS.filter(id => {
      const cat = CONTROL_CATEGORY_BY_ID[id];
      return cat === "image-to-video" ? !i2vIds.has(id) : !v2vIds.has(id);
    });
    expect(missing, `falModels control missing: ${missing.join(", ")}`).toEqual(
      []
    );
  });

  it("brain videoEngine fal options all have pricing (gemini/* exempt)", () => {
    const pricingIds = new Set(Object.keys(MODEL_PRICING_CATALOG));
    const options = GENERATION_ENGINE_CATALOG.videoEngine.options.map(o =>
      normalizeEngineModelId(o.value)
    );
    // gemini/ 路徑走 GEMINI_API_KEY 不需 fal pricing
    const falOptions = options.filter(id => id.startsWith("fal-ai/"));
    const missing = falOptions.filter(id => !pricingIds.has(id));
    expect(missing, `brain videoEngine missing pricing: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
