/**
 * server/agent-model-picks-store.test.ts
 *
 * The shared `agent_model_picks` table is what makes 導演 AI and 全站光球
 * "learn together" — every send-to-studio dispatch lands here, and every
 * surface (orb, director, studio defaults) reads from the same store.
 *
 * These tests pin the contract for the store helpers without needing a
 * live MySQL — the DB is mocked at the module boundary so we exercise the
 * routing / normalization logic, not the SQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const updateMock = vi.fn();
const selectMock = vi.fn();

function makeQueryBuilder() {
  const builder: Record<string, unknown> = {};
  // Each chain step returns the same builder so the terminal `.limit()`
  // (or `.where()` on update) can resolve via the corresponding mock.
  (builder as Record<string, (...a: unknown[]) => unknown>).from = () =>
    builder;
  (builder as Record<string, (...a: unknown[]) => unknown>).where = (
    ...args: unknown[]
  ) => {
    // For UPDATE chains, .where is the terminal — return updateMock's value.
    if (builder.__isUpdate) return updateMock(...args);
    return builder;
  };
  (builder as Record<string, (...a: unknown[]) => unknown>).orderBy = () =>
    builder;
  (builder as Record<string, (...a: unknown[]) => unknown>).groupBy = () =>
    builder;
  (builder as Record<string, (...a: unknown[]) => unknown>).limit = (
    ...args: unknown[]
  ) => selectMock(...args);
  (builder as Record<string, (...a: unknown[]) => unknown>).set = () => builder;
  return builder;
}

vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (...args: unknown[]) => insertMock(...args),
    }),
    select: () => makeQueryBuilder(),
    update: () => {
      const b = makeQueryBuilder();
      (b as Record<string, unknown>).__isUpdate = true;
      return b;
    },
  }),
}));

import {
  getPreferredModelsForModality,
  getRecentPicks,
  getTopPreferredModel,
  recordModelPick,
  updateLatestPickAcceptance,
} from "./services/agentModelPicks";

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ insertId: 11 });
  updateMock.mockReset().mockResolvedValue({ affectedRows: 1 });
  selectMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordModelPick", () => {
  it("persists a normalized row when called with a valid input", async () => {
    const id = await recordModelPick({
      userId: 7,
      modality: "imageGeneration",
      modelId: "fal-flux-schnell",
      source: "director_ai",
      context: { sceneHeading: "海邊清晨" },
    });
    expect(id).toBe(11);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    // imageGeneration must canonicalize to "image" so the read-side
    // groupBy actually groups across surfaces.
    expect(row.modality).toBe("image");
    expect(row.modelId).toBe("fal-flux-schnell");
    expect(row.source).toBe("director_ai");
    expect(row.context).toEqual({ sceneHeading: "海邊清晨" });
  });

  it("normalizes audio-family aliases (music → audio, tts → voice)", async () => {
    await recordModelPick({
      userId: 1,
      modality: "music",
      modelId: "suno-v4",
      source: "global_orb",
    });
    await recordModelPick({
      userId: 1,
      modality: "tts",
      modelId: "elevenlabs",
      source: "global_orb",
    });
    expect(insertMock.mock.calls[0][0].modality).toBe("audio");
    expect(insertMock.mock.calls[1][0].modality).toBe("voice");
  });

  it("returns null and skips the DB for anonymous users", async () => {
    const id = await recordModelPick({
      userId: 0,
      modality: "image",
      modelId: "x",
      source: "director_ai",
    });
    expect(id).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns null when modelId is empty whitespace", async () => {
    const id = await recordModelPick({
      userId: 7,
      modality: "image",
      modelId: "   ",
      source: "director_ai",
    });
    expect(id).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("never throws when the DB layer rejects — returns null instead", async () => {
    insertMock.mockRejectedValueOnce(new Error("connection lost"));
    const id = await recordModelPick({
      userId: 7,
      modality: "image",
      modelId: "fal-flux",
      source: "director_ai",
    });
    expect(id).toBeNull();
  });
});

describe("getPreferredModelsForModality / getTopPreferredModel", () => {
  it("returns ranked entries with numeric counts and ms-since-epoch timestamps", async () => {
    const fakeNow = new Date("2026-05-01T00:00:00Z");
    selectMock.mockResolvedValueOnce([
      {
        modelId: "fal-flux-schnell",
        pickCount: 5,
        acceptedCount: 3,
        lastPickedAt: fakeNow,
      },
      {
        modelId: "fal-sdxl",
        pickCount: 2,
        acceptedCount: 0,
        lastPickedAt: fakeNow,
      },
    ]);
    const entries = await getPreferredModelsForModality({
      userId: 7,
      modality: "image",
      topK: 3,
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].modelId).toBe("fal-flux-schnell");
    expect(entries[0].pickCount).toBe(5);
    expect(entries[0].acceptedCount).toBe(3);
    expect(entries[0].lastPickedAt).toBe(fakeNow.getTime());
  });

  it("returns empty array on DB failure (degrades gracefully)", async () => {
    selectMock.mockRejectedValueOnce(new Error("db gone"));
    const entries = await getPreferredModelsForModality({
      userId: 7,
      modality: "image",
    });
    expect(entries).toEqual([]);
  });

  it("returns empty array for anonymous users", async () => {
    const entries = await getPreferredModelsForModality({
      userId: 0,
      modality: "image",
    });
    expect(entries).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("getTopPreferredModel surfaces the leading modelId or null", async () => {
    selectMock.mockResolvedValueOnce([
      {
        modelId: "fal-flux-schnell",
        pickCount: 5,
        acceptedCount: 3,
        lastPickedAt: new Date(),
      },
    ]);
    const top = await getTopPreferredModel(7, "image");
    expect(top).toBe("fal-flux-schnell");

    selectMock.mockResolvedValueOnce([]);
    const empty = await getTopPreferredModel(7, "image");
    expect(empty).toBeNull();
  });
});

describe("updateLatestPickAcceptance", () => {
  it("updates the most recent matching pick when one exists", async () => {
    selectMock.mockResolvedValueOnce([{ id: 42 }]);
    const ok = await updateLatestPickAcceptance({
      userId: 7,
      modality: "image",
      modelId: "fal-flux-schnell",
      accepted: true,
    });
    expect(ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when no pick matches (no update fired)", async () => {
    selectMock.mockResolvedValueOnce([]);
    const ok = await updateLatestPickAcceptance({
      userId: 7,
      modality: "image",
      modelId: "fal-flux-schnell",
      accepted: false,
    });
    expect(ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("getRecentPicks", () => {
  it("returns rows for an authenticated user", async () => {
    selectMock.mockResolvedValueOnce([
      {
        id: 1,
        userId: 7,
        modality: "image",
        modelId: "x",
        source: "director_ai",
        accepted: null,
        context: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const rows = await getRecentPicks(7, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].modality).toBe("image");
  });

  it("returns empty array for anonymous users without hitting DB", async () => {
    const rows = await getRecentPicks(0, 5);
    expect(rows).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
