/**
 * worldStyle（I-2 世界風格注入，AIDV-80）純函式測試。
 *
 * 守住：
 *   1. buildWorldStylePrefix 取預設 profile 的關鍵視覺欄位組精簡前綴；無資料回空。
 *   2. applyWorldStyle 旗標關＝原樣（零行為改變）；旗標開＋有前綴＝prepend；無前綴＝原樣。
 */
import { describe, it, expect } from "vitest";
import { buildWorldStylePrefix, applyWorldStyle } from "./worldStyle";

const WORLD = {
  defaultStyleProfileId: "sp2",
  styleProfiles: [
    { id: "sp1", artStyle: "寫實", palette: ["#111"], lighting: "低調" },
    { id: "sp2", triggerWord: "ghibliStyle", artStyle: "日系賽璐璐", palette: ["#aabbcc", "#ddeeff"], lighting: "邊緣光", shadingModel: "cel" },
  ],
};

describe("buildWorldStylePrefix", () => {
  it("取預設 profile（defaultStyleProfileId）的視覺欄位組前綴", () => {
    const prefix = buildWorldStylePrefix(WORLD);
    expect(prefix).toContain("ghibliStyle");
    expect(prefix).toContain("日系賽璐璐");
    expect(prefix).toContain("palette: #aabbcc / #ddeeff");
    expect(prefix).toContain("邊緣光");
    expect(prefix).toContain("cel");
    // 不應取到非預設 profile
    expect(prefix).not.toContain("寫實");
  });

  it("無 defaultStyleProfileId → 退第一個 profile", () => {
    const prefix = buildWorldStylePrefix({ styleProfiles: [{ id: "x", artStyle: "水彩" }] });
    expect(prefix).toBe("水彩");
  });

  it("無 world / 無 profiles → 空字串", () => {
    expect(buildWorldStylePrefix(null)).toBe("");
    expect(buildWorldStylePrefix({})).toBe("");
    expect(buildWorldStylePrefix({ styleProfiles: [] })).toBe("");
  });
});

describe("applyWorldStyle", () => {
  it("旗標關 → 原樣回傳（零行為改變）", () => {
    expect(applyWorldStyle("a cat", "ghibliStyle, 日系", false)).toBe("a cat");
  });

  it("旗標開＋有前綴 → prepend", () => {
    expect(applyWorldStyle("a cat", "ghibliStyle", true)).toBe("ghibliStyle\n\na cat");
  });

  it("旗標開但無前綴 → 原樣", () => {
    expect(applyWorldStyle("a cat", "", true)).toBe("a cat");
    expect(applyWorldStyle("a cat", undefined, true)).toBe("a cat");
  });

  it("prompt 為空＋有前綴 → 回前綴", () => {
    expect(applyWorldStyle(undefined, "ghibliStyle", true)).toBe("ghibliStyle");
    expect(applyWorldStyle("", "ghibliStyle", true)).toBe("ghibliStyle");
  });
});
