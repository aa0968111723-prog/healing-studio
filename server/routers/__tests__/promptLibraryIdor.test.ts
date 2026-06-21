/**
 * promptLibraryIdor.test.ts — AIDV-184 promptLibrary 可見性/IDOR 一致性
 *
 * 兩個修補點：
 *   ① incrementUseCount：原本無 userId/visibility 述詞＝任何登入者可灌任何
 *      prompt（含他人私有）的 useCount，且不管命中與否都回 success:true。
 *      修後只允許「本人擁有 OR 公開」，並依命中回真實 success。
 *   ② getById（RBAC 旗標 ON 分支）：原本 canAccess 的 visibility 硬編 null，
 *      公開 prompt 在 listPublic 看得到、by-id 卻 NOT_FOUND（list/detail 不一致）。
 *      修後公開 prompt 短路直回（不呼叫 canAccess）。
 *
 * mock 與 promptLibraryEnforcement.test.ts 同款鏈式 query builder：where().limit()
 *   回 promptRow（代表「述詞命中與否」由 fixture 控制，mock 無法解析 WHERE）；
 *   update().set().where() 記錄是否真的執行 +1。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = false;
let canAccessResult = false;

/** 述詞查詢回傳的單列（null＝查無＝述詞未命中） */
let promptRow:
  | { id: number; userId: number; isPublic?: boolean; title?: string }
  | null = null;

/** incrementUseCount 是否真的執行了 UPDATE +1 */
let updateRan = false;

function makeDbMock() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (promptRow ? [promptRow] : [])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          updateRan = true;
          return [{ affectedRows: 1 }];
        }),
      })),
    })),
  };
}

let dbAvailable = true;

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => (dbAvailable ? makeDbMock() : null)),
  getLinkedAssetsForPrompt: vi.fn(async () => []),
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

import { promptLibraryRouter } from "../promptLibrary";
import { canAccessResource } from "../../services/authz/resourceAccessResolver";

const OWNER_ID = 1;
const OTHER_ID = 2;

function caller(userId: number) {
  return promptLibraryRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  flagOn = false;
  canAccessResult = false;
  promptRow = null;
  updateRan = false;
  dbAvailable = true;
});

describe("AIDV-184 ① incrementUseCount IDOR + 真實 success", () => {
  it("述詞命中（本人 OR 公開）→ 執行 +1，回 success:true", async () => {
    promptRow = { id: 5, userId: OWNER_ID, isPublic: true };
    const res = await caller(OWNER_ID).incrementUseCount({ id: 5 });
    expect(res.success).toBe(true);
    expect(updateRan).toBe(true);
  });

  it("述詞未命中（他人私有 / 不存在 id）→ 不執行 +1，回 success:false（不再靜默 no-op）", async () => {
    // mock 以 promptRow=null 代表 owner-or-public 述詞查無此列
    promptRow = null;
    const res = await caller(OTHER_ID).incrementUseCount({ id: 5 });
    expect(res.success).toBe(false);
    expect(updateRan).toBe(false);
  });

  it("DB 不可用 → 回 success:false，不執行 +1", async () => {
    dbAvailable = false;
    const res = await caller(OWNER_ID).incrementUseCount({ id: 5 });
    expect(res.success).toBe(false);
    expect(updateRan).toBe(false);
  });
});

describe("AIDV-184 ② getById 旗標 ON 公開 prompt 一致性", () => {
  it("旗標 ON 非 owner 取公開 prompt → 直回該 row，不呼叫 canAccess（與 listPublic 一致）", async () => {
    flagOn = true;
    promptRow = { id: 7, userId: OWNER_ID, isPublic: true, title: "public" };
    const res = await caller(OTHER_ID).getById({ id: 7 });
    expect((res as any).id).toBe(7);
    expect(canAccessResource).not.toHaveBeenCalled();
  });

  it("旗標 ON 非 owner 取私有 prompt 無共享 → 走 canAccess → NOT_FOUND（IDOR 守護不變）", async () => {
    flagOn = true;
    canAccessResult = false;
    promptRow = { id: 8, userId: OWNER_ID, isPublic: false, title: "secret" };
    await expect(caller(OTHER_ID).getById({ id: 8 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).toHaveBeenCalledWith(
      "prompt",
      8,
      expect.objectContaining({ ownerId: OWNER_ID }),
      OTHER_ID,
      "view"
    );
  });

  it("旗標 ON 非 owner 取私有 prompt 有共享 → 可取得", async () => {
    flagOn = true;
    canAccessResult = true;
    promptRow = { id: 9, userId: OWNER_ID, isPublic: false, title: "shared" };
    const res = await caller(OTHER_ID).getById({ id: 9 });
    expect((res as any).id).toBe(9);
  });

  it("旗標 ON owner 取自己的公開 prompt → 直回（owner 早於 isPublic 判斷亦可）", async () => {
    flagOn = true;
    promptRow = { id: 10, userId: OWNER_ID, isPublic: true, title: "mine-public" };
    const res = await caller(OWNER_ID).getById({ id: 10 });
    expect((res as any).id).toBe(10);
    expect(canAccessResource).not.toHaveBeenCalled();
  });
});
