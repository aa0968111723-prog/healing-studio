/**
 * worldbuildingRouter.test.ts — 世界觀時間軸 / 構圖端點驗收
 *
 * HEAD 版本已實作 DB 持久化（無 ENABLE_WORLDBUILDING_PERSIST flag guard）。
 * 驗收 8 個端點在 DB mock 下正確運作。
 */

import { describe, it, expect, vi } from "vitest";

// ─── db mock ─────────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({
  getWorldbuildingFrameworksByUser: vi.fn(async () => []),
  getWorldbuildingFramework: vi.fn(async () => null),
  createWorldbuildingFramework: vi.fn(async () => 1),
  updateWorldbuildingFramework: vi.fn(async () => {}),
  deleteWorldbuildingFramework: vi.fn(async () => {}),
  getFineTunedModelsByUser: vi.fn(async () => []),
  listTimelineFramesByStoryboard: vi.fn(async () => [
    {
      id: 1,
      storyboardId: 1,
      sceneId: "scene-1",
      userId: 99,
      timeOffsetSec: "0",
      imageUrl: "https://example.com/frame.png",
      frameType: "keyframe",
      title: null,
      description: null,
      tags: null,
      consistencyCheckJson: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  createTimelineFrame: vi.fn(async () => 1),
  getTimelineFrame: vi.fn(async () => ({
    id: 1,
    storyboardId: 1,
    sceneId: "scene-1",
    userId: 99,
    timeOffsetSec: "0",
    imageUrl: "https://example.com/frame.png",
    frameType: "keyframe",
    title: null,
    description: null,
    tags: null,
    consistencyCheckJson: null,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  })),
  deleteTimelineFrame: vi.fn(async () => {}),
  updateTimelineFrameConsistency: vi.fn(async () => {}),
  listSceneCompositions: vi.fn(async () => [
    {
      id: 1,
      worldId: 1,
      storyboardId: null,
      userId: 99,
      name: "test-composition",
      description: null,
      canvasWidth: 1920,
      canvasHeight: 1080,
      backgroundSceneId: null,
      backgroundImageUrl: null,
      elementsJson: [],
      aiSuggestionsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  createSceneComposition: vi.fn(async () => 1),
  deleteSceneComposition: vi.fn(async () => {}),
}));

import { worldbuildingRouter } from "../worldbuilding";

// ─── caller helper ────────────────────────────────────────────────────────────

function caller(userId = 99) {
  return worldbuildingRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any);
}

// ─── minimal valid inputs ─────────────────────────────────────────────────────

const validTimelineFrameInput = {
  storyboardId: 1,
  sceneId: "scene-1",
  timeOffsetSec: 0,
  imageUrl: "https://example.com/frame.png",
  frameType: "keyframe" as const,
};

const validConsistencyCheckInput = {
  timelineFrameId: 1,
};

const validCompositionInput = {
  worldId: 1,
  name: "test-composition",
  canvasWidth: 1920,
  canvasHeight: 1080,
  elements: [],
};

const validCompositionSuggestionInput = {
  worldId: 1,
  elements: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("worldbuilding router — 時間軸 / 構圖 8 端點（DB 已實作）", () => {
  it("listTimelineFrames → 不拋，回傳陣列", async () => {
    const c = caller();
    const result = await c.listTimelineFrames({ storyboardId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("uploadTimelineFrame → 不拋，回傳 TimelineFrame", async () => {
    const c = caller();
    const result = await c.uploadTimelineFrame(validTimelineFrameInput);
    expect(result).toMatchObject({ id: 1, storyboardId: 1, sceneId: "scene-1" });
  });

  it("deleteTimelineFrame → 不拋，回傳 frameId", async () => {
    const c = caller();
    const result = await c.deleteTimelineFrame(1);
    expect(result).toBe(1);
  });

  it("checkConsistency → 不拋，回傳 ConsistencyCheckResult", async () => {
    const c = caller();
    const result = await c.checkConsistency(validConsistencyCheckInput);
    expect(result).toMatchObject({ overallScore: expect.any(Number) });
  });

  it("listCompositions → 不拋，回傳陣列", async () => {
    const c = caller();
    const result = await c.listCompositions({ worldId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("saveComposition → 不拋，回傳 SceneComposition", async () => {
    const c = caller();
    const result = await c.saveComposition(validCompositionInput);
    expect(result).toMatchObject({ worldId: 1, name: "test-composition" });
  });

  it("deleteComposition → 不拋，回傳 compositionId", async () => {
    const c = caller();
    const result = await c.deleteComposition(1);
    expect(result).toBe(1);
  });

  it("getCompositionSuggestions → 不拋，回傳建議陣列", async () => {
    const c = caller();
    const result = await c.getCompositionSuggestions(validCompositionSuggestionInput);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
