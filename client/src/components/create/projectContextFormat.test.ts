import { describe, expect, it } from "vitest";
import {
  PROJECT_STATUS_LABELS,
  assetTypeLabel,
  pendingSectionLabels,
  formatUpdatedAt,
  NO_ACTIVE_PROJECT_HINT,
} from "./projectContextFormat";

describe("projectContextFormat", () => {
  it("maps every project status to a Chinese label", () => {
    expect(PROJECT_STATUS_LABELS.concept).toBe("概念中");
    expect(PROJECT_STATUS_LABELS.production).toBe("製作中");
    expect(PROJECT_STATUS_LABELS.review).toBe("審查中");
    expect(PROJECT_STATUS_LABELS.complete).toBe("完成");
  });

  it("labels known asset types and falls back to the raw value", () => {
    expect(assetTypeLabel("image")).toBe("圖片");
    expect(assetTypeLabel("voice")).toBe("配音");
    expect(assetTypeLabel("something-new")).toBe("something-new");
  });

  it("maps pending sections to readable labels and keeps unknown keys", () => {
    const rows = pendingSectionLabels(["teamData", "budget", "mystery"]);
    expect(rows).toEqual([
      { key: "teamData", label: "團隊資料摘要" },
      { key: "budget", label: "成本預算" },
      { key: "mystery", label: "mystery" },
    ]);
  });

  it("formats ISO timestamps and degrades gracefully", () => {
    expect(formatUpdatedAt(null)).toBe("—");
    expect(formatUpdatedAt("not-a-date")).toBe("not-a-date");
    // A valid ISO string should produce a non-empty, different rendering.
    const rendered = formatUpdatedAt("2026-05-20T08:30:00.000Z");
    expect(rendered).not.toBe("—");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("provides a non-blocking empty-state hint", () => {
    expect(NO_ACTIVE_PROJECT_HINT).toContain("仍然可以直接開始創作");
  });
});
