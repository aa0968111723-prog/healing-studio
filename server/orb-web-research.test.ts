/**
 * orb-web-research.test.ts
 *
 * Verifies the lightweight orb web-research trigger / prompt-block formatter.
 *
 * The actual `webSearch` is intentionally NOT mocked here — we only test
 * the pure classification + formatter pieces, plus that runOrbWebResearch
 * short-circuits cleanly when the trigger says no.
 */

import { describe, expect, it, vi } from "vitest";
import {
  classifyOrbResearchIntent,
  formatResearchPromptBlock,
  runOrbWebResearch,
} from "../server/services/orbWebResearch";
import type { WebResearchResult } from "../server/services/brainAutoRepair";

describe("classifyOrbResearchIntent", () => {
  it("triggers on Chinese how-to phrasing", () => {
    expect(classifyOrbResearchIntent("製茶過程是什麼？").shouldSearch).toBe(true);
    expect(classifyOrbResearchIntent("如何製作手工餅乾").shouldSearch).toBe(true);
    expect(classifyOrbResearchIntent("烏龍茶的歷史").shouldSearch).toBe(true);
    expect(classifyOrbResearchIntent("怎麼做提拉米蘇").shouldSearch).toBe(true);
  });

  it("triggers on English how-to phrasing", () => {
    expect(classifyOrbResearchIntent("how to brew matcha").shouldSearch).toBe(true);
    expect(classifyOrbResearchIntent("step by step guide for sourdough").shouldSearch).toBe(true);
    expect(classifyOrbResearchIntent("what is reinforcement learning?").shouldSearch).toBe(true);
  });

  it("does NOT trigger on in-app intent even when how-to words appear", () => {
    expect(classifyOrbResearchIntent("帶我去圖片工作室教學頁").shouldSearch).toBe(false);
    expect(classifyOrbResearchIntent("幫我生成步驟教學").shouldSearch).toBe(false);
    expect(classifyOrbResearchIntent("打開影片工作室").shouldSearch).toBe(false);
  });

  it("does NOT trigger on empty / whitespace input", () => {
    expect(classifyOrbResearchIntent("").reason).toBe("skipped:empty");
    expect(classifyOrbResearchIntent("    ").reason).toBe("skipped:empty");
  });

  it("does NOT trigger on overly long messages (likely a prompt to act on)", () => {
    const longText = "如何".concat("a".repeat(400));
    const result = classifyOrbResearchIntent(longText);
    expect(result.shouldSearch).toBe(false);
    expect(result.reason).toBe("skipped:too_long");
  });

  it("does NOT trigger on plain greetings or chat", () => {
    expect(classifyOrbResearchIntent("你好").shouldSearch).toBe(false);
    expect(classifyOrbResearchIntent("我今天心情不好").shouldSearch).toBe(false);
  });
});

describe("formatResearchPromptBlock", () => {
  it("returns empty string when no results", () => {
    expect(formatResearchPromptBlock([])).toBe("");
  });

  it("formats a numbered list with title, summary, url and citation guidance", () => {
    const results: WebResearchResult[] = [
      {
        id: "r1",
        query: "tea process",
        source: "Brave Search",
        title: "Traditional Tea Making",
        summary: "Six core steps from picking leaves to drying.",
        url: "https://example.com/tea",
        relevance: 80,
        addedToLearnHub: false,
        createdAt: 1,
      },
      {
        id: "r2",
        query: "tea process",
        source: "Brave Search",
        title: "Oolong Tea History",
        summary: "Long origin story    with messy   whitespace",
        url: "https://example.com/oolong",
        relevance: 60,
        addedToLearnHub: false,
        createdAt: 2,
      },
    ];
    const block = formatResearchPromptBlock(results);
    expect(block).toContain("【網路研究");
    expect(block).toContain("1. Traditional Tea Making");
    expect(block).toContain("https://example.com/tea");
    expect(block).toContain("2. Oolong Tea History");
    expect(block).toContain("Long origin story with messy whitespace");
    expect(block).toContain("/process?spec=");
  });
});

describe("runOrbWebResearch short-circuits", () => {
  it("returns null block when disabled flag is set", async () => {
    const out = await runOrbWebResearch("製茶過程", { enabled: false });
    expect(out.promptBlock).toBeNull();
    expect(out.reason).toBe("skipped:disabled");
  });

  it("returns null block for in-app intent without hitting the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await runOrbWebResearch("帶我去圖片工作室", {});
    expect(out.promptBlock).toBeNull();
    expect(out.reason).toBe("skipped:in_app_intent");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns null block for plain chat without hitting the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await runOrbWebResearch("hi 我想聊天", {});
    expect(out.promptBlock).toBeNull();
    expect(out.reason).toBe("skipped:no_pattern");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
