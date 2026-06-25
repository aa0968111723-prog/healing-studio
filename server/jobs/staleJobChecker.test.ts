/**
 * staleJobChecker.test.ts — AIDV-332 stale job 自動恢復邏輯
 *
 * 驗收條件：
 * - retryCount < 3：重新排隊並遞增 retryCount
 * - retryCount === 3：標記 failed 並觸發 SSE error 廣播
 * - 無卡住任務：不碰 updateBackgroundJob
 * - DB 回空陣列（no-DB 模式）：靜默跳過
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockGetStuck = vi.fn(async () => []);
const mockUpdate = vi.fn(async () => {});

vi.mock("../db.js", () => ({
  getStuckJobsByType: (...args: unknown[]) => mockGetStuck(...args),
  updateBackgroundJob: (...args: unknown[]) => mockUpdate(...args),
}));

// ─── generationBus mock ───────────────────────────────────────────────────────

const mockEmit = vi.fn();

vi.mock("../generationEvents.js", () => ({
  generationBus: { emit: (...args: unknown[]) => mockEmit(...args) },
}));

import { checkStaleJobs } from "./staleJobChecker";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(id: number, jobType = "video", retryCount?: number) {
  return {
    id,
    userId: 1,
    jobType,
    status: "processing" as const,
    resultJson: retryCount !== undefined ? { retryCount } : {},
    progressMessage: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 6 * 60 * 1000),
  };
}

beforeEach(() => {
  mockGetStuck.mockClear();
  mockUpdate.mockClear();
  mockEmit.mockClear();
  mockGetStuck.mockResolvedValue([]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("checkStaleJobs — AIDV-332", () => {
  it("無卡住任務時不呼叫 updateBackgroundJob", async () => {
    mockGetStuck.mockResolvedValue([]);
    await checkStaleJobs();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("retryCount=0 → 重新排隊並設 retryCount=1", async () => {
    const job = makeJob(10, "video", 0);
    mockGetStuck.mockImplementation(async (type: unknown) =>
      type === "video" ? [job] : []
    );

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(10, expect.objectContaining({
      status: "queued",
      resultJson: expect.objectContaining({ retryCount: 1 }),
    }));
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("retryCount=2（未設欄位）→ 視為 0，重新排隊 retryCount=1", async () => {
    const job = { ...makeJob(11, "audio"), resultJson: {} };
    mockGetStuck.mockImplementation(async (type: unknown) =>
      type === "audio" ? [job] : []
    );

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(11, expect.objectContaining({
      status: "queued",
      resultJson: expect.objectContaining({ retryCount: 1 }),
    }));
  });

  it("retryCount=2 → 重新排隊並設 retryCount=3", async () => {
    const job = makeJob(12, "image", 2);
    mockGetStuck.mockImplementation(async (type: unknown) =>
      type === "image" ? [job] : []
    );

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(12, expect.objectContaining({
      status: "queued",
      resultJson: expect.objectContaining({ retryCount: 3 }),
    }));
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("retryCount=3 → 標記 failed 並觸發 SSE error", async () => {
    const job = makeJob(13, "voice", 3);
    mockGetStuck.mockImplementation(async (type: unknown) =>
      type === "voice" ? [job] : []
    );

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(13, expect.objectContaining({
      status: "failed",
    }));
    expect(mockEmit).toHaveBeenCalledWith(13, expect.objectContaining({
      type: "error",
    }));
  });

  it("多個 jobType 各自獨立掃描", async () => {
    mockGetStuck.mockImplementation(async (type: unknown) => {
      if (type === "video") return [makeJob(20, "video", 0)];
      if (type === "audio") return [makeJob(21, "audio", 3)];
      return [];
    });

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(20, expect.objectContaining({ status: "queued" }));
    expect(mockUpdate).toHaveBeenCalledWith(21, expect.objectContaining({ status: "failed" }));
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("resultJson 中的其他欄位應保留（retryCount 合並而非覆蓋）", async () => {
    const job = { ...makeJob(30, "video"), resultJson: { predictionId: "abc123", retryCount: 1 } };
    mockGetStuck.mockImplementation(async (type: unknown) =>
      type === "video" ? [job] : []
    );

    await checkStaleJobs();

    expect(mockUpdate).toHaveBeenCalledWith(30, expect.objectContaining({
      resultJson: expect.objectContaining({
        predictionId: "abc123",
        retryCount: 2,
      }),
    }));
  });
});
