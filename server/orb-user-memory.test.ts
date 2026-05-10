import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const invokeLLMMock = vi.fn();

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => selectMock(...args),
        }),
      }),
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return {
          where: (...whereArgs: unknown[]) => updateWhereMock(...whereArgs),
        };
      },
    }),
  }),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: unknown[]) => invokeLLMMock(...args),
}));

import { loadOrbMemory, saveOrbMemory } from "./services/orbUserMemory";

describe("orbUserMemory", () => {
  beforeEach(() => {
    selectMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset().mockResolvedValue(undefined);
    invokeLLMMock.mockReset();
  });

  it("loadOrbMemory returns saved summary", async () => {
    selectMock.mockResolvedValueOnce([{ summary: "這是記憶摘要" }]);
    await expect(loadOrbMemory(1)).resolves.toBe("這是記憶摘要");
  });

  it("saveOrbMemory summarizes messages and updates users row", async () => {
    invokeLLMMock.mockResolvedValueOnce({ text: "壓縮後摘要" });
    await saveOrbMemory(9, [
      { role: "user", content: "我偏好溫柔語氣" },
      { role: "assistant", content: "收到，之後會保持" },
    ]);

    expect(invokeLLMMock).toHaveBeenCalledTimes(1);
    const payload = invokeLLMMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.model).toBe("gpt-4o-mini");
    expect(updateSetMock).toHaveBeenCalledWith({ orbMemorySummary: "壓縮後摘要" });
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });
});
