/**
 * resourceAccess.test.ts — AIDV-121 資料層 RBAC 純函式測試
 *
 * canAccess() / resolveEffectiveRole() / roleCan() 是純函式（不碰 DB、不讀
 * env、不 throw），這裡直接餵事實驗矩陣：
 *   • owner view/edit/delete 全過
 *   • 他人未共享 → view 都擋（預設最小可見）
 *   • team_shared 池成員 → view/edit 過、delete 擋
 *   • 顯式共享 viewer → 只 view；editor → view+edit、delete 擋
 *   • 取多來源最高權限
 * 並驗旗標 helper：未設 / 空 / "false" → OFF；"true"/"1"/"on" → ON。
 */

import { describe, expect, it } from "vitest";
import {
  canAccess,
  isDataRbacEnabled,
  resolveEffectiveRole,
  roleCan,
  type ResourceFacts,
  type AccessSubjectFacts,
} from "../resourceAccess";

const OWNER_ID = 1;
const OTHER_ID = 2;
const TEAM_ID = 7;

function ownerSubject(): AccessSubjectFacts {
  return { userId: OWNER_ID, memberTeamIds: [], explicitShareRole: null };
}
function strangerSubject(): AccessSubjectFacts {
  return { userId: OTHER_ID, memberTeamIds: [], explicitShareRole: null };
}

const privateResource: ResourceFacts = {
  ownerId: OWNER_ID,
  visibility: "private",
  teamId: null,
};
const teamSharedResource: ResourceFacts = {
  ownerId: OWNER_ID,
  visibility: "team_shared",
  teamId: TEAM_ID,
};

describe("AIDV-121 canAccess 純函式 — 角色矩陣", () => {
  it("owner：view / edit / delete 全過", () => {
    for (const action of ["view", "edit", "delete"] as const) {
      expect(canAccess(privateResource, ownerSubject(), action)).toBe(true);
    }
    expect(resolveEffectiveRole(privateResource, ownerSubject())).toBe("owner");
  });

  it("他人未共享：view 也擋（預設最小可見）", () => {
    for (const action of ["view", "edit", "delete"] as const) {
      expect(canAccess(privateResource, strangerSubject(), action)).toBe(false);
    }
    expect(resolveEffectiveRole(privateResource, strangerSubject())).toBe(
      "none"
    );
  });

  it("team_shared 池成員：view/edit 過、delete 擋", () => {
    const member: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: [TEAM_ID],
      explicitShareRole: null,
    };
    expect(resolveEffectiveRole(teamSharedResource, member)).toBe("editor");
    expect(canAccess(teamSharedResource, member, "view")).toBe(true);
    expect(canAccess(teamSharedResource, member, "edit")).toBe(true);
    expect(canAccess(teamSharedResource, member, "delete")).toBe(false);
  });

  it("team_shared 但非該團隊成員：擋", () => {
    const outsider: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: [999],
      explicitShareRole: null,
    };
    expect(canAccess(teamSharedResource, outsider, "view")).toBe(false);
  });

  it("顯式共享 viewer：只 view", () => {
    const viewer: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: [],
      explicitShareRole: "viewer",
    };
    expect(resolveEffectiveRole(privateResource, viewer)).toBe("viewer");
    expect(canAccess(privateResource, viewer, "view")).toBe(true);
    expect(canAccess(privateResource, viewer, "edit")).toBe(false);
    expect(canAccess(privateResource, viewer, "delete")).toBe(false);
  });

  it("顯式共享 editor：view+edit、delete 擋", () => {
    const editor: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: [],
      explicitShareRole: "editor",
    };
    expect(resolveEffectiveRole(privateResource, editor)).toBe("editor");
    expect(canAccess(privateResource, editor, "view")).toBe(true);
    expect(canAccess(privateResource, editor, "edit")).toBe(true);
    expect(canAccess(privateResource, editor, "delete")).toBe(false);
  });

  it("多來源取最高權限：viewer 共享 + team_shared 成員 → editor", () => {
    const subject: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: [TEAM_ID],
      explicitShareRole: "viewer",
    };
    expect(resolveEffectiveRole(teamSharedResource, subject)).toBe("editor");
  });

  it("owner 永遠勝過任何共享/成員身分", () => {
    const subject: AccessSubjectFacts = {
      userId: OWNER_ID,
      memberTeamIds: [TEAM_ID],
      explicitShareRole: "viewer",
    };
    expect(resolveEffectiveRole(teamSharedResource, subject)).toBe("owner");
  });

  it("memberTeamIds 支援 Set 與陣列兩種輸入", () => {
    const viaSet: AccessSubjectFacts = {
      userId: OTHER_ID,
      memberTeamIds: new Set([TEAM_ID]),
      explicitShareRole: null,
    };
    expect(canAccess(teamSharedResource, viaSet, "view")).toBe(true);
  });
});

describe("AIDV-121 roleCan 動作矩陣", () => {
  it("none 全擋", () => {
    for (const action of ["view", "edit", "delete"] as const) {
      expect(roleCan("none", action)).toBe(false);
    }
  });
  it("viewer 只 view", () => {
    expect(roleCan("viewer", "view")).toBe(true);
    expect(roleCan("viewer", "edit")).toBe(false);
    expect(roleCan("viewer", "delete")).toBe(false);
  });
  it("editor view+edit、不可 delete", () => {
    expect(roleCan("editor", "view")).toBe(true);
    expect(roleCan("editor", "edit")).toBe(true);
    expect(roleCan("editor", "delete")).toBe(false);
  });
  it("owner 全可", () => {
    expect(roleCan("owner", "view")).toBe(true);
    expect(roleCan("owner", "edit")).toBe(true);
    expect(roleCan("owner", "delete")).toBe(true);
  });
});

describe("AIDV-121 isDataRbacEnabled 旗標（預設 OFF）", () => {
  it("未設 / 空字串 → OFF", () => {
    expect(isDataRbacEnabled(undefined)).toBe(false);
    expect(isDataRbacEnabled("")).toBe(false);
    expect(isDataRbacEnabled("   ")).toBe(false);
  });
  it("關閉值 → OFF", () => {
    for (const v of ["false", "0", "off", "no", "FALSE", "Off"]) {
      expect(isDataRbacEnabled(v)).toBe(false);
    }
  });
  it("開啟值 → ON", () => {
    for (const v of ["true", "1", "on", "yes", "enabled", "TRUE", "On"]) {
      expect(isDataRbacEnabled(v)).toBe(true);
    }
  });

  it("生產預設（不帶 override，讀 serverEnv）→ OFF（零行為變化保證）", () => {
    // env.validated 對 ENABLE_DATA_RBAC 預設 "false"；測試環境亦未設此 env，
    // 故 isDataRbacEnabled() 無 override 時必為 false。這是 HARD SAFETY ① 的
    // 機器可驗證證據：旗標 OFF 時各 router 不進入 canAccess，行為位元相同。
    expect(isDataRbacEnabled()).toBe(false);
  });
});
