/**
 * server/history-rating-model-pick.test.ts
 *
 * AIDV-62: when history.rate fires with rating >= 4, a model pick is written
 * to agent_model_picks so that the evaluation feeds back into future model
 * recommendations (getPreferredModelsForModality weightings).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  updateHistoryEntry: vi.fn().mockResolvedValue(undefined),
  getHistoryEntry: vi.fn(),
  getDb: async () => null,
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("./services/agentModelPicks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/agentModelPicks")>();
  return { ...actual, recordModelPick: vi.fn().mockResolvedValue(1) };
});

import * as dbMod from "./db";
import * as agentPicksMod from "./services/agentModelPicks";
import { appRouter } from "./routers";

function createMockContext(user: { id: number; email: string } | null) {
  return { user, req: {} as never, res: {} as never };
}

beforeEach(() => {
  vi.mocked(dbMod.updateHistoryEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(dbMod.getHistoryEntry).mockReset();
  vi.mocked(agentPicksMod.recordModelPick).mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("history.rate → agentModelPicks feedback loop (AIDV-62)", () => {
  it("records a model pick with accepted=true when rating >= 4 and snapshot has modelId", async () => {
    vi.mocked(dbMod.getHistoryEntry).mockResolvedValueOnce({
      id: 42,
      userId: 7,
      modality: "image",
      parameterSnapshot: { modelId: "fal-flux-schnell", sourceStudio: "image_studio" },
      userRating: null,
      isBookmarked: false,
      costCredits: 1,
      prompt: null,
      compiledPrompt: null,
      resultUrl: null,
      thumbnailUrl: null,
      durationMs: null,
      requestId: null,
      sourceUrl: null,
      provider: null,
      archivedAt: null,
      expiresAt: null,
      archivalChecksum: null,
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createMockContext({ id: 7, email: "t@t.com" }) as never);
    const result = await caller.history.rate({ id: 42, rating: 4 });

    expect(result).toEqual({ success: true });
    expect(dbMod.updateHistoryEntry).toHaveBeenCalledWith(42, { userRating: 4 });

    await new Promise(r => setTimeout(r, 20));
    expect(dbMod.getHistoryEntry).toHaveBeenCalledWith(42, 7);
    expect(agentPicksMod.recordModelPick).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        modality: "image",
        modelId: "fal-flux-schnell",
        source: "history",
        accepted: true,
      })
    );
  });

  it("does NOT record a model pick when rating < 4 (but still verifies ownership)", async () => {
    // AIDV-609: rate now verifies ownership up-front via getHistoryEntry(id, userId).
    // The entry exists & is owned → mutation proceeds; rating < 4 → no model pick.
    vi.mocked(dbMod.getHistoryEntry).mockResolvedValueOnce({
      id: 42,
      userId: 7,
      modality: "image",
      parameterSnapshot: { modelId: "fal-flux-schnell" },
      userRating: null,
      isBookmarked: false,
      costCredits: 1,
      prompt: null,
      compiledPrompt: null,
      resultUrl: null,
      thumbnailUrl: null,
      durationMs: null,
      requestId: null,
      sourceUrl: null,
      provider: null,
      archivedAt: null,
      expiresAt: null,
      archivalChecksum: null,
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createMockContext({ id: 7, email: "t@t.com" }) as never);
    const result = await caller.history.rate({ id: 42, rating: 3 });

    expect(result).toEqual({ success: true });
    expect(dbMod.getHistoryEntry).toHaveBeenCalledWith(42, 7);
    await new Promise(r => setTimeout(r, 20));
    expect(agentPicksMod.recordModelPick).not.toHaveBeenCalled();
  });

  it("does NOT record a pick when parameterSnapshot has no modelId", async () => {
    vi.mocked(dbMod.getHistoryEntry).mockResolvedValueOnce({
      id: 99,
      userId: 7,
      modality: "video",
      parameterSnapshot: { sourceStudio: "video_studio" },
      userRating: null,
      isBookmarked: false,
      costCredits: 1,
      prompt: null,
      compiledPrompt: null,
      resultUrl: null,
      thumbnailUrl: null,
      durationMs: null,
      requestId: null,
      sourceUrl: null,
      provider: null,
      archivedAt: null,
      expiresAt: null,
      archivalChecksum: null,
      createdAt: new Date(),
    });

    const caller = appRouter.createCaller(createMockContext({ id: 7, email: "t@t.com" }) as never);
    await caller.history.rate({ id: 99, rating: 5 });

    await new Promise(r => setTimeout(r, 20));
    expect(agentPicksMod.recordModelPick).not.toHaveBeenCalled();
  });
});
