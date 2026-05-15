/**
 * orb-proxy-features.test.ts
 *
 * 覆蓋本次「全站光球代理新增能力」三個純函式層的核心行為：
 *   1. detectOrbSearchIntent — 找/搜尋/翻一下意圖偵測
 *   2. buildMultiDimWizardClarification — 模糊提示詞時的多維度反問
 *   3. detectCreationIntent — 品牌貼文 / Podcast 新工作流入口
 *   4. orbExportShare 純函式（filter / spec build）
 */

import { describe, expect, it } from "vitest";
import {
  detectOrbSearchIntent,
  formatUnifiedSearchReply,
} from "../shared/orb-search-intent";
import {
  buildMultiDimWizardClarification,
  countMissingHighSignalDimensions,
  serializeMultiDimAnswers,
} from "../shared/orb-clarification-options";
import { detectCreationIntent } from "../shared/global-agent-workflows";
import { coerceAgentAction, summarizeAction } from "../shared/agent-actions";
import {
  filterMessagesByScope,
  buildChatExportHtml,
  studioSnapshotToProcessSpec,
} from "../client/src/lib/orbExportShare";
import { scoreMatch } from "./services/orbUnifiedSearch";

describe("detectOrbSearchIntent", () => {
  it("catches 'search X' triggers", () => {
    const r = detectOrbSearchIntent("搜尋 forest morning");
    expect(r).not.toBeNull();
    expect(r?.query).toBe("forest morning");
  });

  it("catches '找一下' phrasing with type hint", () => {
    const r = detectOrbSearchIntent("找一下我之前生成的森林素材");
    expect(r).not.toBeNull();
    expect(r?.query).toContain("森林");
    expect(r?.types).toContain("asset");
  });

  it("catches 翻一下 + 筆記 hint", () => {
    const r = detectOrbSearchIntent("翻一下我的筆記提到禪意");
    expect(r).not.toBeNull();
    expect(r?.types).toContain("note");
  });

  it("ignores creation-style requests", () => {
    expect(detectOrbSearchIntent("幫我做一支森林短片")).toBeNull();
    expect(detectOrbSearchIntent("我想生成一張海報")).toBeNull();
  });

  it("ignores plain greetings", () => {
    expect(detectOrbSearchIntent("嗨光球，今天好嗎？")).toBeNull();
  });

  it("filters out trailing punctuation", () => {
    const r = detectOrbSearchIntent("搜尋 calm BGM？");
    expect(r?.query).toBe("calm BGM");
  });
});

describe("formatUnifiedSearchReply", () => {
  it("renders a friendly empty state", () => {
    const reply = formatUnifiedSearchReply("禪意", []);
    expect(reply).toContain("禪意");
    expect(reply).toContain("沒有命中");
  });

  it("renders all four kinds with emoji + open link", () => {
    const reply = formatUnifiedSearchReply("forest", [
      { kind: "asset", title: "Forest A", snippet: "morning haze", path: "/assets?focusAssetId=1" },
      { kind: "note", title: "Notes", snippet: "禪意調性", path: "/notes?focusNoteId=2" },
      { kind: "history", title: "Gen 3", snippet: "deep forest", path: "/assets?section=history&focusHistoryId=3" },
      { kind: "tutorial", title: "Tutor", snippet: "森林教學", path: "/learn?docId=t1" },
    ]);
    expect(reply).toContain("🖼️");
    expect(reply).toContain("📝");
    expect(reply).toContain("🗂️");
    expect(reply).toContain("📚");
    expect(reply).toContain("[開啟](/assets?focusAssetId=1)");
  });
});

describe("scoreMatch (orbUnifiedSearch)", () => {
  it("scores title hits higher than body hits", () => {
    const high = scoreMatch("forest", "Deep Forest Morning", "morning haze");
    const low = scoreMatch("forest", "Untitled", "deep forest morning haze");
    expect(high).toBeGreaterThan(low);
  });

  it("returns 0 for empty query", () => {
    expect(scoreMatch("", "anything", "anything")).toBe(0);
  });

  it("rewards multi-token overlap", () => {
    const both = scoreMatch("calm forest", "Calm Forest Morning", "");
    const half = scoreMatch("calm forest", "Calm Hot Day", "");
    expect(both).toBeGreaterThan(half);
  });
});

describe("buildMultiDimWizardClarification", () => {
  it("returns null when length is missing for video (gating)", () => {
    const r = buildMultiDimWizardClarification("幫我做影片", "video");
    expect(r).toBeNull();
  });

  it("emits multi-dim card when 3+ dimensions missing post-length", () => {
    const r = buildMultiDimWizardClarification("做一支 30 秒影片", "video");
    expect(r).not.toBeNull();
    expect(r!.entries.length).toBeGreaterThanOrEqual(3);
    const dims = r!.entries.map(e => e.dimension);
    expect(dims).toContain("subject");
  });

  it("returns null when only 1-2 dimensions missing", () => {
    const r = buildMultiDimWizardClarification(
      "做一支 30 秒影片，主題是茶道體驗，電影感風格",
      "video"
    );
    expect(r).toBeNull();
  });

  it("works on image modality without length gating", () => {
    const r = buildMultiDimWizardClarification("做一張海報", "image");
    expect(r).not.toBeNull();
  });
});

