import { describe, it, expect } from "vitest";
import { SIDEBAR_GROUPS } from "./appRegistry";

describe("appRegistry sidebar grouping", () => {
  it("contains new grouped buckets", () => {
    const labels = SIDEBAR_GROUPS.map(g => g.label);
    expect(labels).toEqual(expect.arrayContaining(["開始", "創作", "素材", "管理"]));
  });
});
