import { describe, expect, it, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const invokeLLMMock = vi.fn();

vi.mock("./db", () => ({
  db: {
    select: selectMock,
    update: vi.fn(() => ({ set: updateSetMock })),
  },
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: invokeLLMMock,
}));

describe("orbUserMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue(undefined);
  });

  it("loads summary from users table", async () => {
    const limitMock = vi.fn().mockResolvedValue([{ summary: "hello" }]);
    const whereMock = vi.fn(() => ({ limit: limitMock }));
    const fromMock = vi.fn(() => ({ where: whereMock }));
    selectMock.mockReturnValue({ from: fromMock });

    const mod = await import("./services/orbUserMemory");
    const result = await mod.loadOrbUserMemorySummary(1);
    expect(result).toBe("hello");
  });

  it("summarizes with gpt-4o-mini and persists", async () => {
    invokeLLMMock.mockResolvedValue({ text: "偏好: 電影感、短片" });
    const mod = await import("./services/orbUserMemory");
    const result = await mod.summarizeAndPersistOrbUserMemory({
      userId: 9,
      userText: "幫我做電影感短片",
      assistantText: "好的",
      priorSummary: null,
    });
    expect(result).toContain("偏好");
    expect(invokeLLMMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
    expect(updateWhereMock).toHaveBeenCalled();
  });

  it("degrades on llm failure", async () => {
    invokeLLMMock.mockRejectedValue(new Error("boom"));
    const mod = await import("./services/orbUserMemory");
    const result = await mod.summarizeAndPersistOrbUserMemory({
      userId: 9,
      userText: "u",
      assistantText: "a",
    });
    expect(result).toBeNull();
  });
});
