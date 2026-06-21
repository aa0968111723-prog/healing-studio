// ============================================================================
// projectGateway.loadProject.test.ts — AIDV-161 跨專案分鏡混入回歸測試（node env；純邏輯）
// ----------------------------------------------------------------------------
// 驗收（卡 AIDV-161）：loadProject 載入分鏡時必須依「當前專案連結的世界觀」過濾，
//   不得呼叫會回「該使用者全部分鏡」的 worldStoryboard.list；改用 ownership-scoped 的
//   listByWorld({ worldId })。worldId 來自 base.worldFrameworkId。
//
// 作法：mock @/adapters/trpcClient 的 getTrpcClient，回傳一個記錄所有 query 呼叫的假 client，
//   斷言 loadProject 走 listByWorld、帶對的 worldId、且未碰 list。
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 記錄假 client 收到的呼叫 ────────────────────────────────────────────────
type Call = { path: string; input: unknown };
let calls: Call[] = [];

function rec(path: string) {
  return {
    query: vi.fn(async (input?: unknown) => {
      calls.push({ path, input });
      // 回傳該 procedure 的最小合理形狀
      if (path === "creativeProject.get") {
        return { id: 7, title: "專案 A", worldFrameworkId: 42, metadata: {} };
      }
      if (path === "worldStoryboard.listByWorld") return [];
      if (path === "worldStoryboard.list") return []; // 不該被呼叫
      return null;
    }),
    mutate: vi.fn(async () => null),
  };
}

const fakeClient = {
  creativeProject: { get: rec("creativeProject.get"), list: rec("creativeProject.list") },
  worldbuilding: { get: rec("worldbuilding.get") },
  worldStoryboard: {
    list: rec("worldStoryboard.list"),
    listByWorld: rec("worldStoryboard.listByWorld"),
  },
  vault: { list: rec("vault.list") },
  notes: { list: rec("notes.list") },
  contextPacket: { getLatest: rec("contextPacket.getLatest") },
};

vi.mock("@/adapters/trpcClient", () => ({
  getTrpcClient: () => fakeClient,
}));

import { makeProjectGatewayTrpc } from "@/spine/projectGateway";

describe("AIDV-161 loadProject 分鏡依專案世界觀過濾", () => {
  beforeEach(() => {
    calls = [];
  });

  it("用 listByWorld({ worldId: base.worldFrameworkId }) 取分鏡，且不呼叫 list", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.loadProject("7");

    const listByWorld = calls.find((c) => c.path === "worldStoryboard.listByWorld");
    const listAll = calls.find((c) => c.path === "worldStoryboard.list");

    expect(listByWorld).toBeTruthy();
    expect(listByWorld?.input).toEqual({ worldId: 42 });
    // 核心驗收：絕不再呼叫會回「全部分鏡」的 list
    expect(listAll).toBeUndefined();
  });

  it("base 取得後才查分鏡（board 依賴 base.worldFrameworkId）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.loadProject(7);

    const baseIdx = calls.findIndex((c) => c.path === "creativeProject.get");
    const boardIdx = calls.findIndex((c) => c.path === "worldStoryboard.listByWorld");
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(boardIdx).toBeGreaterThan(baseIdx);
  });

  it("專案未連結世界觀（worldFrameworkId 為 null）→ 完全不查分鏡（無分鏡）", async () => {
    // 覆寫 creativeProject.get 回傳 worldFrameworkId: null
    fakeClient.creativeProject.get.query.mockImplementationOnce(async (input?: unknown) => {
      calls.push({ path: "creativeProject.get", input });
      return { id: 8, title: "未連結世界的專案", worldFrameworkId: null, metadata: {} };
    });

    const gw = makeProjectGatewayTrpc();
    const project = await gw.loadProject(8);

    expect(project).not.toBeNull();
    expect(calls.find((c) => c.path === "worldStoryboard.listByWorld")).toBeUndefined();
    expect(calls.find((c) => c.path === "worldStoryboard.list")).toBeUndefined();
  });

  it("base 取不到（creativeProject.get 失敗）→ 回 null，不查其他", async () => {
    fakeClient.creativeProject.get.query.mockImplementationOnce(async () => {
      throw new Error("not found");
    });

    const gw = makeProjectGatewayTrpc();
    const project = await gw.loadProject(999);

    expect(project).toBeNull();
    expect(calls.find((c) => c.path === "worldStoryboard.listByWorld")).toBeUndefined();
  });
});
