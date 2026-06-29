/**
 * orb-proxy-learned-patterns-decode.test.ts
 *
 * AIDV-566 — orbProxyRouter.listLearnedPatterns 對每列 commonAnswers 的防禦性
 * 解碼。驗證單列髒資料（物件原樣／壞字串／null）不會讓整批 query 拋出 500，
 * 而是該列以空陣列略過。
 */

import { describe, expect, it } from "vitest";
import { decodeCommonAnswers } from "./routers/orbProxyRouter";

describe("decodeCommonAnswers", () => {
  it("parses a valid JSON string (current orbClarificationEngine round-trip)", () => {
    const raw = JSON.stringify([
      { answer: "電影感", frequency: 3, lastUsed: "2026-06-01" },
    ]);
    expect(decodeCommonAnswers(raw)).toEqual([
      { answer: "電影感", frequency: 3, lastUsed: "2026-06-01" },
    ]);
  });

  it("uses an already-decoded array as-is (mysql2 returning object, no double parse)", () => {
    const arr = [{ answer: "禪意", frequency: 1, lastUsed: "2026-06-10" }];
    expect(decodeCommonAnswers(arr)).toBe(arr);
  });

  it("skips a malformed JSON string with [] instead of throwing", () => {
    expect(decodeCommonAnswers("{not valid json")).toEqual([]);
  });

  it("skips a JSON string that parses to a non-array with []", () => {
    expect(decodeCommonAnswers('{"answer":"x"}')).toEqual([]);
  });

  it("skips null / undefined / number with []", () => {
    expect(decodeCommonAnswers(null)).toEqual([]);
    expect(decodeCommonAnswers(undefined)).toEqual([]);
    expect(decodeCommonAnswers(42)).toEqual([]);
  });

  it("never throws across a batch of mixed clean and dirty rows", () => {
    const rows: unknown[] = [
      JSON.stringify([{ answer: "a", frequency: 1, lastUsed: "x" }]),
      "{broken",
      [{ answer: "b", frequency: 2, lastUsed: "y" }],
      null,
      "{}",
    ];
    expect(() => rows.map(decodeCommonAnswers)).not.toThrow();
    const decoded = rows.map(decodeCommonAnswers);
    expect(decoded[0]).toHaveLength(1);
    expect(decoded[1]).toEqual([]);
    expect(decoded[2]).toHaveLength(1);
    expect(decoded[3]).toEqual([]);
    expect(decoded[4]).toEqual([]);
  });
});
