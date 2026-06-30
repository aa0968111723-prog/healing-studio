/**
 * agentCapabilityRouter.test.ts — AIDV-514 empty-registry fail-fast
 *
 * AC1: When assign is called with no matching agents, it must throw
 *      SERVICE_UNAVAILABLE (maps to HTTP 503) — not silently return {agentId: null}.
 * AC2: When a matching agent exists, assign returns the agent details.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentEventBus } from "../../services/agentEventBus";

const mockLimit = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onDuplicateKeyUpdate: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: mockLimit,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

import { agentCapabilityRouter } from "../agentCapabilityRouter";

const ctx: any = {
  user: { id: 1 },
  req: { headers: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AIDV-514 agentCapabilityRouter.assign — empty-registry fail-fast", () => {
  it("空 registry → 拋 SERVICE_UNAVAILABLE，不靜默返回 null", async () => {
    mockLimit.mockResolvedValue([]);

    const caller = agentCapabilityRouter.createCaller(ctx);
    await expect(
      caller.assign({ taskType: "video_generation", requiredCapabilities: ["video"] })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining("no_agents_available"),
    });
  });

  it("空 registry + scope 要求 → 錯誤訊息含 scope 說明", async () => {
    mockLimit.mockResolvedValue([]);

    const caller = agentCapabilityRouter.createCaller(ctx);
    await expect(
      caller.assign({
        taskType: "video_generation",
        requiredCapabilities: ["video"],
        requiredScope: ["studio.video"],
      })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining("studio.video"),
    });
  });

  it("有符合代理 → 回傳 agentId，不拋錯", async () => {
    const fakeAgent = {
      agentId: "agent-001",
      capabilities: ["video", "audio"],
      allowedEndpoints: ["studio.video"],
      currentLoad: "0.2",
      costPerToken: "0.001",
      isActive: true,
      lastHeartbeatAt: new Date(),
    };
    mockLimit.mockResolvedValue([fakeAgent]);

    const caller = agentCapabilityRouter.createCaller(ctx);
    const result = await caller.assign({
      taskType: "video_generation",
      requiredCapabilities: ["video"],
    });
    expect(result.agentId).toBe("agent-001");
    expect(result.currentLoad).toBeCloseTo(0.2);
  });

  it("代理不符 scope → 拋 SERVICE_UNAVAILABLE", async () => {
    const agentNoScope = {
      agentId: "agent-002",
      capabilities: ["video"],
      allowedEndpoints: ["studio.image"],
      currentLoad: "0",
      costPerToken: "0",
      isActive: true,
      lastHeartbeatAt: new Date(),
    };
    mockLimit.mockResolvedValue([agentNoScope]);

    const caller = agentCapabilityRouter.createCaller(ctx);
    await expect(
      caller.assign({
        taskType: "video_generation",
        requiredCapabilities: ["video"],
        requiredScope: ["studio.video"],
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

// AIDV-467 Issue 6: assign broadcasts agent_task_status when videoProjectId is provided
describe("AIDV-467 agentCapabilityRouter.assign — agent_task_status broadcast", () => {
  const fakeAgent = {
    agentId: "agent-001",
    capabilities: ["video"],
    allowedEndpoints: null,
    currentLoad: "0.1",
    costPerToken: "0.001",
    isActive: true,
    lastHeartbeatAt: new Date(),
  };

  it("emits agent_task_status: assigned on per-project channel when videoProjectId provided", async () => {
    mockLimit.mockResolvedValue([fakeAgent]);

    const received: unknown[] = [];
    const unsub = agentEventBus.subscribeToProject(999, e => received.push(e));

    const caller = agentCapabilityRouter.createCaller(ctx);
    const result = await caller.assign({
      taskType: "video_generation",
      requiredCapabilities: ["video"],
      videoProjectId: 999,
    });
    unsub();

    expect(result.agentId).toBe("agent-001");
    expect(received).toHaveLength(1);
    const ev = received[0] as { type: string; status: string; agentId: string; projectId: number };
    expect(ev.type).toBe("agent_task_status");
    expect(ev.status).toBe("assigned");
    expect(ev.agentId).toBe("agent-001");
    expect(ev.projectId).toBe(999);
  });

  it("does NOT emit project event when videoProjectId is omitted", async () => {
    mockLimit.mockResolvedValue([fakeAgent]);

    const received: unknown[] = [];
    const unsub = agentEventBus.subscribeToProject(999, e => received.push(e));

    const caller = agentCapabilityRouter.createCaller(ctx);
    await caller.assign({ taskType: "video_generation", requiredCapabilities: ["video"] });
    unsub();

    expect(received).toHaveLength(0);
  });
});
