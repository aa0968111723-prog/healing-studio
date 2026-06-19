/**
 * world-context-gate.test.ts — AIDV-152
 *
 * director.chat 的旗標 gate ＋ best-effort 載入測試（透過 createCaller）。
 * 攔 runDirectorAI 記下第 6 參數 worldContext，攔 buildBrainContext 注入
 * 確定性 brain，攔 db 注入確定性 project / framework。
 *
 * 矩陣：
 *  · 旗標 OFF（預設）＋帶 projectId → worldContext = undefined（零行為改變）
 *  · 旗標 ON ＋不帶 projectId → worldContext = undefined
 *  · 旗標 ON ＋帶 projectId ＋擁有者 ＋有世界觀 → 注入摘要字串
 *  · 旗標 ON ＋專案查無 → 不 throw、worldContext = undefined（chat 照常）
 *  · 旗標 ON ＋非擁有者專案 → 不注入
 *  · 旗標 ON ＋db 拋錯 → 吞錯不 throw、worldContext = undefined
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 攔 runDirectorAI：記下傳入的 worldContext（第 6 參數）。
const runDirectorAICalls: Array<unknown[]> = [];
vi.mock("../../services/director/costarService", () => ({
  runDirectorAI: vi.fn((...args: unknown[]) => {
    runDirectorAICalls.push(args);
    return Promise.resolve({ research: "", script: null, personality: "creative" });
  }),
}));

// 攔 buildBrainContext：注入確定性 brain，避免讀 DB / 外部組態。
vi.mock("../../middleware/brainContext", () => ({
  buildBrainContext: vi.fn(async () => ({
    getBrain: () => ({
      model: "m",
      temperature: 0.5,
      topP: 0.8,
      systemPrompt: null,
    }),
  })),
}));

// 攔 db：只控制 chat 用到的 getCreativeProject / getWorldbuildingFramework。
const getCreativeProjectMock = vi.fn();
const getWorldbuildingFrameworkMock = vi.fn();
vi.mock("../../db", () => ({
  getCreativeProject: (...a: unknown[]) => getCreativeProjectMock(...a),
  getWorldbuildingFramework: (...a: unknown[]) =>
    getWorldbuildingFrameworkMock(...a),
}));

import { directorRouter } from "../../routers/director";

const USER_ID = 99;

function makeCaller() {
  // brainProcedure 只需要 ctx.user.id；其餘欄位填最小值。
  const ctx = {
    user: { id: USER_ID, role: "user" },
    req: {} as never,
    res: {} as never,
    orbTraceId: "test",
  } as never;
  return directorRouter.createCaller(ctx);
}

const WB = {
  id: 5,
  userId: USER_ID,
  name: "靈境試煉",
  description: "測試世界",
  genre: "奇幻",
  era: "近未來",
  charactersJson: [],
  scenesJson: [],
  objectsJson: null,
  tags: [],
  isActive: true,
};

const CHAT_INPUT = {
  messages: [{ role: "user", content: "你好" }],
  saveToNotes: false,
  personality: "creative" as const,
};

function worldContextArg(): unknown {
  // runDirectorAI(messages, saveToNotes, userId, personality, brainConfig, worldContext)
  return runDirectorAICalls[0]?.[5];
}

beforeEach(() => {
  runDirectorAICalls.length = 0;
  getCreativeProjectMock.mockReset();
  getWorldbuildingFrameworkMock.mockReset();
  delete process.env.ENABLE_DIRECTOR_WORLD_CONTEXT;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AIDV-152 / director.chat 旗標 gate ＋ best-effort", () => {
  it("旗標 OFF（預設）＋帶 projectId → 不載入，worldContext = undefined", async () => {
    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT, projectId: 7 });

    expect(worldContextArg()).toBeUndefined();
    // 旗標 OFF 時根本不該碰 db。
    expect(getCreativeProjectMock).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋不帶 projectId → worldContext = undefined", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT });

    expect(worldContextArg()).toBeUndefined();
    expect(getCreativeProjectMock).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋擁有者專案 ＋有世界觀 → 注入摘要字串", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockResolvedValue({
      id: 7,
      userId: USER_ID,
      worldFrameworkId: 5,
    });
    getWorldbuildingFrameworkMock.mockResolvedValue(WB);

    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT, projectId: 7 });

    const wc = worldContextArg();
    expect(typeof wc).toBe("string");
    expect(wc as string).toContain("靈境試煉");
  });

  it("旗標 ON ＋專案查無（null）→ 不 throw、worldContext = undefined", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockResolvedValue(null);

    const caller = makeCaller();
    await expect(
      caller.chat({ ...CHAT_INPUT, projectId: 7 })
    ).resolves.toBeDefined();
    expect(worldContextArg()).toBeUndefined();
    expect(getWorldbuildingFrameworkMock).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋非擁有者專案 → 不注入", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockResolvedValue({
      id: 7,
      userId: USER_ID + 1, // 別人的
      worldFrameworkId: 5,
    });

    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT, projectId: 7 });

    expect(worldContextArg()).toBeUndefined();
    expect(getWorldbuildingFrameworkMock).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋專案有但無 worldFrameworkId → 不注入", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockResolvedValue({
      id: 7,
      userId: USER_ID,
      worldFrameworkId: null,
    });

    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT, projectId: 7 });

    expect(worldContextArg()).toBeUndefined();
    expect(getWorldbuildingFrameworkMock).not.toHaveBeenCalled();
  });

  it("旗標 ON ＋db 拋錯 → 吞錯不 throw、worldContext = undefined（chat 照常）", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockRejectedValue(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const caller = makeCaller();
    await expect(
      caller.chat({ ...CHAT_INPUT, projectId: 7 })
    ).resolves.toBeDefined();
    expect(worldContextArg()).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("旗標 ON ＋世界觀框架屬於他人 → 不注入", async () => {
    process.env.ENABLE_DIRECTOR_WORLD_CONTEXT = "1";
    getCreativeProjectMock.mockResolvedValue({
      id: 7,
      userId: USER_ID,
      worldFrameworkId: 5,
    });
    getWorldbuildingFrameworkMock.mockResolvedValue({
      ...WB,
      userId: USER_ID + 1,
    });

    const caller = makeCaller();
    await caller.chat({ ...CHAT_INPUT, projectId: 7 });

    expect(worldContextArg()).toBeUndefined();
  });
});
