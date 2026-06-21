// ============================================================================
// projectGateway.shapes.test.ts — AIDV-162 五方法送出形狀對齊真實 zod 回歸測試
// ----------------------------------------------------------------------------
// 驗收（卡 AIDV-162）：移除 projectGateway 的 `as unknown as any` 後，5 個目標 procedure
//   的呼叫送出形狀必須對齊真實 zod input（編譯期已由 inferRouterInputs<AppRouter> 把關，
//   本檔再加 runtime 斷言，避免未來有人改回錯形狀而靜默失效）：
//     1. vault.update                      → { id: number, metadata }（無 projectId/locks 頂層欄）
//     2. worldbuilding.update              → { id: number, patch }（世界觀 id，非 projectId/characterId）
//     3. worldStoryboard.createFromSegments→ { worldId, name, segments:[{storyboard,…}] }（非 projectId/Shot）
//     4. worldbuilding.get（loadProject 讀）→ { id: number }（世界觀 id，非 { projectId }）
//     5. contextPacket.compileProject      → { projectId, mode }（補必填 mode）
//   另：vault.list / notes.list 不再夾帶不存在的 projectId（any-cast 藏掉的形狀錯）。
//
// 作法：mock @/adapters/trpcClient 的 getTrpcClient，回傳記錄所有 query/mutate 呼叫的假
//   client，逐方法呼叫後斷言捕獲的 input 形狀。型別層以 inferRouterInputs<AppRouter> 的
//   `satisfies` 編譯期把關（tsc 綠＝形狀對）。
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type RouterInputs = inferRouterInputs<AppRouter>;

// ── 記錄假 client 收到的呼叫 ────────────────────────────────────────────────
type Call = { path: string; input: unknown };
let calls: Call[] = [];

function rec(path: string, ret: unknown = null) {
  return {
    query: vi.fn(async (input?: unknown) => {
      calls.push({ path, input });
      if (path === "creativeProject.get") {
        return { id: 7, title: "專案 A", worldFrameworkId: 42, metadata: {} };
      }
      return ret;
    }),
    mutate: vi.fn(async (input?: unknown) => {
      calls.push({ path, input });
      return ret;
    }),
  };
}

const fakeClient = {
  creativeProject: { get: rec("creativeProject.get"), list: rec("creativeProject.list"), link: rec("creativeProject.link") },
  worldbuilding: { get: rec("worldbuilding.get", { id: 42, characters: [], scenes: [] }), update: rec("worldbuilding.update"), list: rec("worldbuilding.list", []) },
  worldStoryboard: { list: rec("worldStoryboard.list"), listByWorld: rec("worldStoryboard.listByWorld", []), createFromSegments: rec("worldStoryboard.createFromSegments") },
  vault: { list: rec("vault.list", []), update: rec("vault.update") },
  notes: { list: rec("notes.list", []) },
  contextPacket: { getLatest: rec("contextPacket.getLatest"), compileProject: rec("contextPacket.compileProject") },
};

vi.mock("@/adapters/trpcClient", () => ({ getTrpcClient: () => fakeClient }));

import { makeProjectGatewayTrpc } from "@/spine/projectGateway";
import type { Character, Scene, Shot } from "@/spine/types";

const find = (path: string) => calls.find((c) => c.path === path);

