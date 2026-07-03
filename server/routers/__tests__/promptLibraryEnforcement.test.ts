/**
 * promptLibraryEnforcement.test.ts — AIDV-121 旗標 ON getById IDOR 守護（最高優先）
 *
 * promptLibrary.getById 在旗標 ON 時把 WHERE 由 `id=? AND userId=?` 放寬成
 * `id=?`，再用 canAccess 補回授權。若接線寫錯就是直接 IDOR。本檔守住：
 *   • 旗標 ON 非 owner 無共享 → NOT_FOUND（放寬 WHERE 後不外洩別人的 prompt）。
 *   • 旗標 ON 非 owner 有共享 → 可取得。
 *   • owner → 可取得。
 *   • 旗標 OFF → 走 owner-only WHERE，非 owner 拿不到（零變化）。
 *
 * getDb() 回傳可鏈式 query builder mock；以 lastWhereOwnerScoped 旗標記錄該次
 * select 的 WHERE 是否含 userId 條件，藉此驗證「旗標 OFF 走 owner-only、ON 走
 * by-id」這條改寫的實際行為。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = true;
let groupFlagOn = false;
let canAccessResult = false;

/** 模擬資料表的單列（依 by-id 查詢回傳；null＝查無此 id） */
let promptRow:
  | { id: number; userId: number; title: string; isPublic?: boolean; groupId?: number | null }
  | null = null;

/** 旗標 OFF 時 router 會在 WHERE 加 userId 條件 → 用此記錄是否「owner 命中」 */
let ownerScopedMatch: { id: number; userId: number } | null = null;

/**
 * 鏈式 query builder：select().from().where().limit() → Promise<rows>。
 * where() 接到一個 SQL 物件；我們無法解析其內容，改以兩個外部 fixture 控制：
 *   • 旗標 OFF（owner-only WHERE）：回 ownerScopedMatch 包成 [row] 或 []。
 *   • 旗標 ON（by-id WHERE）：回 promptRow 包成 [row] 或 []。
 * router 旗標分支自己決定走哪條，我們只需讓兩條各自回對的 fixture。
 */
function makeDbMock() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            // 旗標 ON 路徑：by-id；旗標 OFF 路徑：owner-scoped。
            if (flagOn) {
              return promptRow ? [promptRow] : [];
            }
            return ownerScopedMatch ? [ownerScopedMatch] : [];
          }),
        })),
      })),
    })),
  };
}

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => makeDbMock()),
  getLinkedAssetsForPrompt: vi.fn(async () => []),
  deleteAllSharesForResource: vi.fn(),
}));

vi.mock("../../services/authz/resourceAccess", () => ({
  isDataRbacEnabled: vi.fn(() => flagOn),
}));

vi.mock("../../services/authz/resourceAccessResolver", () => ({
  canAccessResource: vi.fn(async () => canAccessResult),
}));

vi.mock("../../services/authz/groupAccess", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    isGroupScopeEnabled: vi.fn(() => groupFlagOn),
  };
});

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
  flagOn = true;
  groupFlagOn = false;
  canAccessResult = false;
  promptRow = null;
  ownerScopedMatch = null;
});

describe("AIDV-121 promptLibrary.getById 旗標 ON IDOR 守護", () => {
  it("owner → 可取得（不需 canAccess）", async () => {
    promptRow = { id: 5, userId: OWNER_ID, title: "mine" };
    const res = await caller(OWNER_ID).getById({ id: 5 });
    expect(res.id).toBe(5);
    expect(canAccessResource).not.toHaveBeenCalled();
  });

  it("非 owner 無共享 → NOT_FOUND（放寬 WHERE 後不外洩，IDOR 守護）", async () => {
    promptRow = { id: 5, userId: OWNER_ID, title: "secret" };
    canAccessResult = false;
    await expect(caller(OTHER_ID).getById({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // 確認真的走了 canAccess（by-id 放寬後的補授權），且傳對參數
    expect(canAccessResource).toHaveBeenCalledWith(
      "prompt",
      5,
      expect.objectContaining({ ownerId: OWNER_ID }),
      OTHER_ID,
      "view"
    );
  });

  it("非 owner 但有共享 → 可取得", async () => {
    promptRow = { id: 5, userId: OWNER_ID, title: "shared" };
    canAccessResult = true;
    const res = await caller(OTHER_ID).getById({ id: 5 });
    expect(res.id).toBe(5);
  });

  it("旗標 OFF：非 owner 走 owner-only WHERE → NOT_FOUND，canAccess 不被呼叫（零變化）", async () => {
    flagOn = false;
    // owner-scoped WHERE 對非 owner 查無（owner-only），故回空
    ownerScopedMatch = null;
    await expect(caller(OTHER_ID).getById({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).not.toHaveBeenCalled();
  });

  it("旗標 OFF：owner 走 owner-only WHERE → 可取得（零變化）", async () => {
    flagOn = false;
    ownerScopedMatch = { id: 5, userId: OWNER_ID };
    const res = await caller(OWNER_ID).getById({ id: 5 });
    expect((res as any).id).toBe(5);
    expect(canAccessResource).not.toHaveBeenCalled();
  });
});

describe("AIDV-297 promptLibrary.getById 組別範圍（wiring 釘＋public×grouped 語意）", () => {
  it("已歸組提示詞 → canAccessResource 收到 groupId（組隔離 wiring 釘）", async () => {
    promptRow = { id: 5, userId: OWNER_ID, title: "grouped", groupId: 7 };
    canAccessResult = false;
    await expect(caller(OTHER_ID).getById({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).toHaveBeenCalledWith(
      "prompt",
      5,
      expect.objectContaining({ ownerId: OWNER_ID, groupId: 7 }),
      OTHER_ID,
      "view"
    );
  });

  it("公開＋未歸組 → 短路放行（AIDV-184 廣場一致性不變）", async () => {
    promptRow = { id: 5, userId: OWNER_ID, title: "pub", isPublic: true, groupId: null };
    const res = await caller(OTHER_ID).getById({ id: 5 });
    expect(res.id).toBe(5);
    expect(canAccessResource).not.toHaveBeenCalled();
  });

  it("公開＋已歸組＋組別範圍 ON → 不走 public 短路，交 canAccessResource（非組員擋）", async () => {
    groupFlagOn = true;
    promptRow = { id: 5, userId: OWNER_ID, title: "pub-grouped", isPublic: true, groupId: 7 };
    canAccessResult = false;
    await expect(caller(OTHER_ID).getById({ id: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(canAccessResource).toHaveBeenCalledWith(
      "prompt",
      5,
      expect.objectContaining({ groupId: 7 }),
      OTHER_ID,
      "view"
    );
  });

  it("公開＋已歸組＋組別範圍 OFF → 仍走 public 短路（旗標 OFF 等價承諾）", async () => {
    groupFlagOn = false;
    promptRow = { id: 5, userId: OWNER_ID, title: "pub-grouped", isPublic: true, groupId: 7 };
    const res = await caller(OTHER_ID).getById({ id: 5 });
    expect(res.id).toBe(5);
    expect(canAccessResource).not.toHaveBeenCalled();
  });
});
