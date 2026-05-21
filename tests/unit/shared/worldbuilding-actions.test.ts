import { describe, expect, it } from "vitest";
import { getWorldbuildingActionPlan } from "../../../shared/worldbuilding-actions";

describe("getWorldbuildingActionPlan", () => {
  it("空世界 -> drafting 且 not ready", () => {
    const plan = getWorldbuildingActionPlan(null);
    expect(plan.generationState).toBe("drafting");
    expect(plan.readyForGeneration).toBe(false);
  });

  it("骨架角色沒外觀 -> 補角色視覺", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "小雨" }] as any });
    expect(plan.primaryAction.cta).toContain("補角色");
  });

  it("完整角色但沒場景 -> 建立主要場景", () => {
    const plan = getWorldbuildingActionPlan({ characters: [{ name: "A", appearance: "x", outfits:["a"], expressions:["笑"], threeViewSheet:{frontImageUrl:"a"} }] as any, scenes: [] } as any);
    expect(plan.primaryAction.label).toContain("建立主要場景");
  });

  it("有角色場景風格但無分鏡 -> storyboard_ready", () => {
    const plan = getWorldbuildingActionPlan({ characters:[{name:"A",appearance:"x",outfits:["a"],expressions:["笑"],threeViewSheet:{frontImageUrl:"a"}}], scenes:[{name:"S",environment:"e",mood:"m",lighting:"l"}], styleProfiles:[{artStyle:"日系"}] } as any, { storyboardsCount: 0 });
    expect(plan.generationState).toBe("storyboard_ready");
  });

  it("有分鏡但無素材 -> 有視覺素材 warning", () => {
    const plan = getWorldbuildingActionPlan({ characters:[{name:"A",appearance:"x",outfits:["a"],expressions:["笑"],threeViewSheet:{frontImageUrl:"a"}}], scenes:[{name:"S",environment:"e",mood:"m",lighting:"l"}], styleProfiles:[{artStyle:"日系"}] } as any, { storyboardsCount: 1, visualAssetsCount: 0 });
    expect(plan.blockers.some(b => b.reason.includes("視覺素材"))).toBe(true);
  });

  it("完整世界 + 分鏡 + 素材 -> generation_ready", () => {
    const plan = getWorldbuildingActionPlan({ characters:[{name:"A",appearance:"x",outfits:["a"],expressions:["笑"],threeViewSheet:{frontImageUrl:"a"},voiceProfile:{emotion:"calm"}}], scenes:[{name:"S",environment:"e",mood:"m",lighting:"l"}], styleProfiles:[{artStyle:"日系"}], musicThemes:[{mood:"療癒"}] } as any, { storyboardsCount: 1, visualAssetsCount: 2 });
    expect(plan.generationState).toBe("generation_ready");
  });
});
