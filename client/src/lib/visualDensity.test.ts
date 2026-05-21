import { describe, it, expect, beforeEach } from "vitest";
import { getVisualDensity, setVisualDensity, shouldShowAdvanced, shouldShowDiagnostics } from "./visualDensity";

describe("visualDensity", () => {
  beforeEach(() => localStorage.clear());
  it("reads and writes", () => {
    expect(getVisualDensity()).toBe("standard");
    setVisualDensity("beginner");
    expect(getVisualDensity()).toBe("beginner");
  });
  it("helper flags", () => {
    expect(shouldShowAdvanced("beginner")).toBe(false);
    expect(shouldShowDiagnostics("professional")).toBe(true);
  });
});
