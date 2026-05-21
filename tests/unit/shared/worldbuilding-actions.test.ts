import { describe, expect, it } from "vitest";
import { getWorldbuildingActionPlan } from "../../../shared/worldbuilding-actions";

const base = { characters:[{id:"c1",name:"A",appearance:"x",outfits:[{imageUrl:"a"}],expressions:[{imageUrl:"e"}],threeViewSheet:{frontImageUrl:"a"},voiceProfile:{emotion:"calm"}}], scenes:[{id:"s1",name:"S",environment:"e",mood:"m",lighting:"l"}], styleProfiles:[{artStyle:"日系"}], musicThemes:[{mood:"療癒"}] } as any;

describe("getWorldbuildingActionPlan", () => {
  it("generation_ready 時 readyForGeneration 才 true", () => {
    const plan = getWorldbuildingActionPlan(base, { storyboardsCount: 1, visualAssetsCount: 2 });
    expect(plan.generationState).toBe("generation_ready");
    expect(plan.readyForGeneration).toBe(true);
  });
  it("asset_ready 時 readyForGeneration false", () => {
    const plan = getWorldbuildingActionPlan(base, { storyboardsCount: 1, visualAssetsCount: 0 });
    expect(plan.generationState).toBe("asset_ready");
    expect(plan.readyForGeneration).toBe(false);
  });
  it("有角色場景風格分鏡但沒有聲音", () => {
    const b = { ...base, characters:[{...base.characters[0], voiceProfile: undefined}], musicThemes:[] };
    const plan = getWorldbuildingActionPlan(b, { storyboardsCount: 1, visualAssetsCount: 2 });
    expect(plan.readinessFlags.readyForVideoGeneration).toBe(true);
    expect(plan.readinessFlags.readyForFullProduction).toBe(false);
  });
  it("有聲音但沒有分鏡", () => {
    const plan = getWorldbuildingActionPlan(base, { storyboardsCount: 0, visualAssetsCount: 2 });
    expect(plan.readinessFlags.readyForAudioGeneration).toBe(true);
    expect(plan.readinessFlags.readyForVideoGeneration).toBe(false);
  });
});
