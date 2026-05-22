import { describe, it, expect } from "vitest";
import { SIDEBAR_GROUPS } from "../shared/appRegistry";

describe("app registry sidebar groups", () => {
  it("registers no sidebar groups (everything renders as a standalone leaf)", () => {
    expect(SIDEBAR_GROUPS).toEqual([]);
  });
});
