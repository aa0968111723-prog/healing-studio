/**
 * agentDlq.test.ts — AIDV-926 correlation_id 跨日誌追蹤測試
 *
 * 驗證 insertDlqEntry：
 *   1. 未傳 correlationId → 自動產生一個合法 UUID，並寫入 values()。
 *   2. 有傳 correlationId → 原樣使用，不覆寫。
 *   3. DB 不可用（getDb 回傳 null）→ 回傳 null，不丟例外。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { getDbMock, valuesMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  valuesMock: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));

function fakeDb(insertedId: number) {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        valuesMock(row);
        return { $returningId: () => Promise.resolve([{ id: insertedId }]) };
      },
    }),
  };
}

describe("insertDlqEntry — correlationId", () => {
  beforeEach(() => {
    valuesMock.mockClear();
    getDbMock.mockReset();
  });

  it("未傳 correlationId 時自動產生合法 UUID 並寫入 row", async () => {
    getDbMock.mockResolvedValue(fakeDb(101));
    const { insertDlqEntry } = await import("./agentDlq");

    const result = await insertDlqEntry({
      issueKey: "AIDV-926",
      userId: 1,
      failureType: "test",
      action: "decision",
      retryCount: 0,
      maxRetries: 3,
      updatedAt: Date.now(),
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(101);
    expect(result!.correlationId).toMatch(UUID_RE);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock.mock.calls[0][0].correlationId).toBe(result!.correlationId);
  });

  it("有傳 correlationId 時原樣使用，不覆寫", async () => {
    getDbMock.mockResolvedValue(fakeDb(102));
    const { insertDlqEntry } = await import("./agentDlq");

    const result = await insertDlqEntry(
      {
        issueKey: "AIDV-926",
        userId: 1,
        failureType: "lint",
        action: "retry",
        retryCount: 1,
        maxRetries: 3,
        updatedAt: Date.now(),
      },
      undefined,
      undefined,
      undefined,
      "caller-supplied-id-001"
    );

    expect(result!.correlationId).toBe("caller-supplied-id-001");
    expect(valuesMock.mock.calls[0][0].correlationId).toBe("caller-supplied-id-001");
  });

  it("DB 不可用時回傳 null，不丟例外", async () => {
    getDbMock.mockResolvedValue(null);
    const { insertDlqEntry } = await import("./agentDlq");

    const result = await insertDlqEntry({
      issueKey: "AIDV-926",
      userId: 1,
      failureType: "unknown",
      action: "decision",
      retryCount: 0,
      maxRetries: 3,
      updatedAt: Date.now(),
    });

    expect(result).toBeNull();
  });
});