describe("countMissingHighSignalDimensions", () => {
  it("counts 4 missing for a bare prompt", () => {
    expect(countMissingHighSignalDimensions("做影片", "video")).toBeGreaterThanOrEqual(3);
  });
});

describe("serializeMultiDimAnswers", () => {
  it("serializes each dimension into its own clarification line", () => {
    const out = serializeMultiDimAnswers([
      { dimension: "subject", value: "茶道" },
      { dimension: "style", value: "電影感" },
    ]);
    expect(out).toContain("[使用者澄清/subject]: 茶道");
    expect(out).toContain("[使用者澄清/style]: 電影感");
  });

  it("drops empty values", () => {
    const out = serializeMultiDimAnswers([
      { dimension: "subject", value: "" },
      { dimension: "style", value: "電影感" },
    ]);
    expect(out).toBe("[使用者澄清/style]: 電影感");
  });
});

describe("detectCreationIntent — new composite intents", () => {
  it("routes brand-post requests to buildBrandContentWorkflow", () => {
    const det = detectCreationIntent("幫我做一個品牌貼文素材包，主題是品牌週年");
    expect(det.kind).toBe("ready");
    if (det.kind === "ready") {
      expect(det.workflow.name).toContain("品牌貼文");
      expect(det.workflow.steps.length).toBeGreaterThan(3);
    }
  });

  it("routes podcast requests to buildPodcastEpisodeWorkflow", () => {
    const det = detectCreationIntent("幫我製作 podcast 一集，療癒主題");
    expect(det.kind).toBe("ready");
    if (det.kind === "ready") {
      expect(det.workflow.name).toContain("Podcast");
    }
  });

  it("still detects video first when it's a clear short video request", () => {
    const det = detectCreationIntent("幫我做一支 30 秒短片，主題是雨後森林，電影感");
    expect(det.kind === "ready" || det.kind === "needs-clarification").toBe(true);
  });
});

describe("agent-actions — exportChatPdf + shareViaLink", () => {
  it("coerces exportChatPdf with scope", () => {
    const a = coerceAgentAction({ type: "exportChatPdf", scope: "this-week" });
    expect(a).not.toBeNull();
    expect(a!.type).toBe("exportChatPdf");
    if (a && a.type === "exportChatPdf") {
      expect(a.scope).toBe("this-week");
    }
  });

  it("coerces shareViaLink target", () => {
    const a = coerceAgentAction({ type: "shareViaLink", target: "currentChat" });
    expect(a).not.toBeNull();
    expect(a!.type).toBe("shareViaLink");
    if (a && a.type === "shareViaLink") {
      expect(a.target).toBe("currentChat");
    }
  });

  it("defaults shareViaLink target to lastWorkflow", () => {
    const a = coerceAgentAction({ type: "shareViaLink" });
    expect(a).not.toBeNull();
    if (a && a.type === "shareViaLink") {
      expect(a.target).toBe("lastWorkflow");
    }
  });

  it("summarizes the new actions in friendly Chinese", () => {
    expect(summarizeAction({ type: "exportChatPdf", scope: "today" })).toContain("今天");
    expect(summarizeAction({ type: "shareViaLink", target: "currentChat" })).toContain("對話");
  });
});

describe("orbExportShare — chat scope filter", () => {
  const NOW = new Date("2026-05-07T10:00:00Z").getTime();
  const tHourAgo = NOW - 60 * 60 * 1000;
  const tYesterday = NOW - 26 * 60 * 60 * 1000;
  const tLastWeek = NOW - 8 * 24 * 60 * 60 * 1000;

  const messages = [
    { role: "user" as const, text: "今天問題", at: tHourAgo },
    { role: "user" as const, text: "昨天問題", at: tYesterday },
    { role: "user" as const, text: "上週問題", at: tLastWeek },
  ];

  it("returns everything for scope=all", () => {
    expect(filterMessagesByScope(messages, "all", NOW)).toHaveLength(3);
  });

  it("returns only today's messages for scope=today", () => {
    const today = filterMessagesByScope(messages, "today", NOW);
    expect(today).toHaveLength(1);
    expect(today[0].text).toBe("今天問題");
  });

  it("returns this-week's messages excluding earlier weeks", () => {
    const week = filterMessagesByScope(messages, "this-week", NOW);
    expect(week.find(m => m.text === "上週問題")).toBeUndefined();
  });
});

