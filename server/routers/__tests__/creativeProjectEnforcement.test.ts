/**
 * creativeProjectEnforcement.test.ts — AIDV-121 旗標 ON 讀取 enforcement 接線測試
 *
 * 守住 `creativeProject.get` 的「實際接線」：旗標 ON 時非 owner 走 canAccess，
 * 無共享→NOT_FOUND、有共享→可取得。純函式 / resolver 已另有單測，本檔證明
 * router 的 `if (isDataRbacEnabled()) && canAccessResource(...)` 分支真的接對。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = true;
let canAccessResult = false;

vi.mock("../../db", () => ({
  getCreativeProject: vi.fn(),
  getCreativeProjectsByUser: vi.fn(),
  getWorldbuildingFramework: vi.fn(async () => null),
  deleteCreativeProject: vi.fn(),
  deleteAllSharesForResource: vi.fn(),
}));

vi.mock("../../services/authz/resourceAccess", () => ({
  isDataRbacEnabled: vi.fn(() => flagOn),
}));

vi.mock("../../services/authz/resourceAccessResolver", () => ({
  canAccessResource: vi.fn(async () => canAccessResult),
}));

vi.mock("../../services/audit/auditLog", () => ({
  recordAuditEvent: vi.fn(),
  extractRequestSource: vi.fn(() => ({})),
}));

import { creativeProjectRouter } from "../creativeProject";
import * as db from "../../db";
import { canAccessResource } from "../../services/authz/resourceAccessResolver";

const OWNER_ID = 1;
const OTHER_ID = 2;

function caller(userId: number) {
  return creativeProjectRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  flagOn = true;
  canAccessResult = false;
});

describe("AIDV-121 creativeProject.get 旗標 ON enforcement", () => {
  it("owner 永遠可取得（不經 canAccess）", async () => {
    (db.getCreativeProject as any).mockResolvedValue({
      id: 10,
      userId: OWNER_ID,
      title: "P",
      status: "concept",
      tags: [],
    });
    const res = await caller(OWNER_ID).get({ id: 10 });
    expect(res.id).toBe(10);
    expect(canAccessResource).not.toHaveBeenCalled();
  });

  it("非 owner 且無共享 → NOT_FOUND（canAccess=false）", async () => {
    (db.getCreativeProject as any).mockResolvedValue({
      id: 10,
      userId: OWNER_ID,
      title: "P",
      status: "concept",
      tags: [],
    });
    canAccessResult = false;
    await expect(caller(OTHER_ID).get({ id: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).toHaveBeenCalledWith(
      "project",
      10,
      expect.objectContaining({ ownerId: OWNER_ID }),
      OTHER_ID,
      "view"
    );
  });

  it("非 owner 但有共享（canAccess=true）→ 可取得", async () => {
    (db.getCreativeProject as any).mockResolvedValue({
      id: 10,
      userId: OWNER_ID,
      title: "P",
      status: "concept",
      tags: [],
    });
    canAccessResult = true;
    const res = await caller(OTHER_ID).get({ id: 10 });
    expect(res.id).toBe(10);
  });

  it("AIDV-297：已歸組專案 → canAccessResource 收到 groupId（組隔離 wiring 釘）", async () => {
    // 若 router 忘了把 row.groupId 投影進 facts，resolver 端的組隔離對
    // creativeProject.get 就整條失效（教材缺陷的成因）——此測項釘住傳入。
    (db.getCreativeProject as any).mockResolvedValue({
      id: 10,
      userId: OWNER_ID,
      title: "P",
      status: "concept",
      tags: [],
      groupId: 7,
    });
    canAccessResult = false;
    await expect(caller(OTHER_ID).get({ id: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).toHaveBeenCalledWith(
      "project",
      10,
      expect.objectContaining({ ownerId: OWNER_ID, groupId: 7 }),
      OTHER_ID,
      "view"
    );
  });

  it("旗標 OFF：非 owner 一律 NOT_FOUND，canAccess 完全不被呼叫（零變化）", async () => {
    flagOn = false;
    (db.getCreativeProject as any).mockResolvedValue({
      id: 10,
      userId: OWNER_ID,
      title: "P",
      status: "concept",
      tags: [],
    });
    await expect(caller(OTHER_ID).get({ id: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).not.toHaveBeenCalled();
  });
});
