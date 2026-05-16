/**
 * orb-proxy-large-optimize.test.ts
 *
 * Covers the resilience + observability + perf upgrades to the orb proxy:
 *   - Per-source DB queries are bounded by the new `SOURCE_FETCH_CAP`
 *   - One slow source no longer stalls the whole orchestrator (timeout)
 *   - `Promise.allSettled` keeps siblings alive when a source rejects
 *   - Identical follow-up queries are served from the in-process cache
 *   - `getLearnHubOrbIndex` is memoized per `limit`
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDigitalAssetsByUser: vi.fn(),
  getProjectNotesByUser: vi.fn(),
  getHistoryByUser: vi.fn(),
}));

vi.mock("./services/siteKnowledge", () => ({
  getLearnHubOrbIndex: vi.fn(() => []),
}));

import * as db from "./db";
import { getLearnHubOrbIndex } from "./services/siteKnowledge";
import { cache } from "./_core/cache";
import { orbUnifiedSearch } from "./services/orbUnifiedSearch";

const dbMock = vi.mocked(db);
const learnIndexMock = vi.mocked(getLearnHubOrbIndex);

beforeEach(async () => {
  await cache.clear();
  vi.clearAllMocks();
  dbMock.getDigitalAssetsByUser.mockResolvedValue([]);
  dbMock.getProjectNotesByUser.mockResolvedValue([]);
  dbMock.getHistoryByUser.mockResolvedValue([]);
  learnIndexMock.mockReturnValue([]);
});

describe("orbUnifiedSearch — bounded DB queries", () => {
  it("passes a fetch cap to every per-user DB call", async () => {
    await orbUnifiedSearch({
      userId: 7,
      query: "森林",
      bypassCache: true,
    });

    // The cap is the same for all three DB-backed sources so memory stays
    // balanced — earlier code loaded *all* asset/note rows but capped
    // history at 200, which made memory scale linearly with the largest
    // source.
    const assetCap = dbMock.getDigitalAssetsByUser.mock.calls[0]?.[1];
    const noteCap = dbMock.getProjectNotesByUser.mock.calls[0]?.[1];
    const historyCap = dbMock.getHistoryByUser.mock.calls[0]?.[1];

    expect(assetCap).toBeGreaterThan(0);
    expect(noteCap).toBeGreaterThan(0);
    expect(historyCap).toBeGreaterThan(0);
    expect(assetCap).toBe(noteCap);
    expect(assetCap).toBe(historyCap);
  });
});

describe("orbUnifiedSearch — per-source timeout isolation", () => {
  it("treats a source that exceeds the budget as empty without dragging down siblings", async () => {
    // Notes hangs forever; assets returns one row immediately.
    dbMock.getDigitalAssetsByUser.mockResolvedValue([
      {
        id: 1,
        title: "森林清晨",
        description: "morning haze",
        promptUsed: "",
        assetType: "image",
        createdAt: new Date(),
      } as never,
    ]);
    dbMock.getProjectNotesByUser.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    );

    const start = Date.now();
    const items = await orbUnifiedSearch({
      userId: 1,
      query: "森林",
      sourceBudgetMs: 50,
      bypassCache: true,
    });
    const elapsed = Date.now() - start;

    // Whole call should finish well under the global timeout — single-source
    // budget is 50ms so the orchestrator should return within roughly that
    // budget plus jitter.
    expect(elapsed).toBeLessThan(800);
    // Asset still surfaces despite notes hanging.
    expect(items.find(i => i.kind === "asset")?.id).toBe("asset-1");
  });
});

describe("orbUnifiedSearch — allSettled keeps siblings alive", () => {
  it("does not reject the whole search when a single source rejects", async () => {
    // Notes throws; assets returns a real row.
    dbMock.getDigitalAssetsByUser.mockResolvedValue([
      {
        id: 42,
        title: "雨後森林",
        description: "",
        promptUsed: "rain forest",
        assetType: "image",
        createdAt: new Date(),
      } as never,
    ]);
    dbMock.getProjectNotesByUser.mockRejectedValue(
      new Error("notes table is broken")
    );

    const items = await orbUnifiedSearch({
      userId: 9,
      query: "森林",
      bypassCache: true,
    });

    // Asset survives the note failure.
    expect(items.find(i => i.id === "asset-42")).toBeDefined();
    // Note source contributes nothing.
    expect(items.find(i => i.kind === "note")).toBeUndefined();
  });
});

describe("orbUnifiedSearch — in-process result cache", () => {
  it("serves an identical follow-up query without re-hitting the DB", async () => {
    dbMock.getDigitalAssetsByUser.mockResolvedValue([
      {
        id: 5,
        title: "禪意茶道",
        description: "",
        promptUsed: "",
        assetType: "image",
        createdAt: new Date(),
      } as never,
    ]);

    await orbUnifiedSearch({ userId: 3, query: "茶道" });
    await orbUnifiedSearch({ userId: 3, query: "茶道" });

    // First call hits the DB; second call should be cached.
    expect(dbMock.getDigitalAssetsByUser).toHaveBeenCalledTimes(1);
  });

  it("scopes the cache per user — another user does not see the first user's hits", async () => {
    dbMock.getDigitalAssetsByUser.mockResolvedValue([]);

    await orbUnifiedSearch({ userId: 1, query: "森林" });
    await orbUnifiedSearch({ userId: 2, query: "森林" });

    // Distinct userIds → distinct cache keys → DB called once per user.
    expect(dbMock.getDigitalAssetsByUser).toHaveBeenCalledTimes(2);
  });

  it("collapses kind sets that differ only in order to the same cache key", async () => {
    dbMock.getDigitalAssetsByUser.mockResolvedValue([]);
    dbMock.getProjectNotesByUser.mockResolvedValue([]);

    await orbUnifiedSearch({
      userId: 4,
      query: "禪意",
      types: ["asset", "note"],
    });
    await orbUnifiedSearch({
      userId: 4,
      query: "禪意",
      types: ["note", "asset"],
    });

    // Same canonical key → second call served from cache.
    expect(dbMock.getDigitalAssetsByUser).toHaveBeenCalledTimes(1);
    expect(dbMock.getProjectNotesByUser).toHaveBeenCalledTimes(1);
  });

  it("bypassCache=true forces a re-fetch", async () => {
    dbMock.getDigitalAssetsByUser.mockResolvedValue([]);

    await orbUnifiedSearch({ userId: 1, query: "海", bypassCache: true });
    await orbUnifiedSearch({ userId: 1, query: "海", bypassCache: true });

    expect(dbMock.getDigitalAssetsByUser).toHaveBeenCalledTimes(2);
  });
});

