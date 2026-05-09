/**
 * orb-guide-plans.test.ts — Phase 3e 到站接棒的純邏輯測試
 *
 * `buildOrbGuideActions` 把 intent + answers + promptHint 翻成 AgentAction[]，
 * OrbGuide confirmAndNavigate 會把結果丟進 CustomEvent，ProactiveOrbWidget
 * listener 再把它 dispatchMany 進 PageAgent bus。這裡把每個 intent 的計畫
 * 鎖住，以後加新 intent 或改 tabId 都能第一時間發現。
 */

import { describe, expect, it } from "vitest";
import {
  buildOrbGuideActions,
  summarizeOrbGuideActions,
} from "../shared/orb-guide-plans";

describe("buildOrbGuideActions", () => {
  it("image → setTab('t2i') + fillPrompt(hint)（hint 非空時）", () => {
    const a = buildOrbGuideActions({
      intent: "image",
      answers: { style: "photorealistic", mood: "calm healing" },
      promptHint: "calm healing photorealistic style, high quality, detailed",
    });
    expect(a).toEqual([
      { type: "setTab", tabId: "t2i" },
      {
        type: "fillPrompt",
        text: "calm healing photorealistic style, high quality, detailed",
      },
    ]);
  });

  it("image hint 為空只回 setTab，不會吐空 fillPrompt", () => {
    const a = buildOrbGuideActions({
      intent: "image",
      answers: {},
      promptHint: "",
    });
    expect(a).toEqual([{ type: "setTab", tabId: "t2i" }]);
  });

  it("video → setTab('t2v') + fillPrompt", () => {
    const a = buildOrbGuideActions({
      intent: "video",
      answers: { length: "5s", type: "nature landscape" },
      promptHint: "cinematic nature landscape video",
    });
    expect(a).toEqual([
      { type: "setTab", tabId: "t2v" },
      { type: "fillPrompt", text: "cinematic nature landscape video" },
    ]);
  });

  it("music → ProStudio 的 music tab + fillPrompt", () => {
    const a = buildOrbGuideActions({
      intent: "music",
      answers: { genre: "healing", mood: "relaxing calm peaceful" },
      promptHint: "healing ambient, relaxing calm, no vocals",
    });
    expect(a[0]).toEqual({ type: "setTab", tabId: "music" });
    expect(a[1]?.type).toBe("fillPrompt");
  });

  it("voice type=clone → setTab('clone')", () => {
    const a = buildOrbGuideActions({
      intent: "voice",
      answers: { type: "clone" },
      promptHint: "",
    });
    expect(a).toEqual([{ type: "setTab", tabId: "clone" }]);
  });

  it("voice type=tts / multilingual / emotional 都走 tts tab", () => {
    for (const t of ["tts", "multilingual", "emotional"]) {
      const a = buildOrbGuideActions({
        intent: "voice",
        answers: { type: t },
        promptHint: "",
      });
      expect(a).toEqual([{ type: "setTab", tabId: "tts" }]);
    }
  });

  it("script → 只 fillPrompt（Director 沒已知 tabId）", () => {
    const a = buildOrbGuideActions({
      intent: "script",
      answers: { format: "short video script", length: "30 seconds short" },
      promptHint: "Create a short video script ...",
    });
    expect(a).toEqual([
      { type: "fillPrompt", text: "Create a short video script ..." },
    ]);
  });

  it("script hint 為空 → 回空陣列（不自動做任何事）", () => {
    const a = buildOrbGuideActions({
      intent: "script",
      answers: {},
      promptHint: "",
    });
    expect(a).toEqual([]);
  });

  it("lora / explore → 不自動做事，回空陣列", () => {
    expect(
      buildOrbGuideActions({
        intent: "lora",
        answers: { type: "face portrait" },
        promptHint: "",
      })
    ).toEqual([]);
    expect(
      buildOrbGuideActions({
        intent: "explore",
        answers: { feeling: "relax" },
        promptHint: "",
      })
    ).toEqual([]);
  });

  it("promptHint 前後空白會被 trim", () => {
    const a = buildOrbGuideActions({
      intent: "image",
      answers: {},
      promptHint: "   realistic, detailed   ",
    });
    expect(a).toContainEqual({
      type: "fillPrompt",
      text: "realistic, detailed",
    });
  });

  it("setTab 會排在 fillPrompt 之前，保持頁面切換後才填字的動畫節奏", () => {
    const a = buildOrbGuideActions({
      intent: "image",
      answers: {},
      promptHint: "x",
    });
    const tabIdx = a.findIndex(x => x.type === "setTab");
    const fillIdx = a.findIndex(x => x.type === "fillPrompt");
    expect(tabIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThan(tabIdx);
  });
});

describe("summarizeOrbGuideActions", () => {
  it("setTab / fillPrompt 有人話摘要", () => {
    const lines = summarizeOrbGuideActions([
      { type: "setTab", tabId: "t2i" },
      { type: "fillPrompt", text: "a quiet afternoon, soft light" },
    ]);
    expect(lines).toEqual([
      "切到「t2i」分頁",
      '填入提示詞：「a quiet afternoon, soft light」',
    ]);
  });

  it("fillPrompt 太長會被截到 36 字 + 省略號", () => {
    const long = "a".repeat(100);
    const [line] = summarizeOrbGuideActions([
      { type: "fillPrompt", text: long },
    ]);
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(long.length + 10);
  });

  it("其它 action type 不會炸；回通用句", () => {
    const lines = summarizeOrbGuideActions([
      { type: "submit" },
      { type: "reset" },
    ]);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toContain("執行 ");
  });

  it("空陣列 → 空陣列", () => {
    expect(summarizeOrbGuideActions([])).toEqual([]);
  });

  it("skipNavigateToPath 會把抵達目標頁的 navigate 過濾掉", () => {
    const lines = summarizeOrbGuideActions(
      [
        { type: "navigate", path: "/director" },
        { type: "setTab", tabId: "script" },
      ],
      { skipNavigateToPath: "/director" }
    );
    expect(lines).toEqual(["切到「script」分頁"]);
  });

  it("skipNavigateToPath 不會誤殺其他 path 的 navigate", () => {
    const lines = summarizeOrbGuideActions(
      [
        { type: "navigate", path: "/director" },
        { type: "navigate", path: "/assets" },
      ],
      { skipNavigateToPath: "/director" }
    );
    expect(lines).toEqual(["前往「/assets」"]);
  });

  it("pageLabelByPath 把 navigate 的 path 替換成人話 label", () => {
    const lines = summarizeOrbGuideActions(
      [{ type: "navigate", path: "/director" }],
      {
        pageLabelByPath: path => (path === "/director" ? "導演 AI" : undefined),
      }
    );
    expect(lines).toEqual(["前往「導演 AI」"]);
  });

  it("pageLabelByPath 沒解析到就退回原 path，不會吐 undefined", () => {
    const lines = summarizeOrbGuideActions(
      [{ type: "navigate", path: "/unknown" }],
      { pageLabelByPath: () => undefined }
    );
    expect(lines).toEqual(["前往「/unknown」"]);
  });

  it("skipDuplicateNavigates 把相同 path 的多次 navigate 摺成一條", () => {
    const lines = summarizeOrbGuideActions(
      [
        { type: "navigate", path: "/director" },
        { type: "setTab", tabId: "script" },
        { type: "navigate", path: "/director" },
      ],
      { skipDuplicateNavigates: true }
    );
    expect(lines).toEqual(["前往「/director」", "切到「script」分頁"]);
  });
});
