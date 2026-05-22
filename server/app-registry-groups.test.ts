import { describe, it, expect } from "vitest";
import { SIDEBAR_GROUPS } from "../shared/appRegistry";

describe("app registry sidebar groups", () => {
  it("matches the slim sidebar (only film-director group remains)", () => {
    expect(SIDEBAR_GROUPS.map(g => g.label)).toEqual(["影片世界觀+導演ai"]);
  });
});
