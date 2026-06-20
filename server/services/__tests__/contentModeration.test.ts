/**
 * contentModeration.test.ts — AIDV-65 內容審核 fail-closed 旗標測試矩陣
 *
 * ⚠️ 方向：fail-closed 是**預設**（safety > availability）。本檔驗證：
 *  (a) 旗標 helper isContentSafetyFailClosed：
 *      - 未設／留空 → ON（**預設 fail-closed**）
 *      - 真值集合（true/1/on/yes，含大小寫/空白）→ ON
 *      - 明確關閉值（false/0/off/no，含大小寫/空白）→ OFF（緊急回退）
 *      - 其他隨意字串 → ON（預設，安全優先；非「明確關閉」就不回退）
 *  (b) resolveSafetyFallback（checkSafety 逾時/錯誤/無法解析 fallback）：
 *      - 預設 ON → fail-closed（{ safe:false, reason } 帶清楚原因）
 *      - 明確回退 OFF → fail-open（{ safe:true }，無 reason）
 *  (c) resolveFalSafetyChecker（fal enable_safety_checker gate）：
 *      - 預設 ON → 一律 true（開回供應商端安檢）
 *      - 明確回退 OFF → 維持現行值（false/true 原樣回傳）
 *  (d) 不誤擋／不退化：ON 時對「已開（true）」仍回 true。
 *
 * serverEnv 是 import-time 計算的 singleton（process.env 後續變動不會反映），故本檔
 * 以 vi.mock + vi.hoisted 提供可變的 env.validated mock，逐案改 CONTENT_SAFETY_FAIL_CLOSED。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.validated mock：vi.mock 工廠被提升到檔頭，故用 vi.hoisted 建可變物件。
// 預設 "true"（ON＝fail-closed，與 schema default 一致）。
const { envMock } = vi.hoisted(() => ({
  envMock: { CONTENT_SAFETY_FAIL_CLOSED: "true" } as {
    CONTENT_SAFETY_FAIL_CLOSED: string | undefined;
  },
}));
vi.mock("../../_core/env.validated", () => ({
  serverEnv: envMock,
}));

import {
  isContentSafetyFailClosed,
  resolveSafetyFallback,
  resolveFalSafetyChecker,
} from "../security/contentModeration";

function setFlag(v: string | undefined) {
  envMock.CONTENT_SAFETY_FAIL_CLOSED = v;
}

beforeEach(() => {
  // 預設＝schema default（"true"）＝ON。
  envMock.CONTENT_SAFETY_FAIL_CLOSED = "true";
});

afterEach(() => {
  envMock.CONTENT_SAFETY_FAIL_CLOSED = "true";
});

// ─── (a) 旗標 helper（預設 ON＝fail-closed）─────────────────────────────────

describe("isContentSafetyFailClosed — (a) 旗標 helper（預設 ON＝fail-closed）", () => {
  it("a1 未設環境變數（undefined）→ ON（預設 fail-closed）", () => {
    setFlag(undefined);
    expect(isContentSafetyFailClosed()).toBe(true);
  });

  it("a2 空字串 / 空白 → ON（非『明確關閉』，沿用預設）", () => {
    setFlag("");
    expect(isContentSafetyFailClosed()).toBe(true);
    setFlag("   ");
    expect(isContentSafetyFailClosed()).toBe(true);
  });

  it("a3 真值集合 true/1/on/yes（含大小寫、前後空白）→ ON", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", "On", " yes ", "YES"]) {
      setFlag(v);
      expect(isContentSafetyFailClosed()).toBe(true);
    }
  });

  it("a4 明確關閉值 false/0/off/no（含大小寫、前後空白）→ OFF（緊急回退）", () => {
    for (const v of ["0", "false", "off", "no", "FALSE", "Off", " no ", "NO"]) {
      setFlag(v);
      expect(isContentSafetyFailClosed()).toBe(false);
    }
  });

  it("a5 其他隨意字串（非明確關閉）→ ON（安全優先，不誤回退）", () => {
    for (const v of ["disabled", "foo", "2", "open"]) {
      setFlag(v);
      expect(isContentSafetyFailClosed()).toBe(true);
    }
  });
});

// ─── (b) resolveSafetyFallback（checkSafety 逾時/錯誤/無法解析）─────────────

describe("resolveSafetyFallback — (b) checkSafety fallback gate", () => {
  it("b1 預設 ON → fail-closed（{ safe:false, reason } 帶清楚原因）", () => {
    setFlag(undefined);
    const reason = "內容安全檢查暫時無法完成，請稍後重試";
    const r = resolveSafetyFallback(reason);
    expect(r.safe).toBe(false);
    expect(r.reason).toBe(reason);
  });

  it("b2 顯式 true → fail-closed", () => {
    setFlag("1");
    const r = resolveSafetyFallback("逾時");
    expect(r.safe).toBe(false);
    expect(r.reason).toBe("逾時");
  });

  it("b3 明確回退 OFF（false）→ fail-open（{ safe:true } 且無 reason）", () => {
    setFlag("false");
    const r = resolveSafetyFallback("錯誤");
    expect(r).toEqual({ safe: true });
    expect(r.reason).toBeUndefined();
  });
});

// ─── (c) resolveFalSafetyChecker（fal enable_safety_checker gate）───────────

describe("resolveFalSafetyChecker — (c) fal enable_safety_checker gate", () => {
  it("c1 預設 ON → 一律 true（開回 fal safety checker），不論現行值", () => {
    setFlag(undefined);
    expect(resolveFalSafetyChecker(false)).toBe(true);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });

  it("c2 明確回退 OFF → 維持現行值 false（input.enableSafety=false → false）", () => {
    setFlag("off");
    expect(resolveFalSafetyChecker(false)).toBe(false);
  });

  it("c3 明確回退 OFF → 維持現行值 true（input.enableSafety=true → true）", () => {
    setFlag("0");
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });
});

// ─── (d) 不誤擋 / 不退化 ──────────────────────────────────────────────────

describe("AIDV-65 — (d) 不誤擋 / 不退化", () => {
  it("d1 ON 時，現行值已 true（呼叫端已主動開）仍回 true，不退化", () => {
    setFlag("yes");
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });

  it("d2 預設＝全部 fail-closed：helper ON / fallback safe:false / fal 一律 true", () => {
    setFlag(undefined);
    expect(isContentSafetyFailClosed()).toBe(true);
    expect(resolveSafetyFallback("x").safe).toBe(false);
    expect(resolveFalSafetyChecker(false)).toBe(true);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });

  it("d3 明確回退 OFF＝完整 fail-open 行為（緊急用）", () => {
    setFlag("false");
    expect(isContentSafetyFailClosed()).toBe(false);
    expect(resolveSafetyFallback("x")).toEqual({ safe: true });
    expect(resolveFalSafetyChecker(false)).toBe(false);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });
});
