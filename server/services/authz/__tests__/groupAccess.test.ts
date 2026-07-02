/**
 * groupAccess.test.ts — AIDV-297 組別範圍純函式測試
 *
 * 驗證組別模型的授權核心（全部純函式、不碰 DB）：
 *   • ADMIN_PERMISSION_MATRIX：admin 全能力、leader/user 全不可（SSOT，
 *     T-2 管理台 / T-4 配額引用）；systemRoleCan 對未知角色一律 false。
 *   • groupRoleToResourceRole：lead→editor、member→viewer、非組員→none。
 *   • canManageGroup：Admin 或 lead 可；member / 非組員不可。
 *   • applyGroupScope 五條規則：未歸組通過、owner 至上、admin 調閱不受隔離、
 *     非組員隔離（顯式共享也壓掉）、組員取較高者（grant 上限 editor）。
 *   • isGroupScopeEnabled 旗標解析（預設 OFF；1/true/on/yes/enabled → ON）。
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_CAPABILITIES,
  ADMIN_PERMISSION_MATRIX,
  applyGroupScope,
  canManageGroup,
  groupRoleToResourceRole,
  isGroupScopeEnabled,
  isSystemAdmin,
  maxEffectiveRole,
  systemRoleCan,
} from "../groupAccess";

describe("AIDV-297 Admin 能力矩陣（SSOT）", () => {
  it("admin：全部能力 true（Skill 放行 / 配額 / 調閱 / 成員 / 組別 / 委派）", () => {
    for (const cap of ADMIN_CAPABILITIES) {
      expect(ADMIN_PERMISSION_MATRIX.admin[cap], `admin.${cap}`).toBe(true);
      expect(systemRoleCan("admin", cap)).toBe(true);
    }
  });

  it("leader / user：全部能力 false", () => {
    for (const role of ["leader", "user"] as const) {
      for (const cap of ADMIN_CAPABILITIES) {
        expect(ADMIN_PERMISSION_MATRIX[role][cap], `${role}.${cap}`).toBe(false);
        expect(systemRoleCan(role, cap)).toBe(false);
      }
    }
  });

  it("未知 / 缺角色：一律 false（預設最小權限）", () => {
    expect(systemRoleCan(null, "group_management")).toBe(false);
    expect(systemRoleCan(undefined, "quota_adjustment")).toBe(false);
    expect(systemRoleCan("superuser", "delegate_admin")).toBe(false);
    expect(systemRoleCan("", "data_inspection")).toBe(false);
  });

  it("isSystemAdmin：只有 'admin' 為 true", () => {
    expect(isSystemAdmin("admin")).toBe(true);
    expect(isSystemAdmin("leader")).toBe(false);
    expect(isSystemAdmin("user")).toBe(false);
    expect(isSystemAdmin(null)).toBe(false);
  });
});

describe("AIDV-297 組內角色 → 資源層角色下限", () => {
  it("lead→editor、member→viewer、非組員→none", () => {
    expect(groupRoleToResourceRole("lead")).toBe("editor");
    expect(groupRoleToResourceRole("member")).toBe("viewer");
    expect(groupRoleToResourceRole(null)).toBe("none");
    expect(groupRoleToResourceRole(undefined)).toBe("none");
  });

  it("canManageGroup：Admin 或 lead 可；member / 非組員不可", () => {
    expect(canManageGroup("admin", null)).toBe(true);
    expect(canManageGroup("user", "lead")).toBe(true);
    expect(canManageGroup("leader", "member")).toBe(false);
    expect(canManageGroup("user", null)).toBe(false);
  });

  it("maxEffectiveRole：owner > editor > viewer > none", () => {
    expect(maxEffectiveRole("owner", "editor")).toBe("owner");
    expect(maxEffectiveRole("viewer", "editor")).toBe("editor");
    expect(maxEffectiveRole("none", "viewer")).toBe("viewer");
    expect(maxEffectiveRole("none", "none")).toBe("none");
  });
});

describe("AIDV-297 applyGroupScope（跨組隔離 + 組內授權）", () => {
  const RES = { ownerId: 1, groupId: 9 };

  it("規則1：未歸組（groupId=null）→ 原樣通過（與現狀相同）", () => {
    const res = { ownerId: 1, groupId: null };
    for (const base of ["owner", "editor", "viewer", "none"] as const) {
      expect(applyGroupScope(base, res, { userId: 2 })).toBe(base);
    }
  });

  it("規則2：owner 至上——owner 永不被自己資源的組別鎖在門外", () => {
    expect(applyGroupScope("owner", RES, { userId: 1 })).toBe("owner");
    // 即使 owner 已非組員（退組後）也不受隔離
    expect(
      applyGroupScope("owner", RES, { userId: 1, groupRole: null })
    ).toBe("owner");
  });

  it("規則3：系統 admin 不受隔離（調閱），但不因此新增授權", () => {
    // admin 有 viewer 共享 → 保持 viewer（不被壓掉、也不升級）
    expect(
      applyGroupScope("viewer", RES, { userId: 3, systemRole: "admin" })
    ).toBe("viewer");
    // admin 無任何授權 → 仍是 none（隔離不擋他，但 grant 只給組員）
    expect(
      applyGroupScope("none", RES, { userId: 3, systemRole: "admin" })
    ).toBe("none");
  });

  it("規則4：跨組隔離——非組員即使被顯式共享 editor 也壓成 none", () => {
    expect(
      applyGroupScope("editor", RES, { userId: 2, systemRole: "user" })
    ).toBe("none");
    expect(applyGroupScope("viewer", RES, { userId: 2 })).toBe("none");
    expect(applyGroupScope("none", RES, { userId: 2 })).toBe("none");
    // leader 系統角色也不能跨組（Admin 才可）
    expect(
      applyGroupScope("editor", RES, { userId: 2, systemRole: "leader" })
    ).toBe("none");
  });

  it("規則5：組員取「既有授權 vs 組內下限」較高者", () => {
    // member：無共享 → viewer（組授權下限）
    expect(
      applyGroupScope("none", RES, { userId: 2, groupRole: "member" })
    ).toBe("viewer");
    // member 已被顯式共享 editor → 保持 editor（不降級）
    expect(
      applyGroupScope("editor", RES, { userId: 2, groupRole: "member" })
    ).toBe("editor");
    // lead：無共享 → editor
    expect(
      applyGroupScope("none", RES, { userId: 2, groupRole: "lead" })
    ).toBe("editor");
    // lead 永不因組授權升到 owner（grant 上限 editor）
    expect(
      applyGroupScope("viewer", RES, { userId: 2, groupRole: "lead" })
    ).toBe("editor");
  });
});

describe("AIDV-297 isGroupScopeEnabled 旗標解析", () => {
  it("預設（未設 / 空字串）→ OFF", () => {
    expect(isGroupScopeEnabled()).toBe(false); // serverEnv 預設 "false"
    expect(isGroupScopeEnabled("")).toBe(false);
    expect(isGroupScopeEnabled("   ")).toBe(false);
  });

  it("1/true/on/yes/enabled（含大小寫與空白）→ ON", () => {
    for (const v of ["1", "true", "on", "yes", "enabled", " TRUE ", "On"]) {
      expect(isGroupScopeEnabled(v), `value=${v}`).toBe(true);
    }
  });

  it("0/false/off/其他 → OFF", () => {
    for (const v of ["0", "false", "off", "no", "disabled", "2"]) {
      expect(isGroupScopeEnabled(v), `value=${v}`).toBe(false);
    }
  });
});
