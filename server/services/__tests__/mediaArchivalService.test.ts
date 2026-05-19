/**
 * mediaArchivalService.test.ts — runMediaArchival 整合測試
 *
 * 場景：generationHistory 有一筆 archivedAt IS NULL 的外部 URL（fal cdn）。
 * 跑 runMediaArchival() 之後，該筆 row 的 resultUrl 應該被改為自家
 * storage 的內部 URL，sourceUrl 保留原始外部 URL，archivedAt 寫入時間戳。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../storage", () => ({
  detectStorageBackend: () => "s3",
}));

vi.mock("../internalMedia", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../internalMedia")>();
  return {
    ...actual,
    persistExternalMediaUrl: vi.fn(),
  };
});

import { getDb } from "../../db";
import { persistExternalMediaUrl } from "../internalMedia";
import {
  digitalAssetLibrary,
  generationHistory,
  type GenerationHistoryItem,
} from "../../../drizzle/schema";
import { runMediaArchival } from "../mediaArchivalService";

describe("runMediaArchival (integration)", () => {
  let updates: Array<{ table: unknown; data: Record<string, unknown> }>;

  beforeEach(() => {
    updates = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("把 generationHistory 含外部 URL 的 row 歸檔到自家 storage 並寫入 archivedAt", async () => {
    const externalUrl = "https://v2.fal.media/files/elephant/abc.png";
    const internalUrl =
      "https://pub-xxx.r2.dev/archived/image/7/1700000000-deadbeef.png";

    // 待歸檔的 generation_history fixture：archivedAt IS NULL + 外部 URL
    const historyRow: GenerationHistoryItem = {
      id: 42,
      userId: 7,
      requestId: null,
      modality: "image",
      prompt: "a cute cat",
      compiledPrompt: null,
      parameterSnapshot: null,
      resultUrl: externalUrl,
      thumbnailUrl: null,
      userRating: null,
      isBookmarked: false,
      costCredits: 1,
      durationMs: null,
      sourceUrl: null,
      provider: null,
      archivedAt: null,
      expiresAt: null,
      archivalChecksum: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };

    // Drizzle chain fake：
    //   - select().from(generationHistory) → 回我們那筆 row
    //   - select().from(digitalAssetLibrary) → 空陣列（這條 case 不關心）
    //   - update(table).set(data).where(...) → 把 (table, data) 記下來給斷言用
    (vi.mocked(getDb) as any).mockResolvedValue({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () =>
                table === generationHistory ? [historyRow] : [],
            }),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table, data });
          },
        }),
      }),
    });

    vi.mocked(persistExternalMediaUrl).mockResolvedValue(internalUrl);

    const result = await runMediaArchival();

    // runMediaArchival 應該回報歷史端歸檔了 1 筆、資產庫端 0 筆
    expect(result.history.total).toBe(1);
    expect(result.history.archived).toBe(1);
    expect(result.history.failed).toBe(0);
    expect(result.assets.total).toBe(0);

    // persistExternalMediaUrl 應該被以原始外部 URL + image category 呼叫一次
    expect(persistExternalMediaUrl).toHaveBeenCalledTimes(1);
    expect(persistExternalMediaUrl).toHaveBeenCalledWith(
      externalUrl,
      expect.objectContaining({ category: "image" })
    );

    // 我們應該對 generation_history 表跑一次 update，
    // resultUrl 換成內部、sourceUrl 保留原外部、archivedAt 是 Date。
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(generationHistory);
    expect(updates[0].data.resultUrl).toBe(internalUrl);
    expect(updates[0].data.sourceUrl).toBe(externalUrl);
    expect(updates[0].data.archivedAt).toBeInstanceOf(Date);
    expect(updates[0].data.provider).toBe("s3");
  });

  it("已 archivedAt 的 row 不會被重複歸檔（idempotency）", async () => {
    const alreadyArchivedRow: GenerationHistoryItem = {
      id: 99,
      userId: 7,
      requestId: null,
      modality: "image",
      prompt: null,
      compiledPrompt: null,
      parameterSnapshot: null,
      resultUrl: "https://v2.fal.media/files/elephant/already.png",
      thumbnailUrl: null,
      userRating: null,
      isBookmarked: false,
      costCredits: 1,
      durationMs: null,
      sourceUrl: "https://v2.fal.media/files/elephant/already.png",
      provider: "s3",
      archivedAt: new Date("2026-05-10T00:00:00Z"),
      expiresAt: null,
      archivalChecksum: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };

    (vi.mocked(getDb) as any).mockResolvedValue({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () =>
                table === generationHistory ? [alreadyArchivedRow] : [],
            }),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ table, data });
          },
        }),
      }),
    });

    const result = await runMediaArchival();

    // archiveHistoryEntry 在 archivedAt !== null 時直接 return，不下載也不 UPDATE
    expect(persistExternalMediaUrl).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result.history.skipped).toBe(1);
    expect(result.history.archived).toBe(0);
  });
});
