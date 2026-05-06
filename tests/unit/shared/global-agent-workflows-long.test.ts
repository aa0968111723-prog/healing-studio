import { describe, expect, it } from "vitest";
import { buildLongVideoWorkflow } from "../../../shared/global-agent-workflows";

describe("buildLongVideoWorkflow chapter payloads", () => {
  it("includes director chapter JSON ingestion step", () => {
    const wf = buildLongVideoWorkflow("城市療癒紀錄", { chapters: 2 });
    const step = wf.steps.find(s => s.label.includes("接收章節 JSON"));
    expect(step).toBeTruthy();
    expect(step?.actionType).toBe("setParam");
    expect(step?.payload).toContain("chapterTitle");
    expect(step?.payload).toContain("videoPrompt");
  });

  it("uses chapter-derived fillPrompt payloads with fallback content", () => {
    const wf = buildLongVideoWorkflow("山林慢活", { chapters: 2 });
    const chapter2VideoFill = wf.steps.find(
      s => s.path === "/video-studio" && s.actionType === "fillPrompt" && s.label.includes("第 2 章")
    );

    expect(chapter2VideoFill?.label).toContain("來自導演章節");
    expect(chapter2VideoFill?.payload).toContain("{{chapter:2:videoPrompt|");
    expect(chapter2VideoFill?.payload).toContain("章節標題：第 2 章");
    expect(chapter2VideoFill?.payload).toContain("整體主題：山林慢活");
    expect(chapter2VideoFill?.payload).not.toBe("第 2 章運鏡（鏡頭移動、節奏、光感，與第 2 章主題對齊）：山林慢活");
  });
});
