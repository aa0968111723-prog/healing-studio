import { describe, it, expect } from "vitest";
import { generateExport } from "./exportFormats";
import type { ScriptSegment } from "../../../shared/types";

/**
 * 端到端接線測試（AIDV-562）：證明 generateExport 的 CSV 輸出真的把使用者/AI 可控的
 * 分鏡欄位（對白、視覺描述）做了公式注入中和，而非只有 shared/csv-safe 單元層綠。
 */
describe("generateExport(csv) — 公式注入中和接線（AIDV-562）", () => {
  const malicious = [
    {
      index: 0,
      rawText: "raw",
      status: "ready",
      storyboard: {
        sceneHeading: "場景一",
        visualDescription: "=HYPERLINK(\"http://evil\",\"x\")",
        dialogue: "=cmd|'/c calc'!A1",
        soundDesign: "+1+1",
        cameraDirection: "正常",
        duration: "3s",
        mood: "calm",
      },
    },
  ] as unknown as ScriptSegment[];

  it("惡意對白/視覺描述以撇號中和，不以公式字元起頭", () => {
    const csv = generateExport(malicious, "csv", {});
    const dataLine = csv.split("\n").find(l => l.includes("calc")) ?? "";
    // 對白格被中和為 '=cmd...（前置撇號）且因含逗號/引號整格引號包裹
    expect(dataLine).toContain("'=cmd");
    expect(dataLine).toContain("'=HYPERLINK");
    expect(dataLine).toContain("'+1+1");
    // 不應存在「未中和、以 = 直接起頭」的儲存格
    expect(csv).not.toMatch(/(^|,)=cmd/m);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
