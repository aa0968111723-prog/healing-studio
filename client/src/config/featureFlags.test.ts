// @vitest-environment jsdom
/**
 * readRuntimeToggle（執行期旗標切換）行為測試。
 * 守住 localStorage 持久路徑（URL 參數路徑於真站由 window.location.search 觸發）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readRuntimeToggle } from "./featureFlags";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* 某些 jsdom 環境 localStorage 不可用 */ }
});

describe("readRuntimeToggle（執行期旗標切換）", () => {
  it("未設定 → false", () => {
    expect(readRuntimeToggle("aidvchrome")).toBe(false);
  });

  it("localStorage flag:aidvchrome=1 → true", () => {
    localStorage.setItem("flag:aidvchrome", "1");
    expect(readRuntimeToggle("aidvchrome")).toBe(true);
  });

  it("localStorage flag:aidvchrome=0 → false（可關）", () => {
    localStorage.setItem("flag:aidvchrome", "0");
    expect(readRuntimeToggle("aidvchrome")).toBe(false);
  });
});
