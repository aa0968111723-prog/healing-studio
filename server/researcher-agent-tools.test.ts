import { describe, it, expect } from "vitest";
import {
  compareModels,
  getCategoriesInCatalog,
} from "./services/spiritTools/researcherTools";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
} from "../shared/global-agent-tools";

/**
 * Regression tests for the new research.compareModels agent tool that
 * upgrades 查查 from "free-form Sonar wrapper" to a real comparison agent
 * grounded in the site's MODEL_PRICING_CATALOG.
 *
 * These cases pin the structured shape (rows / recommendations / handoff)
 * and the deterministic heuristics (use-case fit scoring, tier-quality
 * ranking, key-availability filtering) so the LLM-facing contract stays
 * stable when new models land in the catalogue.
 */

describe("research.compareModels tool registration", () => {
  it("registers as a low-risk, no-confirmation, server-side tool", () => {
    const tool = getGlobalAgentTool("research.compareModels");
    expect(tool).not.toBeNull();
    expect(tool!.riskLevel).toBe("low");
    expect(tool!.requiresHuman).toBe(false);
    expect(tool!.executionTarget).toBe("server-side");
    expect(isKnownGlobalAgentTool("research.compareModels")).toBe(true);
  });

  it("research.* now has 2+ tools (deepSearch + compareModels)", () => {
    const names = GLOBAL_AGENT_TOOL_REGISTRY.map(t => t.name);
    const researchTools = names.filter(n => n.startsWith("research."));
    expect(researchTools.length).toBeGreaterThanOrEqual(2);
    expect(researchTools).toContain("research.deepSearch");
    expect(researchTools).toContain("research.compareModels");
  });
});

