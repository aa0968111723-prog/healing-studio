import { describe, expect, it } from "vitest";
import { validatePromptBeforeSubmit } from "../../../../client/src/pages/ProStudio";

describe("validatePromptBeforeSubmit", () => {
  it("rejects too-short prompt", () => {
    const result = validatePromptBeforeSubmit("music", { prompt: "太短" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("提示詞太短");
    }
  });

  it("rejects missing required tab fields", () => {
    const result = validatePromptBeforeSubmit("tts", {
      text: "這是一段需要朗讀的內容，語氣要溫暖且有節奏。\n第二段延續內容。",
      voiceId: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("缺少聲線");
    }
  });

  it("passes when prompt validation is complete", () => {
    const result = validatePromptBeforeSubmit("music", {
      prompt: "為睡前冥想影片製作 ambient 風格配樂，節奏 60bpm，情緒平靜放鬆，作為背景用途。",
      tags: "ambient, 60bpm, calm",
    });
    expect(result).toEqual({ ok: true });
  });
});
