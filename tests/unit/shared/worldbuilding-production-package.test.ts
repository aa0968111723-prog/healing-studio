import { describe, expect, it } from "vitest";
import { buildWorldbuildingProductionPackage } from "../../../shared/worldbuilding-production-package";

describe("buildWorldbuildingProductionPackage", () => {
  it("empty world 可以輸出 markdown，但有 warnings", () => {
    const pkg = buildWorldbuildingProductionPackage(null);
    expect(pkg.markdown.length).toBeGreaterThan(10);
    expect(pkg.warnings.length).toBeGreaterThan(0);
  });

  it("partial world 會列 missingItems", () => {
    const pkg = buildWorldbuildingProductionPackage({ characters: [{ name: "A" }] as any });
    expect(pkg.json.missingItems.length).toBeGreaterThan(0);
  });

  it("complete world 有 character prompts / scene prompts", () => {
    const pkg = buildWorldbuildingProductionPackage({
      name: "療癒小鎮", genre: "療癒", era: "現代", coreEmotion: "溫暖",
      characters: [{ name: "A", appearance: "短髮", personality: "善良", outfit: "襯衫", expressions:["笑"] }],
      scenes: [{ name: "咖啡廳", environment: "木質空間", mood: "舒服", lighting: "晨光" }],
      styleProfiles: [{ artStyle: "日系", palette: ["米白"] }], musicThemes: [{ mood: "放鬆", instruments: ["鋼琴"] }], voiceProfile: { tone: "溫柔" },
    } as any);
    expect(pkg.json.imagePromptSeeds.some(s => s.includes("角色"))).toBe(true);
    expect(pkg.json.imagePromptSeeds.some(s => s.includes("場景"))).toBe(true);
  });

  it("markdown 包含角色卡、場景卡、視覺風格、聲音指南", () => {
    const pkg = buildWorldbuildingProductionPackage({} as any);
    expect(pkg.markdown).toContain("## 角色卡");
    expect(pkg.markdown).toContain("## 場景卡");
    expect(pkg.markdown).toContain("## 視覺風格指南");
    expect(pkg.markdown).toContain("## 聲音指南");
  });

  it("readiness 不可以在空世界時是 100%", () => {
    const pkg = buildWorldbuildingProductionPackage({} as any);
    expect(pkg.readinessPercent).toBeLessThan(100);
  });
});