describe("AIDV-162 五方法送出形狀對齊真實 zod", () => {
  beforeEach(() => { calls = []; });

  it("loadProject：worldbuilding.get 送 { id: worldId }，vault.list / notes.list 不夾帶 projectId", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.loadProject("7");

    const wbGet = find("worldbuilding.get");
    expect(wbGet?.input).toEqual({ id: 42 }); // 世界觀 id（base.worldFrameworkId），非 projectId
    expect(wbGet?.input).toMatchObject({ id: 42 } satisfies RouterInputs["worldbuilding"]["get"]);

    // vault.list / notes.list 真實 zod 不含 projectId → 不帶輸入（或 undefined）
    expect(find("vault.list")?.input).toBeUndefined();
    expect(find("notes.list")?.input).toBeUndefined();

    // contextPacket.getLatest 真實 zod＝{ projectId } → 保留
    expect(find("contextPacket.getLatest")?.input).toEqual({ projectId: 7 });
  });

  it("recompilePacket：compileProject 補必填 mode（COMPILE_MODES 之一）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.recompilePacket({
      id: "7", name: "p", emoji: "🎬", type: "影片", logline: "", styleBible: "",
      stageIndex: 0, characters: [], scenes: [], shots: [], notes: [], assets: [], promptBlocks: [],
      packet: { summaryMarkdown: "x", sourceRefs: [], tokenEstimate: 1, ttlSec: 0, permissions: "" },
      updatedAt: 0,
    });
    const call = find("contextPacket.compileProject");
    expect(call?.input).toEqual({ projectId: 7, mode: "director" });
    // 必填欄齊備（projectId + mode）
    const input = call?.input as RouterInputs["contextPacket"]["compileProject"];
    expect(typeof input.projectId).toBe("number");
    expect(input.mode).toBe("director");
  });

  it("saveVaultState：vault.update 送 { id: number, metadata }（無 projectId/locks 頂層欄）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.saveVaultState({
      projectId: "7", characterId: "55", sourceGrade: "precise", locked: true,
      locks: { face: true, hair: true, costume: true, accessory: true },
    });
    const call = find("vault.update");
    const input = call?.input as RouterInputs["vault"]["update"];
    expect(input.id).toBe(55);
    expect(typeof input.id).toBe("number");
    // 頂層不得有 projectId / sourceGrade / locked / locks（那些是 any-cast 藏掉的形狀錯）
    expect(input).not.toHaveProperty("projectId");
    expect(input).not.toHaveProperty("sourceGrade");
    expect(input).not.toHaveProperty("locked");
    expect(input).not.toHaveProperty("locks");
    // 鎖/grade 落 metadata
    expect(input.metadata).toMatchObject({ sourceGrade: "precise", locked: true });
  });

  it("saveVaultState：非數值 characterId 且無 vaultItemId → 跳過回寫（best-effort）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.saveVaultState({ projectId: "7", characterId: "c_abc" });
    expect(find("vault.update")).toBeUndefined();
  });

  it("saveCharacterEdit：worldbuilding.update 送 { id: worldFrameworkId, patch }（非 projectId/characterId）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.saveCharacterEdit({ projectId: "7", characterId: "c1", worldFrameworkId: 42 });
    const call = find("worldbuilding.update");
    const input = call?.input as RouterInputs["worldbuilding"]["update"];
    expect(input.id).toBe(42);
    expect(input).not.toHaveProperty("projectId");
    expect(input).not.toHaveProperty("characterId");
    expect(input.patch).toEqual({});
  });

  it("saveCharacterEdit：無 worldFrameworkId → 跳過回寫（best-effort）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.saveCharacterEdit({ projectId: "7", characterId: "c1" });
    expect(find("worldbuilding.update")).toBeUndefined();
  });

  it("ingestStoryboard：createFromSegments 送 { worldId, name, segments:[{storyboard,…}] }（非 projectId/Shot）", async () => {
    const characters: Character[] = [
      { id: "c1", name: "密勒日巴", emoji: "🧘", sourceGrade: "estimate", locked: false, locks: { face: false, hair: false, costume: false, accessory: false }, loraStatus: "未訓練", refImages: 0 },
    ];
    const scenes: Scene[] = [{ id: "s1", name: "雪山", kind: "exterior", locked: false }];
    const shots: Shot[] = [
      { id: "sh1", no: "S01", act: 1, title: "開場遠景", route: "text", characterIds: ["c1"], sceneId: "s1", seed: 1000, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } },
    ];
    const gw = makeProjectGatewayTrpc();
    await gw.ingestStoryboard({ projectId: "7", worldFrameworkId: 42, name: "拆解結果", characters, scenes, shots });

    const call = find("worldStoryboard.createFromSegments");
    const input = call?.input as RouterInputs["worldStoryboard"]["createFromSegments"];
    expect(input.worldId).toBe(42);
    expect(input).not.toHaveProperty("projectId");
    expect(input.name).toBe("拆解結果");
    expect(input.segments).toHaveLength(1);
    const seg = input.segments[0];
    // segment 子結構：nested storyboard 物件 + characters/locations 名稱字串陣列
    expect(seg.storyboard.sceneHeading).toBe("S01");
    expect(seg.storyboard).toMatchObject({
      sceneHeading: expect.any(String), visualDescription: expect.any(String), dialogue: expect.any(String),
      soundDesign: expect.any(String), cameraDirection: expect.any(String), duration: expect.any(String), mood: expect.any(String),
    });
    expect(seg.characters).toEqual(["密勒日巴"]); // 由 characterIds 解析為名稱
    expect(seg.locations).toEqual(["雪山"]); // 由 sceneId 解析為名稱
  });

  it("ingestStoryboard：無 worldFrameworkId → 跳過回寫（best-effort）", async () => {
    const gw = makeProjectGatewayTrpc();
    await gw.ingestStoryboard({ projectId: "7", characters: [], scenes: [], shots: [{ id: "sh1", no: "S01", act: 1, title: "t", route: "text", characterIds: [], sceneId: null, seed: 1, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } }] });
    expect(find("worldStoryboard.createFromSegments")).toBeUndefined();
  });
});
