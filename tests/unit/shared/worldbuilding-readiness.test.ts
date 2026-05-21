import { describe, expect, it } from "vitest";
import { calculateWorldbuildingReadiness } from "../../../shared/worldbuilding-readiness";

describe("calculateWorldbuildingReadiness", () => {
  it("計算每角色每場景覆蓋率", () => {
    const r = calculateWorldbuildingReadiness({ characters:[{id:"c1",name:"安倢",appearance:"a"}], scenes:[{id:"s1",name:"克難坡",environment:"e"}] } as any);
    expect(r.visualCoverage.characterCoverage[0].percent).toBeLessThan(100);
    expect(r.visualCoverage.sceneCoverage[0].percent).toBeLessThan(100);
  });
});
