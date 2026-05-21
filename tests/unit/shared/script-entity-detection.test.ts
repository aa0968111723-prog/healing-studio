import { describe, it, expect } from "vitest";
import { detectScriptEntities } from "../../../shared/script-entity-detection";
import type { WorldbuildingFrameworkData } from "../../../shared/worldbuilding-types";

describe("detectScriptEntities", () => {
  it("returns empty result for empty input", () => {
    const r = detectScriptEntities("");
    expect(r.characters).toEqual([]);
    expect(r.scenes).toEqual([]);
    expect(r.dialogues).toEqual([]);
  });

  it("detects dialogue speakers like 「小光：你還好嗎？」", () => {
    const text = `
場景 1：黃昏的森林

小光：你還好嗎？
艾雅：我沒事。
小光：那就好。
    `;
    const r = detectScriptEntities(text);
    const names = r.characters.map(c => c.name);
    expect(names).toContain("小光");
    expect(names).toContain("艾雅");
    // 小光出現兩次 → occurrences 應該 >= 2
    const xiaoguang = r.characters.find(c => c.name === "小光");
    expect(xiaoguang?.occurrences).toBeGreaterThanOrEqual(2);
    expect(r.dialogues.length).toBeGreaterThanOrEqual(3);
  });

  it("detects screenplay slugline INT./EXT.", () => {
    const text = `
INT. CLASSROOM — DAY

Teacher: Sit down please.

EXT. FOREST — NIGHT
    `;
    const r = detectScriptEntities(text);
    const sceneNames = r.scenes.map(s => s.name.toUpperCase());
    expect(sceneNames.some(n => n.includes("CLASSROOM"))).toBe(true);
    expect(sceneNames.some(n => n.includes("FOREST"))).toBe(true);
  });

  it("detects Chinese scene markers (場景 1、第一場)", () => {
    const text = `
場景 1：森林入口
第二場：山谷瀑布
    `;
    const r = detectScriptEntities(text);
    // We just want at least one detected scene
    expect(r.scenes.length).toBeGreaterThanOrEqual(1);
  });

  it("flags unknown characters when comparing to existing world", () => {
    const text = `
小光：嗨。
未知者：你好。
    `;
    const world: WorldbuildingFrameworkData = {
      name: "世界",
      characters: [
        { id: "c1", name: "小光", role: "protagonist" },
      ],
      scenes: [],
    };
    const r = detectScriptEntities(text, world);
    expect(r.unknownCharacters.map(u => u.name)).toContain("未知者");
    expect(r.unknownCharacters.map(u => u.name)).not.toContain("小光");
    const xiaoguang = r.characters.find(c => c.name === "小光");
    expect(xiaoguang?.matchedExistingId).toBe("c1");
  });

  it("ignores common dialogue tags like OS / VO / scene markers", () => {
    const text = `
OS：旁白說話了。
場景：教室
    `;
    const r = detectScriptEntities(text);
    // OS shouldn't be picked up as a character
    expect(r.characters.map(c => c.name)).not.toContain("OS");
  });

  it("detects emotion keywords", () => {
    const text = `
小光：（微笑）你來啦。
艾雅哭泣著走進來。
    `;
    const r = detectScriptEntities(text);
    const emotionNames = r.emotions.map(e => e.name);
    expect(emotionNames).toContain("微笑");
    expect(emotionNames).toContain("哭泣");
  });

  it("handles explicit 角色: XX declarations", () => {
    const text = `
角色：林夕
場景：天台
    `;
    const r = detectScriptEntities(text);
    expect(r.characters.map(c => c.name)).toContain("林夕");
    expect(r.scenes.map(s => s.name)).toContain("天台");
  });
});
