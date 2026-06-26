/**
 * worldbuildingRouter.test.ts — AIDV-187 P1 止血驗收
 *
 * 驗收（AIDV-187 工作表）：
 *   1. ENABLE_WORLDBUILDING_PERSIST 未設（預設 OFF）
 *      → 8 個持久化端點全部拋 METHOD_NOT_SUPPORTED
 *   2. ENABLE_WORLDBUILDING_PERSIST=1（flag ON）
 *      → 端點不再拋（通過 guard），各自執行至末尾
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── db mock ─────────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({
  getWorldbuildingFrameworksByUser: vi.fn(async () => []),
  getWorldbuildingFramework: vi.fn(async () => null),
  createWorldbuildingFramework: vi.fn(async () => 1),
  updateWorldbuildingFramework: vi.fn(async () => {}),
  deleteWorldbuildingFramework: vi.fn(async () => {}),
  getFineTunedModelsByUser: vi.fn(async () => []),
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

// ─── Flag OFF (預設) ─────────────────────────────────────────────────────────

describe("ENABLE_WORLDBUILDING_PERSIST=OFF（預設）→ 8 端點全回 METHOD_NOT_SUPPORTED", () => {
  beforeEach(() => {
    delete process.env.ENABLE_WORLDBUILDING_PERSIST;
  });

  afterEach(() => {
    delete process.env.ENABLE_WORLDBUILDING_PERSIST;
  });

  it("listTimelineFrames → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.listTimelineFrames({ storyboardId: 1 })).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("uploadTimelineFrame → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.uploadTimelineFrame(validTimelineFrameInput)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("deleteTimelineFrame → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.deleteTimelineFrame(1)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("checkConsistency → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.checkConsistency(validConsistencyCheckInput)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("listCompositions → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.listCompositions({ worldId: 1 })).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("saveComposition → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.saveComposition(validCompositionInput)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("deleteComposition → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.deleteComposition(1)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("getCompositionSuggestions → METHOD_NOT_SUPPORTED", async () => {
    const c = caller();
    await expect(c.getCompositionSuggestions(validCompositionSuggestionInput)).rejects.toMatchObject({
      code: "METHOD_NOT_SUPPORTED",
    });
  });

  it("錯誤訊息含有 ENABLE_WORLDBUILDING_PERSIST 字串", async () => {
    const c = caller();
    let err: TRPCError | undefined;
    try {
      await c.listTimelineFrames({ storyboardId: 1 });
    } catch (e: any) {
      err = e;
    }
    expect(err?.message).toContain("ENABLE_WORLDBUILDING_PERSIST");
  });
});

// ─── Flag ON → guard 通過，不拋錯 ────────────────────────────────────────────

describe("ENABLE_WORLDBUILDING_PERSIST=1（flag ON）→ guard 通過", () => {
  beforeEach(() => {
    process.env.ENABLE_WORLDBUILDING_PERSIST = "1";
  });

  afterEach(() => {
    delete process.env.ENABLE_WORLDBUILDING_PERSIST;
  });

  it("listTimelineFrames → 不拋，回傳陣列", async () => {
    const c = caller();
    const result = await c.listTimelineFrames({ storyboardId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("listCompositions → 不拋，回傳陣列", async () => {
    const c = caller();
    const result = await c.listCompositions({ worldId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("uploadTimelineFrame → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.uploadTimelineFrame(validTimelineFrameInput)).resolves.toBeUndefined();
  });

  it("deleteTimelineFrame → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.deleteTimelineFrame(1)).resolves.toBeUndefined();
  });

  it("checkConsistency → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.checkConsistency(validConsistencyCheckInput)).resolves.toBeUndefined();
  });

  it("saveComposition → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.saveComposition(validCompositionInput)).resolves.toBeUndefined();
  });

  it("deleteComposition → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.deleteComposition(1)).resolves.toBeUndefined();
  });

  it("getCompositionSuggestions → 不拋（stub 階段，回傳 undefined）", async () => {
    const c = caller();
    await expect(c.getCompositionSuggestions(validCompositionSuggestionInput)).resolves.toBeUndefined();
  });
});
