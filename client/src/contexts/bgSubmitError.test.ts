// ============================================================================
// bgSubmitError.test.ts — describeBgSubmitError 正規化契約（AIDV-560）
// ----------------------------------------------------------------------------
// 鎖住「submitTask catch 到的任意錯誤 → 友善固定標題 + 可選技術細節」的單一
// 真相源邏輯。純函式（不依賴 jsdom/React），窮舉各種錯誤形態：
//   Error / 空白 Error / tRPC 風格 Error / 非空白字串 / 空白字串 / null /
//   undefined / 數字 / 物件。標題永遠是友善固定詞；技術細節只在取得到時才帶。
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  describeBgSubmitError,
  BG_SUBMIT_ERROR_TITLE,
} from "./bgSubmitError";

describe("describeBgSubmitError", () => {
  it("Error → 友善標題 + message 當 description", () => {
    const out = describeBgSubmitError(new Error("連線逾時"));
    expect(out).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
      description: "連線逾時",
    });
  });

  it("tRPC 風格 Error（長技術訊息）→ 細節進 description，標題仍友善", () => {
    const out = describeBgSubmitError(
      new Error("UNAUTHORIZED: missing session token"),
    );
    expect(out.title).toBe(BG_SUBMIT_ERROR_TITLE);
    expect(out.description).toBe("UNAUTHORIZED: missing session token");
  });

  it("message 為空白的 Error → 只回友善標題（無 description）", () => {
    const out = describeBgSubmitError(new Error("   "));
    expect(out).toEqual({ title: BG_SUBMIT_ERROR_TITLE });
    expect(out.description).toBeUndefined();
  });

  it("message 為空字串的 Error → 只回友善標題", () => {
    expect(describeBgSubmitError(new Error(""))).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
    });
  });

  it("Error 的前後空白會被 trim", () => {
    expect(describeBgSubmitError(new Error("  伺服器錯誤  ")).description).toBe(
      "伺服器錯誤",
    );
  });

  it("子類別 Error（instanceof Error）一樣走 Error 分支", () => {
    class TRPCClientError extends Error {}
    const out = describeBgSubmitError(new TRPCClientError("BAD_REQUEST"));
    expect(out).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
      description: "BAD_REQUEST",
    });
  });

  it("非空白字串 → 當作 description", () => {
    expect(describeBgSubmitError("rate limited")).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
      description: "rate limited",
    });
  });

  it("空白字串 → 只回友善標題", () => {
    expect(describeBgSubmitError("   ")).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
    });
  });

  it("null / undefined → 只回友善標題（無 description）", () => {
    expect(describeBgSubmitError(null)).toEqual({ title: BG_SUBMIT_ERROR_TITLE });
    expect(describeBgSubmitError(undefined)).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
    });
  });

  it("數字 / 物件等未知型別 → 只回友善標題", () => {
    expect(describeBgSubmitError(500)).toEqual({ title: BG_SUBMIT_ERROR_TITLE });
    expect(describeBgSubmitError({ code: "X" })).toEqual({
      title: BG_SUBMIT_ERROR_TITLE,
    });
    expect(describeBgSubmitError([])).toEqual({ title: BG_SUBMIT_ERROR_TITLE });
  });

  it("標題常數為對非技術創作者友善的固定中文詞", () => {
    expect(BG_SUBMIT_ERROR_TITLE).toBe("背景任務送出失敗");
  });
});