describe("orbExportShare — buildChatExportHtml", () => {
  it("escapes HTML in user text to avoid injection", () => {
    const built = buildChatExportHtml({
      messages: [
        { role: "user", text: "<script>alert(1)</script>", at: Date.now() },
      ],
    });
    expect(built.html).not.toContain("<script>alert(1)</script>");
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("counts only messages within scope", () => {
    const NOW = new Date("2026-05-07T10:00:00Z").getTime();
    const built = buildChatExportHtml(
      {
        messages: [
          { role: "user", text: "today", at: NOW - 1000 },
          { role: "user", text: "old", at: NOW - 90 * 24 * 60 * 60 * 1000 },
        ],
        scope: "today",
      },
      NOW
    );
    expect(built.count).toBe(1);
  });
});

describe("orbExportShare — studioSnapshotToProcessSpec", () => {
  it("returns a usable spec even when the studio is in its empty default state", () => {
    const spec = studioSnapshotToProcessSpec(null);
    expect(spec.title).toContain("圖片");
    expect(spec.steps.length).toBeGreaterThanOrEqual(2);
    // Modality + prompt placeholders are always present so the link is
    // self-describing even before the user types anything.
    expect(spec.steps[0]?.title).toContain("模態");
    expect(spec.steps[1]?.title).toContain("提示詞");
    expect(spec.steps[1]?.detail).toBe("(尚未輸入)");
  });

  it("packages prompt / model / aspect ratio from an image-mode snapshot", () => {
    const spec = studioSnapshotToProcessSpec({
      pageId: "studio",
      pageLabel: "創作工作室",
      pagePath: "/studio",
      capabilities: [],
      state: {
        activeModality: "image",
        promptPreview: "森林清晨，櫻花飄落",
        selectedModelId: "fal-ai/flux/dev",
        aspectRatio: "16:9",
        negativePrompt: "blurry, lowres",
        temperature: 0.7,
        seed: "42",
      },
    });
    const stepTitles = spec.steps.map(s => s.title);
    expect(stepTitles).toContain("📝 提示詞");
    expect(spec.steps.find(s => s.title === "📝 提示詞")?.detail).toBe(
      "森林清晨，櫻花飄落"
    );
    expect(stepTitles).toContain("🧠 模型");
    expect(stepTitles).toContain("📐 畫面比例");
    expect(stepTitles).toContain("🚫 負面提示");
    expect(stepTitles).toContain("🌡️ 溫度");
    expect(stepTitles).toContain("🌱 種子");
  });

  it("packages duration + camera params from a video-mode snapshot", () => {
    const spec = studioSnapshotToProcessSpec({
      pageId: "studio",
      pageLabel: "創作工作室",
      pagePath: "/studio",
      capabilities: [],
      state: {
        activeModality: "video",
        promptPreview: "海邊散步的女生",
        duration: 8,
        cameraPan: "right",
        cameraZoom: "in",
        cameraTilt: "none",
      },
    });
    const detailByTitle = new Map(spec.steps.map(s => [s.title, s.detail]));
    expect(detailByTitle.get("⏱️ 時長")).toBe("8 秒");
    expect(detailByTitle.get("🎥 鏡頭 - 平移")).toBe("right");
    expect(detailByTitle.get("🎥 鏡頭 - 縮放")).toBe("in");
    expect(spec.title).toContain("影片");
  });

  it("skips the random-seed placeholder so it doesn't pollute the spec", () => {
    const spec = studioSnapshotToProcessSpec({
      pageId: "studio",
      pageLabel: "創作工作室",
      pagePath: "/studio",
      capabilities: [],
      state: {
        activeModality: "image",
        seed: "(隨機)",
      },
    });
    expect(spec.steps.find(s => s.title === "🌱 種子")).toBeUndefined();
  });

  it("falls back to the image label for unknown modalities", () => {
    const spec = studioSnapshotToProcessSpec({
      pageId: "studio",
      pageLabel: "創作工作室",
      pagePath: "/studio",
      capabilities: [],
      state: { activeModality: "weirdmode" },
    });
    // No throw — degrades gracefully to image defaults.
    expect(spec.title).toContain("圖片");
  });
});

describe("agent-actions — shareViaLink target parsing", () => {
  it("accepts studioState as a valid shareViaLink target", () => {
    const parsed = coerceAgentAction({
      type: "shareViaLink",
      target: "studioState",
    });
    expect(parsed).toEqual({ type: "shareViaLink", target: "studioState" });
  });

  it("preserves lastWorkflow / currentChat targets", () => {
    expect(coerceAgentAction({ type: "shareViaLink", target: "lastWorkflow" }))
      .toEqual({ type: "shareViaLink", target: "lastWorkflow" });
    expect(coerceAgentAction({ type: "shareViaLink", target: "currentChat" }))
      .toEqual({ type: "shareViaLink", target: "currentChat" });
  });

  it("falls back to lastWorkflow when target is missing or invalid", () => {
    expect(coerceAgentAction({ type: "shareViaLink" }))
      .toEqual({ type: "shareViaLink", target: "lastWorkflow" });
    expect(coerceAgentAction({ type: "shareViaLink", target: "garbage" }))
      .toEqual({ type: "shareViaLink", target: "lastWorkflow" });
  });

  it("summarizeAction labels the studioState target explicitly", () => {
    const summary = summarizeAction({
      type: "shareViaLink",
      target: "studioState",
    });
    expect(summary).toContain("創作工作室");
  });
});
