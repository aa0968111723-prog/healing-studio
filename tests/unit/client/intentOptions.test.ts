import { describe, expect, it } from "vitest";
import {
  hasIntentOptions,
  parseIntentSegments,
} from "../../../client/src/lib/intentOptions";

describe("parseIntentSegments", () => {
  it("returns the original text when no option blocks are present", () => {
    const segs = parseIntentSegments("普通的對話文字，沒有任何選項。");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      kind: "text",
      value: "普通的對話文字，沒有任何選項。",
    });
  });

  it("groups consecutive option blocks (with → descriptions)", () => {
    const text = [
      "我想確認一下你目前真正想做的是什麼：",
      "",
      "**選項 A：繼續風景圖創作**",
      "→ 我已經推薦好 Nano Banana Pro 了，現在直接生成就行",
      "",
      "**選項 B：先用導演 AI 規劃腳本**",
      "→ 把「療癒風景」的想法擴展成完整的分鏡需求",
      "",
      "**選項 C：深入了解提示詞技巧**",
      "→ 讀學習文件，優化你的提示詞寫法",
      "",
      "哪一個最符合你現在的心情呢？✨",
    ].join("\n");

    const segs = parseIntentSegments(text);
    const optionsSeg = segs.find(s => s.kind === "options");
    expect(optionsSeg && optionsSeg.kind === "options").toBe(true);
    if (optionsSeg && optionsSeg.kind === "options") {
      expect(optionsSeg.options).toHaveLength(3);
      expect(optionsSeg.options[0]).toMatchObject({
        key: "A",
        title: "繼續風景圖創作",
        description: "我已經推薦好 Nano Banana Pro 了，現在直接生成就行",
        pickText: "選項 A：繼續風景圖創作",
      });
      expect(optionsSeg.options[2].key).toBe("C");
    }
    // Trailing prompt remains as a text segment.
    const lastText = segs[segs.length - 1];
    expect(lastText.kind).toBe("text");
    expect((lastText as { value: string }).value).toContain("哪一個最符合");
  });

  it("does not match plain bold text without a key+separator", () => {
    expect(hasIntentOptions("**普通粗體標題**")).toBe(false);
  });

  it("captures options even without an arrow description", () => {
    const segs = parseIntentSegments(
      "**選項 1：直接出圖**\n**選項 2：再修一次**"
    );
    const opts = segs.find(s => s.kind === "options");
    expect(opts && opts.kind === "options").toBe(true);
    if (opts && opts.kind === "options") {
      expect(opts.options.map(o => o.key)).toEqual(["1", "2"]);
    }
  });
});
