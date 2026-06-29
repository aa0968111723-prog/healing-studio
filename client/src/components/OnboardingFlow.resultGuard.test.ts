/**
 * isUsableResultUrl — AIDV-637
 * 守門純函式：判斷生成回呼的 resultUrl 是否真有作品可展示。
 * 驗收：空字串 / 純空白 / null / undefined / 非字串 一律不可用（不得進慶祝態）。
 */
import { describe, it, expect } from "vitest";
import { isUsableResultUrl } from "./OnboardingFlow";

describe("isUsableResultUrl (AIDV-637)", () => {
  it("有效 http(s) URL → 可用", () => {
    expect(isUsableResultUrl("https://cdn.example/a.png")).toBe(true);
    expect(isUsableResultUrl("/local/relative/path.png")).toBe(true);
    expect(isUsableResultUrl("data:image/png;base64,AAAA")).toBe(true);
  });

  it("空字串 / 純空白 → 不可用（核心 bug 場景）", () => {
    expect(isUsableResultUrl("")).toBe(false);
    expect(isUsableResultUrl("   ")).toBe(false);
    expect(isUsableResultUrl("\t\n ")).toBe(false);
  });

  it("null / undefined → 不可用", () => {
    expect(isUsableResultUrl(null)).toBe(false);
    expect(isUsableResultUrl(undefined)).toBe(false);
  });

  it("非字串型別 → 不可用", () => {
    expect(isUsableResultUrl(0 as unknown)).toBe(false);
    expect(isUsableResultUrl(123 as unknown)).toBe(false);
    expect(isUsableResultUrl({} as unknown)).toBe(false);
    expect(isUsableResultUrl([] as unknown)).toBe(false);
    expect(isUsableResultUrl(true as unknown)).toBe(false);
  });
});
