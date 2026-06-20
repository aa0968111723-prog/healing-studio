/**
 * contentModeration.test.ts — AIDV-65 ⑧-M2 內容審核 fail-closed 旗標測試矩陣
 *
 * 涵蓋：
 *  (a) 旗標 helper isStrictContentModerationEnabled（預設 OFF；真值集合；
 *      falsy／空白／未設皆 OFF）
 *  (b) resolveSafetyFallback（checkSafety 逾時/錯誤/無法解析 fallback）：
 *      - OFF → fail-open（{ safe: true }，位元相同：無 reason）
 *      - ON  → fail-closed（{ safe: false, reason }，帶清楚原因）
 *  (c) resolveFalSafetyChecker（fal enable_safety_checker gate）：
 *      - OFF → 維持現行值（false 與 true 皆原樣回傳，位元相同）
 *      - ON  → 一律 true（開回）
 *  (d) 不誤擋：safety 檢查正常通過時不經 fallback（由 checkSafety 主路徑回 safe:true），
 *      此處驗證 ON 時對「現行值 true（已開）」仍回 true、不退化。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  isStrictContentModerationEnabled,
  resolveSafetyFallback,
  resolveFalSafetyChecker,
} from "../security/contentModeration";

const FLAG = "ENABLE_STRICT_CONTENT_MODERATION";

function setFlag(v: string | undefined) {
  if (v === undefined) delete process.env[FLAG];
  else process.env[FLAG] = v;
}

afterEach(() => {
  delete process.env[FLAG];
});

// ─── (a) 旗標 helper ─────────────────────────────────────────────────────

describe("isStrictContentModerationEnabled — (a) 旗標 helper（預設 OFF）", () => {
  it("a1 未設環境變數 → OFF（預設關，零行為改變）", () => {
    setFlag(undefined);
    expect(isStrictContentModerationEnabled()).toBe(false);
  });

  it("a2 空字串 / 空白 → OFF", () => {
    setFlag("");
    expect(isStrictContentModerationEnabled()).toBe(false);
    setFlag("   ");
    expect(isStrictContentModerationEnabled()).toBe(false);
  });

  it("a3 真值集合 1/true/on/yes（含大小寫、前後空白）→ ON", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", "On", " yes ", "YES"]) {
      setFlag(v);
      expect(isStrictContentModerationEnabled()).toBe(true);
    }
  });

  it("a4 其他值（0/false/off/no/隨意字串）→ OFF", () => {
    for (const v of ["0", "false", "off", "no", "disabled", "foo", "2"]) {
      setFlag(v);
      expect(isStrictContentModerationEnabled()).toBe(false);
    }
  });
});

// ─── (b) resolveSafetyFallback（checkSafety 逾時/錯誤/無法解析）─────────────

describe("resolveSafetyFallback — (b) checkSafety fallback gate", () => {
  it("b1 旗標 OFF → fail-open（位元相同：{ safe: true } 且無 reason）", () => {
    setFlag(undefined);
    const r = resolveSafetyFallback("逾時");
    expect(r).toEqual({ safe: true });
    expect(r.reason).toBeUndefined();
  });

  it("b2 旗標 OFF（顯式 false 字串）→ 仍 fail-open", () => {
    setFlag("false");
    expect(resolveSafetyFallback("錯誤")).toEqual({ safe: true });
  });

  it("b3 旗標 ON → fail-closed（{ safe: false, reason } 帶清楚原因）", () => {
    setFlag("1");
    const reason = "內容安全檢查逾時或發生錯誤，為安全起見暫不放行，請稍後再試";
    const r = resolveSafetyFallback(reason);
    expect(r.safe).toBe(false);
    expect(r.reason).toBe(reason);
  });
});

// ─── (c) resolveFalSafetyChecker（fal enable_safety_checker gate）───────────

describe("resolveFalSafetyChecker — (c) fal enable_safety_checker gate", () => {
  it("c1 旗標 OFF → 維持現行值 false（imageGeneration 現值，位元相同）", () => {
    setFlag(undefined);
    expect(resolveFalSafetyChecker(false)).toBe(false);
  });

  it("c2 旗標 OFF → 維持現行值 true（videoStudio input.enableSafety=true 時，位元相同）", () => {
    setFlag(undefined);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });

  it("c3 旗標 ON → 一律 true（開回 fal safety checker），不論現行值", () => {
    setFlag("on");
    expect(resolveFalSafetyChecker(false)).toBe(true);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });
});

// ─── (d) 不誤擋 / 不退化 ──────────────────────────────────────────────────

describe("AIDV-65 — (d) 不誤擋 / 不退化", () => {
  it("d1 ON 時，現行值已 true（呼叫端已主動開）仍回 true，不退化", () => {
    setFlag("yes");
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });

  it("d2 OFF＝零行為改變：三 helper 全部維持現狀（false / safe:true / 原值）", () => {
    setFlag(undefined);
    expect(isStrictContentModerationEnabled()).toBe(false);
    expect(resolveSafetyFallback("x")).toEqual({ safe: true });
    expect(resolveFalSafetyChecker(false)).toBe(false);
    expect(resolveFalSafetyChecker(true)).toBe(true);
  });
});
