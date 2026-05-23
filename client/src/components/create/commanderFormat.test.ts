import { describe, expect, it } from "vitest";
import {
  ORCHESTRATION_MODE_OPTIONS,
  modeLabel,
  runStatusLabel,
  costPreviewLabel,
} from "./commanderFormat";

describe("commanderFormat", () => {
  it("exposes exactly the five orchestration modes (matches server enum)", () => {
    expect(ORCHESTRATION_MODE_OPTIONS.map(m => m.value)).toEqual([
      "create",
      "director",
      "video",
      "assets",
      "database",
    ]);
  });

  it("labels modes and falls back to the raw value", () => {
    expect(modeLabel("director")).toBe("導演");
    expect(modeLabel("unknown")).toBe("unknown");
  });

  it("labels run statuses with pending as the first-version state", () => {
    expect(runStatusLabel("pending")).toBe("已記錄（等待規劃）");
    expect(runStatusLabel("waiting_confirmation")).toBe("等待確認");
    expect(runStatusLabel("???")).toBe("???");
  });

  it("shows 'cost not estimated' until M1-B+ fills in a number", () => {
    expect(costPreviewLabel(null)).toBe("成本尚未估算");
    expect(costPreviewLabel(0.25)).toBe("預估 $0.2500");
  });
});
