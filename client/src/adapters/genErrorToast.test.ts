// ============================================================================
// genErrorToast.test.ts — isCostBlockedError 判斷契約（AIDV-160 雙 toast 修補）
// ----------------------------------------------------------------------------
// 鎖住「哪些錯誤該抑制第二個通用 toast」的單一真相源邏輯：
//   1. AdapterCostBlockedError 實例 → true（caller 據此 early return、不再 fire 失敗 toast）。
//   2. 只有相同 name（跨 bundle/HMR、instanceof 失準）→ 仍 true（保險層）。
//   3. 一般硬失敗（AdapterError / 普通 Error / 非 Error）→ false（通用『生成失敗』照常）。
// ============================================================================
import { describe, it, expect } from "vitest";
import { isCostBlockedError } from "./genErrorToast";
import { AdapterCostBlockedError, AdapterError } from "./types";

describe("isCostBlockedError", () => {
  it("AdapterCostBlockedError 實例 → true", () => {
    const err = new AdapterCostBlockedError("免費引擎暫時無法使用", { seam: "generation", provider: "mock" });
    expect(isCostBlockedError(err)).toBe(true);
  });

  it("跨 bundle：只有 name 相同（instanceof 失準）→ 仍 true（保險層）", () => {
    const err = new Error("免費引擎暫時無法使用");
    err.name = "AdapterCostBlockedError";
    expect(isCostBlockedError(err)).toBe(true);
  });

  it("一般 AdapterError（硬失敗）→ false（通用失敗 toast 照常）", () => {
    const err = new AdapterError("全部 provider 皆失敗", { seam: "generation" });
    expect(isCostBlockedError(err)).toBe(false);
  });

  it("普通 Error / 非 Error → false", () => {
    expect(isCostBlockedError(new Error("boom"))).toBe(false);
    expect(isCostBlockedError("免費引擎暫時無法使用")).toBe(false);
    expect(isCostBlockedError(null)).toBe(false);
    expect(isCostBlockedError(undefined)).toBe(false);
  });
});
