import { describe, expect, it } from "vitest";
import { getWorldbuildingActionPlan } from "../../../shared/worldbuilding-actions";

describe("getWorldbuildingActionPlan", () => {
  it("empty world 不會 readyForGeneration", () => {
    const plan = getWorldbuildingActionPlan(null);
    expect(plan.readyForGeneration).toBe(false);
    expect(plan.primaryAction.label).toContain("建立主角");
  });

  it("only skeleton character 仍然提示補角色視覺", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "小雨" }] as any });
    expect(plan.primaryAction.label).toContain("角色視覺一致性");
  });

  it("有角色但沒場景會提示補場景", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "小雨", appearance: "短髮", outfits:["便服"], expressions:["笑"], threeViewSheet:{frontImageUrl:"x"} }] as any, scenes: [] } as any);
    expect(plan.primaryAction.label).toContain("建立主要場景");
  });

  it("有角色場景但沒 style 會提示補風格", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "A", appearance: "x", outfits:["a"], expressions:["笑"] , threeViewSheet:{frontImageUrl:"a"}, voiceProfile:{emotion:"calm", languageCode:"zh-TW"}}], scenes:[{name:"家", environment:"客廳", mood:"暖", lighting:"柔"}] } as any);
    expect(plan.primaryAction.label).toContain("建立視覺風格");
  });

  it("完整世界會提示產生製作包", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "A", appearance: "x", outfits:["a"], expressions:["笑"] , threeViewSheet:{frontImageUrl:"a"}, voiceProfile:{emotion:"calm", languageCode:"zh-TW"}}], scenes:[{name:"家", environment:"客廳", mood:"暖", lighting:"柔"}], styleProfiles:[{artStyle:"動畫", palette:["暖橘"]}], musicThemes:[{mood:"療癒", instruments:["鋼琴"]}] } as any);
    expect(plan.primaryAction.cta).toContain("產生完整製作包");
  });

  it("blockers 會列出缺漏原因", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "A" }] as any });
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers[0].reason.length).toBeGreaterThan(0);
  });
});
