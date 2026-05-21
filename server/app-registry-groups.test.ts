import { describe, it, expect } from "vitest";
import { SIDEBAR_GROUPS } from "../shared/appRegistry";

describe("app registry sidebar groups", () => {
  it("matches phase-one skeleton groups", () => {
    expect(SIDEBAR_GROUPS.map(g => g.label)).toEqual([
      "創作中樞",
      "六大系統",
      "模型樂園",
      "管理",
    ]);
  });
});
