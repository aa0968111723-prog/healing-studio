import { describe, expect, it } from "vitest";
import { detectScriptAssetNeeds } from "../../../shared/script-asset-needs";

describe("detectScriptAssetNeeds", () => {
  it("偵測雨聲 / 踩水 / 手機震動", () => {
    const r = detectScriptAssetNeeds("雨聲、踩水、手機震動");
    expect(r.audioCues).toEqual(expect.arrayContaining(["雨聲","踩水","手機震動"]));
  });
  it("偵測青春 / 命運感 / 空靈", () => {
    const r = detectScriptAssetNeeds("青春、命運感與空靈");
    expect(r.musicMoodCues).toEqual(expect.arrayContaining(["青春","命運感","空靈"]));
  });
  it("偵測傘 / 書包 / 花瓶 與 VO / 旁白", () => {
    const r = detectScriptAssetNeeds("VO 旁白：拿著傘與書包，旁邊有花瓶");
    expect(r.propsNeeded).toEqual(expect.arrayContaining(["傘","書包","花瓶"]));
    expect(r.subtitleOrNarrationCues).toEqual(expect.arrayContaining(["VO","旁白"]));
  });
  it("world 風險提示", () => {
    const r = detectScriptAssetNeeds("青春配樂", undefined, { musicThemes: [] } as any);
    expect(r.risks.some(x => x.includes("musicThemes"))).toBe(true);
  });
  it("world 有角色但缺 appearance", () => {
    const r = detectScriptAssetNeeds("測試", undefined, { characters: [{ name: "A" }] } as any);
    expect(r.risks.some(x => x.includes("角色外觀不足"))).toBe(true);
  });
});
