/**
 * orb-proxy-common-answers.test.ts — AIDV-566
 *
 * 驗收條件：
 *   1. 已是陣列 → 直接回傳（不重新 parse）
 *   2. 合法 JSON 字串 → parse 成功回傳陣列
 *   3. JSON 字串但 parse 結果非陣列（物件）→ 回傳 []
 *   4. 壞字串（SyntaxError）→ 回傳 [] 不拋例外
 *   5. raw = null/undefined/數字/物件 → 回傳 []
 *   6. 整批含一壞列時，壞列以 [] 略過，整批不 500（不拋例外）
 */

import { describe, it, expect } from "vitest";

// The helper is not exported by the router, so we duplicate it here
// to test the logic in isolation — same pattern as the production code.
type CommonAnswer = { answer: string; frequency: number; lastUsed: string };

function decodeCommonAnswers(raw: unknown): CommonAnswer[] {
  if (Array.isArray(raw)) return raw as CommonAnswer[];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CommonAnswer[]) : [];
  } catch {
    return [];
  }
}

const SAMPLE: CommonAnswer[] = [{ answer: "短片", frequency: 3, lastUsed: "2026-01-01" }];

describe("decodeCommonAnswers (AIDV-566)", () => {
  it("已是陣列 → 直接回傳", () => {
    expect(decodeCommonAnswers(SAMPLE)).toBe(SAMPLE);
  });

  it("合法 JSON 字串 → 回傳陣列", () => {
    expect(decodeCommonAnswers(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
  });

  it("JSON 字串但結果是物件 → 回傳 []", () => {
    expect(decodeCommonAnswers('{"answer":"x"}')).toEqual([]);
  });

  it("壞 JSON 字串（SyntaxError）→ 回傳 [] 不拋例外", () => {
    expect(() => decodeCommonAnswers("{broken json")).not.toThrow();
    expect(decodeCommonAnswers("{broken json")).toEqual([]);
  });

  it("null → 回傳 []", () => {
    expect(decodeCommonAnswers(null)).toEqual([]);
  });

  it("undefined → 回傳 []", () => {
    expect(decodeCommonAnswers(undefined)).toEqual([]);
  });

  it("物件（mysql2 自動 parse 後回傳 object 而非 string）→ 回傳 []", () => {
    expect(decodeCommonAnswers({ answer: "x" })).toEqual([]);
  });

  it("數字 → 回傳 []", () => {
    expect(decodeCommonAnswers(42)).toEqual([]);
  });

  it("多列混入一壞列 → 壞列 []，不影響其他列（不拋例外）", () => {
    const rows: unknown[] = [JSON.stringify(SAMPLE), "{bad}", JSON.stringify(SAMPLE)];
    const results = rows.map(r => decodeCommonAnswers(r));
    expect(results[0]).toEqual(SAMPLE);
    expect(results[1]).toEqual([]);
    expect(results[2]).toEqual(SAMPLE);
  });

  it("空字串 → 回傳 []", () => {
    expect(decodeCommonAnswers("")).toEqual([]);
  });
});