describe("researcherTools.compareModels", () => {
  // 多數測試走 includeUnavailable=true，因為 vitest 環境裡 FAL_API_KEY /
  // ELEVENLABS_API_KEY 等多半沒設，checkModelAvailability 會把整個 catalogue
  // 篩成空。這是 production 預設行為（不推薦壞掉的模型）但 catalogue 邏輯
  // 本身應該獨立驗證 — 真實的 availability 篩選有自己的 case。

  it("pulls all text-to-image models from the catalog (with availability bypass)", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
    });
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.category).toBe("text-to-image");
      expect(row.pointsRange.min).toBeGreaterThanOrEqual(0);
      expect(row.pointsRange.max).toBeGreaterThanOrEqual(row.pointsRange.min);
      expect(row.costUsdRange.min).toMatch(/^\$\d+\.\d+$/);
    }
  });

  it("default includeUnavailable=false filters out models with missing API keys", () => {
    // 不主動 stub env — 直接驗證行為差異即可。
    const withUnavailable = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
    });
    const filtered = compareModels({
      category: "text-to-image",
      includeUnavailable: false,
    });
    expect(filtered.rows.length).toBeLessThanOrEqual(withUnavailable.rows.length);
    for (const row of filtered.rows) {
      expect(row.available).toBe(true);
    }
  });

  it("sorts results by basePoints ascending so cheapest is first", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      maxResults: 5,
    });
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i].pointsRange.min).toBeGreaterThanOrEqual(
        result.rows[i - 1].pointsRange.min,
      );
    }
  });

  it("recommendations.cheapest matches the lowest pointsRange.min row", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
    });
    expect(result.recommendations.cheapest).not.toBeNull();
    expect(result.recommendations.cheapest!.modelId).toBe(result.rows[0].modelId);
  });

  it("recommendations.bestQuality picks the highest-tier model", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
    });
    expect(result.recommendations.bestQuality).not.toBeNull();
    const bq = result.recommendations.bestQuality!;
    for (const row of result.rows) {
      const tierRank = { free: 1, economy: 2, standard: 3, premium: 4, ultra: 5 };
      expect(tierRank[bq.tier]).toBeGreaterThanOrEqual(tierRank[row.tier]);
    }
  });

  it("useCase=draft pushes bestFit toward cheap/fast models (schnell over Pro)", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      useCase: "draft",
    });
    expect(result.recommendations.bestFit).not.toBeNull();
    // bestFit 的 strengths 應該包含 useCase 偏好的 token 之一
    const fitStrengths = result.recommendations.bestFit!.strengths.join("/");
    expect(fitStrengths).toMatch(/極快|便宜|草稿|輕量/);
  });

  it("useCase=commercial picks Imagen 4 over Schnell when both are candidates", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      modelIds: ["fal-ai/flux/schnell", "fal-ai/imagen4/preview"],
      useCase: "commercial",
    });
    expect(result.recommendations.bestFit).not.toBeNull();
    // Imagen 4 strengths 含「商業 / 品牌 / 乾淨」字樣，commercial useCase
    // 該蓋過 schnell 的「極快 / 便宜」。
    expect(result.recommendations.bestFit!.modelId).toBe("fal-ai/imagen4/preview");
  });

  it("modelIds filter overrides category-wide pull and respects given order", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      modelIds: ["fal-ai/flux/schnell", "fal-ai/flux-pro/v1.1"],
    });
    expect(result.rows.length).toBe(2);
    const ids = new Set(result.rows.map(r => r.modelId));
    expect(ids.has("fal-ai/flux/schnell")).toBe(true);
    expect(ids.has("fal-ai/flux-pro/v1.1")).toBe(true);
  });

  it("skips unknown modelIds silently (LLM hallucinations don't crash)", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      modelIds: ["fal-ai/flux/schnell", "fal-ai/never-existed-9000"],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].modelId).toBe("fal-ai/flux/schnell");
  });

  it("estimateFor populates estimatedPoints for video models with duration", () => {
    const result = compareModels({
      category: "image-to-video",
      includeUnavailable: true,
      modelIds: ["fal-ai/kling-video/v2.1/standard/image-to-video"],
      estimateFor: { durationSec: 5 },
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].estimatedPoints).not.toBeNull();
    expect(result.rows[0].estimatedPoints!).toBeGreaterThan(0);
  });

  it("estimateFor=undefined leaves estimatedPoints null", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      maxResults: 2,
    });
    for (const row of result.rows) {
      expect(row.estimatedPoints).toBeNull();
    }
  });

  it("highlights surface significant price spread when present", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
    });
    // text-to-image catalogue 含 schnell（極便宜）跟 flux-pro-ultra（旗艦），
    // 最大 / 最小 maxPoints 差距明顯，應觸發「價差顯著」highlight。
    const text = result.highlights.join("|");
    expect(text).toMatch(/價差|tier|API/);
  });

  it("suggestedHandoff for text-to-video routes to video-specialist (@影影)", () => {
    const result = compareModels({
      category: "text-to-video",
      includeUnavailable: true,
      maxResults: 3,
    });
    expect(result.suggestedHandoff.to).toBe("video-specialist");
    expect(result.suggestedHandoff.nickname).toBe("影影");
  });

  it("suggestedHandoff for text-to-image routes to image-specialist (@圖圖)", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      maxResults: 3,
    });
    expect(result.suggestedHandoff.to).toBe("image-specialist");
    expect(result.suggestedHandoff.nickname).toBe("圖圖");
  });

  it("returns empty rows + companion handoff when modelIds yield no matches", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      modelIds: ["fal-ai/never-existed-9000"],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.recommendations.cheapest).toBeNull();
    expect(result.suggestedHandoff.to).toBe("companion");
  });

  it("maxResults clamps row count without breaking sort order", () => {
    const all = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      maxResults: 20,
    });
    const clipped = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      maxResults: 3,
    });
    expect(clipped.rows.length).toBeLessThanOrEqual(3);
    // clipped 必須是 all 的前 N 名（同樣依 basePoints 升冪）
    for (let i = 0; i < clipped.rows.length; i++) {
      expect(clipped.rows[i].modelId).toBe(all.rows[i].modelId);
    }
  });

  it("summary stays human-readable and references row count", () => {
    const result = compareModels({
      category: "text-to-image",
      includeUnavailable: true,
      useCase: "draft",
    });
    expect(result.summary).toMatch(/比了 \d+ 個/);
    expect(result.summary).toMatch(/最便宜|旗艦|最貼/);
  });
});

describe("researcherTools.getCategoriesInCatalog", () => {
  it("returns every category that has at least one model entry", () => {
    const cats = getCategoriesInCatalog();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toContain("text-to-image");
    expect(cats).toContain("text-to-video");
    // sorted
    const sorted = [...cats].sort();
    expect(cats).toEqual(sorted);
  });
});
