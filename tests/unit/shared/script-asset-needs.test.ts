import { describe, expect, it } from "vitest";
import { detectScriptAssetNeeds } from "../../../shared/script-asset-needs";

describe("detectScriptAssetNeeds", () => {
  it("有對白時風險包含需要配音", () => {
    const r = detectScriptAssetNeeds("小明說：你好。\n小華回答：嗨");
    expect(r.risks).toContain("需要配音");
  });

  it("有雨聲與腳步時會抓到 audio cues", () => {
    const r = detectScriptAssetNeeds("雨聲中傳來腳步聲");
    expect(r.audioCues.length).toBeGreaterThan(0);
  });

  it("有孤單與療癒時會抓到 mood cues", () => {
    const r = detectScriptAssetNeeds("孤單但療癒的夜晚");
    expect(r.musicMoodCues).toEqual(expect.arrayContaining(["孤單", "療癒"]));
  });

  it("有特寫與遠景時會抓到 camera cues", () => {
    const r = detectScriptAssetNeeds("先特寫眼神，再切遠景");
    expect(r.cameraCues).toEqual(expect.arrayContaining(["特寫", "遠景"]));
  });
});
