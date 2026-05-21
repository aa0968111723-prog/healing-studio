import { describe, expect, it } from "vitest";
import { buildWorldbuildingProductionPackage } from "../../../shared/worldbuilding-production-package";

describe("buildWorldbuildingProductionPackage", () => {
  it("傳入 storyboards 後 markdown 包含分鏡表與 prompts", () => {
    const pkg = buildWorldbuildingProductionPackage({ name: "世界A" } as any, [{ scenes: [{ startTime: "00:00", endTime: "00:05", sceneName: "客廳", visualDescription: "主角坐著", cameraMovement: "推鏡", dialogue: "你好", soundDesign: "雨聲" }] }]);
    expect(pkg.markdown).toContain("## 分鏡表");
    expect(pkg.markdown).toContain("## 逐鏡圖像 Prompt");
    expect(pkg.markdown).toContain("## 逐鏡影片 Prompt");
  });

  it("有 dialogue 時會出現在配音稿", () => {
    const pkg = buildWorldbuildingProductionPackage({} as any, [{ scenes: [{ dialogue: "歡迎來到這裡" }] }]);
    expect(pkg.markdown).toContain("歡迎來到這裡");
  });

  it("空 storyboards 不會 throw", () => {
    expect(() => buildWorldbuildingProductionPackage({} as any, [])).not.toThrow();
  });

  it("不完整世界仍可輸出 warning", () => {
    const pkg = buildWorldbuildingProductionPackage({} as any, []);
    expect(pkg.warnings.length).toBeGreaterThan(0);
  });
});
