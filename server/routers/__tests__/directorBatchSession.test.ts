/**
 * AIDV-50: directorBatchSession.test.ts
 *
 * batchGenerateWithSession — CO-STAR 批次生成 + videoSession 狀態機追蹤。
 *
 * 驗收：
 *   ✅ 無 storyboardId：純 CO-STAR 生成，不碰 DB session
 *   ✅ 帶 storyboardId（planning → in_progress → completed）：jobsJson 落 success
 *   ✅ 帶 storyboardId + voiceAssetId/musicAssetId：persisted 至 jobsJson
 *   ✅ 非法 session 狀態轉移（completed → in_progress）→ UNPROCESSABLE_CONTENT
 *   ✅ 非擁有者 storyboard → NOT_FOUND
 *   ✅ LLM 部分未回傳 segment → 標 failed；session → failed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock: buildBrainContext ────────────────────────────────────────────────
vi.mock("../../middleware/brainContext", () => ({
  buildBrainContext: vi.fn(async () => ({
    getBrain: () => ({
      model: "test-model",
      temperature: 0.7,
      topP: 0.9,
      systemPrompt: "test-system",
    }),
    getEngine: () => undefined,
  })),
}));

// ── mock: invokeLLM ────────────────────────────────────────────────────────
const invokeLLMMock = vi.fn();
vi.mock("../../_core/llm", () => ({
  invokeLLM: (...a: unknown[]) => invokeLLMMock(...a),
  extractMessageText: vi.fn(),
}));

// ── mock: withTimeout + extractMessageJson ─────────────────────────────────
const extractMessageJsonMock = vi.fn();
vi.mock("../../services/director/templates", async importActual => {
  const actual = await importActual<
    typeof import("../../services/director/templates")
  >();
  return {
    ...actual,
    withTimeout: (p: Promise<unknown>) => p, // pass-through
    extractMessageJson: (...a: unknown[]) => extractMessageJsonMock(...a),
    DIRECTOR_TEMPLATES: actual.DIRECTOR_TEMPLATES,
    QUICK_ACTIONS: actual.QUICK_ACTIONS,
  };
});

// ── mock: db ───────────────────────────────────────────────────────────────
const getWorldStoryboardMock = vi.fn();
const updateWorldStoryboardMock = vi.fn();
vi.mock("../../db", () => ({
  getWorldStoryboard: (...a: unknown[]) => getWorldStoryboardMock(...a),
  updateWorldStoryboard: (...a: unknown[]) => updateWorldStoryboardMock(...a),
  // other db fns used transitively (director router imports these)
  getProjectNote: vi.fn(async () => null),
  deleteProjectNote: vi.fn(async () => {}),
  createProjectNote: vi.fn(async () => 1),
  getProjectsByUserId: vi.fn(async () => []),
  getCreativeProject: vi.fn(async () => null),
  getWorldbuildingFramework: vi.fn(async () => null),
  getUserPreferences: vi.fn(async () => null),
  getNotesByUserId: vi.fn(async () => []),
  upsertMemoryEntry: vi.fn(async () => {}),
  getMemoryEntries: vi.fn(async () => []),
}));

import { directorRouter } from "../director";

// ── helpers ───────────────────────────────────────────────────────────────

const USER_ID = 42;

function makeCaller(userId = USER_ID) {
  const ctx = {
    user: { id: userId, role: "user" },
    req: {} as never,
    res: {} as never,
    orbTraceId: "test-trace",
  } as never;
  return directorRouter.createCaller(ctx);
}

const SEG_A = {
  id: "seg-1",
  index: 0,
  rawText: "場景一文字",
  storyboard: {
    sceneHeading: "INT. 辦公室",
    visualDescription: "主角看著窗外",
    dialogue: "未來在哪裡？",
    soundDesign: "環境音",
    cameraDirection: "中景",
    duration: "00:00:05",
    mood: "思考",
  },
};

const SEG_B = {
  id: "seg-2",
  index: 1,
  rawText: "場景二文字",
  storyboard: {
    sceneHeading: "EXT. 街道",
    visualDescription: "繁忙的人潮",
    dialogue: "",
    soundDesign: "城市雜音",
    cameraDirection: "廣角",
    duration: "00:00:03",
    mood: "活力",
  },
};

const MOCK_LLM_RESPONSE = {
  results: [
    {
      segmentId: "seg-1",
      context: "城市背景",
      situation: "主角思考",
      task: "傳達孤獨感",
      action: "拍攝特寫",
      result: "引發共鳴",
      visualPrompt: "a person looking out the window",
      audioScript: "窗外的世界如此喧囂",
      musicVibe: "ambient melancholy",
      proactiveQuestion: "主角的背景故事是？",
    },
    {
      segmentId: "seg-2",
      context: "城市場景",
      situation: "繁忙街道",
      task: "呈現對比",
      action: "廣角掃描",
      result: "視覺衝擊",
      visualPrompt: "busy city street wide angle",
      audioScript: "人來人往，生命不息",
      musicVibe: "energetic urban",
      proactiveQuestion: "這個城市代表什麼？",
    },
  ],
};

function makeStoryboardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: USER_ID,
    worldId: 1,
    name: "測試分鏡",
    totalDurationSec: 10,
    fps: 24,
    aspectRatio: "16:9",
    scenesJson: [],
    sourceScriptId: null,
    narration: null,
    productionStatus: "planning",
    finalVideoUrl: null,
    estimatedCostUsd: null,
    pipelinePlanJson: null,
    jobsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invokeLLMMock.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify(MOCK_LLM_RESPONSE),
        },
      },
    ],
  });
  extractMessageJsonMock.mockReturnValue(MOCK_LLM_RESPONSE);
});

describe("AIDV-50 batchGenerateWithSession", () => {
  it("無 storyboardId：純 CO-STAR 生成，不碰 DB", async () => {
    const caller = makeCaller();
    const result = await caller.batchGenerateWithSession({
      segments: [SEG_A, SEG_B],
      personality: "creative",
    });

    expect(result.results["seg-1"]).toBeDefined();
    expect(result.results["seg-2"]).toBeDefined();
    expect(getWorldStoryboardMock).not.toHaveBeenCalled();
    expect(updateWorldStoryboardMock).not.toHaveBeenCalled();
  });

  it("帶 storyboardId：planning → in_progress → completed；jobsJson 落 success", async () => {
    getWorldStoryboardMock.mockResolvedValue(makeStoryboardRow());

    const caller = makeCaller();
    await caller.batchGenerateWithSession({
      segments: [SEG_A, SEG_B],
      personality: "creative",
      storyboardId: 7,
    });

    // First DB write: transition to in_progress + queue all segments
    const firstWrite = updateWorldStoryboardMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(firstWrite[0]).toBe(7);
    expect(firstWrite[1].productionStatus).toBe("in_progress");
    const firstJobs = firstWrite[1].jobsJson as Record<
      string,
      Record<string, unknown>
    >;
    expect(firstJobs["seg-1"]?.status).toBe("queued");
    expect(firstJobs["seg-2"]?.status).toBe("queued");

    // Second DB write: completed + success for all segments
    const secondWrite = updateWorldStoryboardMock.mock.calls[1] as [
      number,
      Record<string, unknown>,
    ];
    expect(secondWrite[1].productionStatus).toBe("completed");
    const finalJobs = secondWrite[1].jobsJson as Record<
      string,
      Record<string, unknown>
    >;
    expect(finalJobs["seg-1"]?.status).toBe("success");
    expect(finalJobs["seg-2"]?.status).toBe("success");
  });

  it("voiceAssetId / musicAssetId persisted 至 jobsJson", async () => {
    getWorldStoryboardMock.mockResolvedValue(makeStoryboardRow());

    const caller = makeCaller();
    await caller.batchGenerateWithSession({
      segments: [
        { ...SEG_A, voiceAssetId: "v-001", musicAssetId: "m-002" },
        SEG_B,
      ],
      personality: "creative",
      storyboardId: 7,
    });

    const secondWrite = updateWorldStoryboardMock.mock.calls[1] as [
      number,
      Record<string, unknown>,
    ];
    const finalJobs = secondWrite[1].jobsJson as Record<
      string,
      Record<string, unknown>
    >;
    expect(finalJobs["seg-1"]?.voiceAssetId).toBe("v-001");
    expect(finalJobs["seg-1"]?.musicAssetId).toBe("m-002");
    // seg-2 沒有 voiceAssetId/musicAssetId → undefined
    expect(finalJobs["seg-2"]?.voiceAssetId).toBeUndefined();
  });

  it("非法 session 狀態轉移（completed → in_progress）→ UNPROCESSABLE_CONTENT", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeStoryboardRow({ productionStatus: "completed" })
    );

    const caller = makeCaller();
    await expect(
      caller.batchGenerateWithSession({
        segments: [SEG_A],
        personality: "creative",
        storyboardId: 7,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });

    // Should not have called updateWorldStoryboard at all
    expect(updateWorldStoryboardMock).not.toHaveBeenCalled();
  });

  it("非擁有者 storyboard → NOT_FOUND", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeStoryboardRow({ userId: USER_ID + 99 })
    );

    const caller = makeCaller();
    await expect(
      caller.batchGenerateWithSession({
        segments: [SEG_A],
        personality: "creative",
        storyboardId: 7,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("storyboard 不存在（null）→ NOT_FOUND", async () => {
    getWorldStoryboardMock.mockResolvedValue(null);

    const caller = makeCaller();
    await expect(
      caller.batchGenerateWithSession({
        segments: [SEG_A],
        personality: "creative",
        storyboardId: 99,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("LLM 只回傳部分 segment → 未回傳者標 failed；session → failed", async () => {
    getWorldStoryboardMock.mockResolvedValue(makeStoryboardRow());
    // LLM only returns seg-1, not seg-2
    extractMessageJsonMock.mockReturnValue({
      results: [MOCK_LLM_RESPONSE.results[0]],
    });

    const caller = makeCaller();
    const result = await caller.batchGenerateWithSession({
      segments: [SEG_A, SEG_B],
      personality: "creative",
      storyboardId: 7,
    });

    expect(result.results["seg-1"]).toBeDefined();
    expect(result.results["seg-2"]).toBeUndefined();

    const secondWrite = updateWorldStoryboardMock.mock.calls[1] as [
      number,
      Record<string, unknown>,
    ];
    expect(secondWrite[1].productionStatus).toBe("failed");
    const finalJobs = secondWrite[1].jobsJson as Record<
      string,
      Record<string, unknown>
    >;
    expect(finalJobs["seg-1"]?.status).toBe("success");
    expect(finalJobs["seg-2"]?.status).toBe("failed");
  });

  it("failed session 可重啟（failed → in_progress）", async () => {
    getWorldStoryboardMock.mockResolvedValue(
      makeStoryboardRow({ productionStatus: "failed" })
    );

    const caller = makeCaller();
    const result = await caller.batchGenerateWithSession({
      segments: [SEG_A],
      personality: "calm",
      storyboardId: 7,
    });

    expect(result.results["seg-1"]).toBeDefined();
    const firstWrite = updateWorldStoryboardMock.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(firstWrite[1].productionStatus).toBe("in_progress");
  });
});
