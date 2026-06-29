/**
 * AIDV-151: worldStoryboardQueue.test.ts
 *
 * queueForVideo — Director→Video 橋接，建立 in_progress 分鏡板並種入 jobsJson 佇列。
 *
 * 驗收：
 *   ✅ 正常流程：建立 storyboard + jobsJson 有 queued 狀態 + productionStatus=in_progress
 *   ✅ visualPrompt 從 CO-STAR 帶入 jobsJson
 *   ✅ 無 worldId 匹配 → NOT_FOUND（framework ownership 守門）
 *   ✅ 返回 id + sceneCount + totalDurationSec
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock: db ───────────────────────────────────────────────────────────────
const createWorldStoryboardMock = vi.fn();
const getWorldbuildingFrameworkMock = vi.fn();
const getWorldStoryboardMock = vi.fn(async () => null);
const updateWorldStoryboardJobAtomicMock = vi.fn(async () => {});
vi.mock("../../db", () => ({
  createWorldStoryboard: (...a: unknown[]) => createWorldStoryboardMock(...a),
  getWorldbuildingFramework: (...a: unknown[]) =>
    getWorldbuildingFrameworkMock(...a),
  // other db fns the router may call transitively
  getWorldStoryboard: (...a: unknown[]) => getWorldStoryboardMock(...a),
  updateWorldStoryboard: vi.fn(async () => {}),
  updateWorldStoryboardJobAtomic: (...a: unknown[]) =>
    updateWorldStoryboardJobAtomicMock(...a),
  getWorldStoryboardsByUser: vi.fn(async () => []),
  getWorldStoryboardsByWorld: vi.fn(async () => []),
  deleteWorldStoryboard: vi.fn(async () => {}),
}));

import { worldStoryboardRouter } from "../worldStoryboard";

// ── helpers ────────────────────────────────────────────────────────────────

const USER_ID = 10;

function makeCaller(userId = USER_ID) {
  const ctx = {
    user: { id: userId, role: "user" },
    req: {} as never,
    res: {} as never,
    orbTraceId: "test-trace",
  } as never;
  return worldStoryboardRouter.createCaller(ctx);
}

function makeFramework() {
  return {
    id: 1,
    userId: USER_ID,
    worldId: 1,
    title: "測試世界觀",
    logline: "測試",
    genre: "drama",
    targetAudience: "general",
    characters: [],
    scenes: [],
    lore: [],
    styleProfiles: [],
    defaultStyleProfileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const SEG_1 = {
  segmentId: "seg-a",
  storyboard: {
    sceneHeading: "INT. 辦公室",
    visualDescription: "主角看著窗外",
    dialogue: "未來在哪裡？",
    soundDesign: "環境音",
    cameraDirection: "中景",
    duration: "00:00:05",
    mood: "思考",
  },
  characters: [],
  locations: [],
  visualPrompt: "a person looking out the window, cinematic",
  musicVibe: "ambient melancholy",
  audioScript: "窗外的世界如此喧囂",
};

const SEG_2 = {
  segmentId: "seg-b",
  storyboard: {
    sceneHeading: "EXT. 街道",
    visualDescription: "繁忙的人潮",
    dialogue: "",
    soundDesign: "城市雜音",
    cameraDirection: "廣角",
    duration: "00:00:03",
    mood: "活力",
  },
  characters: [],
  locations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorldbuildingFrameworkMock.mockResolvedValue(makeFramework());
  createWorldStoryboardMock.mockResolvedValue(42);
});

describe("AIDV-151 queueForVideo", () => {
  it("正常流程：jobsJson 有 queued + productionStatus=in_progress + 返回 id/sceneCount", async () => {
    const caller = makeCaller();
    const result = await caller.queueForVideo({
      worldId: 1,
      name: "測試佇列",
      segments: [SEG_1, SEG_2],
    });

    expect(result.id).toBe(42);
    expect(result.sceneCount).toBe(2);
    expect(result.totalDurationSec).toBeGreaterThan(0);

    const call = createWorldStoryboardMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call.productionStatus).toBe("in_progress");

    const jobs = call.jobsJson as Record<string, Record<string, unknown>>;
    expect(jobs["seg-a"]?.status).toBe("queued");
    expect(jobs["seg-b"]?.status).toBe("queued");
  });

  it("visualPrompt 從 CO-STAR 帶入 jobsJson", async () => {
    const caller = makeCaller();
    await caller.queueForVideo({
      worldId: 1,
      name: "CO-STAR 佇列",
      segments: [SEG_1, SEG_2],
    });

    const call = createWorldStoryboardMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const jobs = call.jobsJson as Record<string, Record<string, unknown>>;
    expect(jobs["seg-a"]?.visualPrompt).toBe(SEG_1.visualPrompt);
    expect(jobs["seg-a"]?.musicVibe).toBe(SEG_1.musicVibe);
    expect(jobs["seg-a"]?.audioScript).toBe(SEG_1.audioScript);
    // seg-b 無 visualPrompt → fallback 到 storyboard.visualDescription
    expect(jobs["seg-b"]?.visualPrompt).toBe(SEG_2.storyboard.visualDescription);
  });

  it("sceneId 對應到 segmentId（jobsJson key 正確）", async () => {
    const caller = makeCaller();
    await caller.queueForVideo({
      worldId: 1,
      name: "ID 測試",
      segments: [SEG_1],
    });

    const call = createWorldStoryboardMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const jobs = call.jobsJson as Record<string, Record<string, unknown>>;
    expect(Object.keys(jobs)).toContain("seg-a");
    const scenes = call.scenesJson as Array<Record<string, unknown>>;
    expect(scenes[0].id).toBe("seg-a");
  });

  it("世界觀不存在（null）→ NOT_FOUND", async () => {
    getWorldbuildingFrameworkMock.mockResolvedValue(null);
    const caller = makeCaller();
    await expect(
      caller.queueForVideo({
        worldId: 999,
        name: "不存在",
        segments: [SEG_1],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(createWorldStoryboardMock).not.toHaveBeenCalled();
  });

  it("帶 sourceScriptId → 傳遞至 db.createWorldStoryboard", async () => {
    const caller = makeCaller();
    await caller.queueForVideo({
      worldId: 1,
      name: "含 scriptId",
      segments: [SEG_1],
      sourceScriptId: "script-xyz",
    });

    const call = createWorldStoryboardMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(call.sourceScriptId).toBe("script-xyz");
  });
});

// ── AIDV-636: updateJob 原子寫入防並發 lost-update ────────────────────────
describe("AIDV-636 updateJob — 原子更新", () => {
  const STORYBOARD_ID = 99;

  function makeRow(jobsJson: Record<string, unknown> = {}) {
    return {
      id: STORYBOARD_ID,
      userId: USER_ID,
      worldId: 1,
      name: "test",
      jobsJson,
      productionStatus: "in_progress",
      scenesJson: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  beforeEach(() => {
    updateWorldStoryboardJobAtomicMock.mockResolvedValue(undefined);
  });

  it("呼叫 updateWorldStoryboardJobAtomic 而非整欄覆寫", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeRow({ "seg-a": { status: "queued" } })
    );
    const caller = makeCaller();

    await caller.updateJob({
      id: STORYBOARD_ID,
      stepId: "seg-a",
      status: "running",
    });

    expect(updateWorldStoryboardJobAtomicMock).toHaveBeenCalledOnce();
    const [id, stepId, jobData] =
      updateWorldStoryboardJobAtomicMock.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ];
    expect(id).toBe(STORYBOARD_ID);
    expect(stepId).toBe("seg-a");
    expect(jobData.status).toBe("running");
    expect(typeof jobData.updatedAt).toBe("string");
  });

  it("並發寫不同 stepId — 兩次各自呼叫原子更新，不互相覆蓋", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeRow({
        "seg-a": { status: "queued" },
        "seg-b": { status: "queued" },
      })
    );
    const caller = makeCaller();

    await Promise.all([
      caller.updateJob({ id: STORYBOARD_ID, stepId: "seg-a", status: "running" }),
      caller.updateJob({ id: STORYBOARD_ID, stepId: "seg-b", status: "running" }),
    ]);

    expect(updateWorldStoryboardJobAtomicMock).toHaveBeenCalledTimes(2);
    const stepIds = updateWorldStoryboardJobAtomicMock.mock.calls.map(
      (c) => (c as [number, string, unknown])[1]
    );
    expect(stepIds).toContain("seg-a");
    expect(stepIds).toContain("seg-b");
  });

  it("非法狀態轉移 → UNPROCESSABLE_CONTENT，不呼叫 DB 寫入", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeRow({ "seg-a": { status: "done" } })
    );
    const caller = makeCaller();

    await expect(
      caller.updateJob({ id: STORYBOARD_ID, stepId: "seg-a", status: "queued" })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });

    expect(updateWorldStoryboardJobAtomicMock).not.toHaveBeenCalled();
  });

  it("storyboard 不存在 → NOT_FOUND", async () => {
    getWorldStoryboardMock.mockResolvedValue(null);
    const caller = makeCaller();

    await expect(
      caller.updateJob({ id: 9999, stepId: "seg-a", status: "running" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(updateWorldStoryboardJobAtomicMock).not.toHaveBeenCalled();
  });
});
