import { describe, expect, it } from "vitest";
import {
  modeLabel,
  runStatusLabel,
  costPreviewLabel,
  summarizeOpenTasks,
} from "@/components/create/commanderFormat";

describe("commanderFormat — label helpers", () => {
  it("maps known modes and falls back to the raw value", () => {
    expect(modeLabel("director")).toBe("導演");
    expect(modeLabel("video")).toBe("影片");
    expect(modeLabel("unknown-mode")).toBe("unknown-mode");
  });

  it("maps known run statuses and falls back to the raw value", () => {
    expect(runStatusLabel("pending")).toBe("已記錄（等待規劃）");
    expect(runStatusLabel("running")).toBe("執行中");
    expect(runStatusLabel("???")).toBe("???");
  });

  it("formats cost preview, including the not-yet-estimated case", () => {
    expect(costPreviewLabel(null)).toBe("成本尚未估算");
    expect(costPreviewLabel(0.25)).toBe("預估 $0.2500");
  });
});

describe("commanderFormat — summarizeOpenTasks", () => {
  it("returns a zero summary when there are no open tasks", () => {
    expect(summarizeOpenTasks([])).toEqual({
      count: 0,
      headline: "尚無待辦意圖",
    });
  });

  it("counts tasks and surfaces the latest (first) status", () => {
    const result = summarizeOpenTasks([
      { status: "running" },
      { status: "pending" },
      { status: "failed" },
    ]);
    expect(result.count).toBe(3);
    expect(result.headline).toBe("3 個未完成意圖 · 最新：執行中");
  });
});
