import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrbMemory, saveOrbMemory } from "./services/orbUserMemory";

vi.mock("./db", () => ({ getDb: vi.fn() }));
import { getDb } from "./db";

describe("orbUserMemory", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("loadOrbMemory 找不到回空字串", async () => {
    (getDb as any).mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) });
    await expect(loadOrbMemory(1)).resolves.toBe("");
  });

  it("saveOrbMemory 會更新摘要", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    (getDb as any).mockResolvedValue({ update });
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "摘要" } }] }) });
    process.env.OPENAI_API_KEY = "k";
    await saveOrbMemory(2, [{ role: "user", content: "a" }]);
    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ orbMemorySummary: "摘要" });
  });
});
