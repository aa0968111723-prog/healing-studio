/**
 * AIDV-58（H3）— isAdmin 單一判定契約測試
 *
 * isAdmin 是 /api/metrics（raw Express）與 tRPC adminProcedure 共用的守門判定，
 * 必須嚴格只認 "admin"：leader / user / 未知 / 空值 一律 false（避免 leader 看到監控洩漏）。
 */
import { describe, expect, it } from "vitest";
import { isAdmin, isLeaderOrAdmin } from "./const";

describe("isAdmin — 嚴格只認 admin", () => {
  it("admin → true", () => {
    expect(isAdmin("admin")).toBe(true);
  });

  it("leader → false（leader 不算 admin）", () => {
    expect(isAdmin("leader")).toBe(false);
  });

  it("user → false（含 demo DEMO_USER）", () => {
    expect(isAdmin("user")).toBe(false);
  });

  it("undefined / null / 空字串 / 未知值 → false（fail-closed）", () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin("")).toBe(false);
    expect(isAdmin("superuser")).toBe(false);
  });
});

describe("isLeaderOrAdmin — 與 isAdmin 的階層關係", () => {
  it("admin 與 leader 皆為「組長以上」，user 不是", () => {
    expect(isLeaderOrAdmin("admin")).toBe(true);
    expect(isLeaderOrAdmin("leader")).toBe(true);
    expect(isLeaderOrAdmin("user")).toBe(false);
  });

  it("isAdmin ⊂ isLeaderOrAdmin（admin 必然也是 leaderOrAdmin）", () => {
    for (const role of ["admin", "leader", "user", "", undefined, null]) {
      if (isAdmin(role)) expect(isLeaderOrAdmin(role)).toBe(true);
    }
  });
});
