/**
 * multiAgentPipeline.integration.test.ts — AIDV-406
 *
 * 端到端驗證多代理鏈路：
 *   register → heartbeat → assign → videoProject.create → 再 assign
 *
 * 測試矩陣：
 *   1. register 成功登記代理，回傳 {success, agentId}
 *   2. heartbeat 更新負載，失敗時拋 NOT_FOUND
 *   3. assign：多代理時選負載最低者（load balancing）
 *   4. assign：X-Agent-Priority header 正確解析
 *   5. assign：能力不符的代理不入選
 *   6. listActive 回傳活躍代理清單
 *   7. videoProject.create → 立即 assign 代理（pipeline 完整性煙霧測試）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── stateful in-memory agent registry ────────────────────────────────────────
type RegistryRow = {
  agentId: string;
  capabilities: string[];
  allowedEndpoints: string[] | null;
  costPerToken: string;
  currentLoad: string;
  isActive: boolean;
  lastHeartbeatAt: Date;
};

let registryState: RegistryRow[] = [];

const mockDbSelect = () => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() =>
    Promise.resolve(
      [...registryState]
        .filter(a => a.isActive)
        .sort((a, b) => parseFloat(a.currentLoad) - parseFloat(b.currentLoad))
    )
  ),
});

const mockInsertChain = () => {
  let pendingValues: Partial<RegistryRow> | null = null;
  return {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: any) => {
        pendingValues = vals;
        return {
          onDuplicateKeyUpdate: vi.fn().mockImplementation(() => {
            if (!pendingValues) return Promise.resolve();
            const idx = registryState.findIndex(a => a.agentId === pendingValues!.agentId);
            const fresh: RegistryRow = {
              agentId: pendingValues.agentId ?? "unknown",
              capabilities: pendingValues.capabilities ?? [],
              allowedEndpoints: pendingValues.allowedEndpoints ?? null,
              costPerToken: pendingValues.costPerToken ?? "0",
              currentLoad: pendingValues.currentLoad ?? "0",
              isActive: pendingValues.isActive ?? true,
              lastHeartbeatAt: new Date(),
            };
            if (idx >= 0) {
              Object.assign(registryState[idx], fresh);
            } else {
              registryState.push(fresh);
            }
            pendingValues = null;
            return Promise.resolve();
          }),
        };
      }),
    })),
  };
};

const mockUpdateChain = () => ({
  update: vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: any) => ({
      where: vi.fn().mockImplementation((cond: any) => {
        // Extract agentId from eq condition if possible; otherwise update first
        const agentId = (cond as any)?._right?.value ?? (cond as any)?.right?.value;
        const idx = agentId
          ? registryState.findIndex(a => a.agentId === agentId)
          : registryState.length > 0
          ? 0
          : -1;
        if (idx < 0) return Promise.resolve([{ affectedRows: 0 }]);
        Object.assign(registryState[idx], {
          ...vals,
          lastHeartbeatAt: new Date(),
          currentLoad: vals.currentLoad ?? registryState[idx].currentLoad,
          isActive: vals.isActive ?? registryState[idx].isActive,
        });
        return Promise.resolve([{ affectedRows: 1 }]);
      }),
    })),
  })),
});

const buildMockDb = () => ({
  ...mockInsertChain(),
  ...mockUpdateChain(),
  select: vi.fn().mockImplementation(mockDbSelect),
});

let mockDb: ReturnType<typeof buildMockDb>;

vi.mock("../../db", () => ({
  getDb: vi.fn().mockImplementation(() => Promise.resolve(mockDb)),
  createVideoProject: vi.fn(),
  getVideoProject: vi.fn(),
}));

vi.mock("../../services/audit/auditLog", () => ({
  recordAuditEvent: vi.fn(),
  extractRequestSource: vi.fn(() => ({})),
}));

vi.mock("../../signedUpload", () => ({
  presignGetDownload: vi.fn(),
  EXPORT_PRESIGN_EXPIRES_SECONDS: 3600,
  isR2Configured: vi.fn(() => false),
}));

vi.mock("../../services/agentEventBus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

vi.mock("../../_core/trpcRateLimit", () => ({
  checkAgentRateLimit: vi.fn(),
  getAgentQuota: vi.fn(() => ({ remaining: 100 })),
}));

import { agentCapabilityRouter } from "../agentCapabilityRouter";
import { videoProjectRouter } from "../videoProject";
import * as db from "../../db";

const userCtx: any = { user: { id: 42, role: "user" }, req: { headers: {} }, requestId: "req-406" };

beforeEach(() => {
  registryState = [];
  mockDb = buildMockDb();
  vi.clearAllMocks();
  vi.mocked(db.createVideoProject).mockResolvedValue(101);
  vi.mocked(db.getVideoProject).mockResolvedValue({
    id: 101,
    userId: 42,
    creativeProjectId: null,
    title: "測試影片",
    aspectRatio: "16:9",
    outputSpec: { resolution: "1080p", fps: 30, codec: "h264" },
    version: 1,
    priorityClass: "standard",
    deadlineAt: null,
    outputStoragePath: null,
    outputSignedUrl: null,
    outputExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
});

// ─── 1. register ──────────────────────────────────────────────────────────────
describe("register", () => {
  it("成功登記代理，回傳 success + agentId", async () => {
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.register({
      agentId: "video-processor-v1",
      capabilities: ["video", "image"],
      costPerToken: 0.001,
    });
    expect(result.success).toBe(true);
    expect(result.agentId).toBe("video-processor-v1");
    expect(registryState).toHaveLength(1);
    expect(registryState[0].agentId).toBe("video-processor-v1");
  });

  it("register 同一 agentId 兩次 → upsert，不重複新增", async () => {
    const caller = agentCapabilityRouter.createCaller(userCtx);
    await caller.register({
      agentId: "agent-dup",
      capabilities: ["audio"],
      costPerToken: 0,
    });
    await caller.register({
      agentId: "agent-dup",
      capabilities: ["audio", "voice"],
      costPerToken: 0.002,
    });
    const dupes = registryState.filter(a => a.agentId === "agent-dup");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].capabilities).toContain("voice");
  });

  it("register 含 allowedEndpoints（Agent Scope AIDV-331）", async () => {
    const caller = agentCapabilityRouter.createCaller(userCtx);
    await caller.register({
      agentId: "scoped-agent",
      capabilities: ["video"],
      costPerToken: 0,
      allowedEndpoints: ["studio.video", "studio.export"],
    });
    expect(registryState[0].allowedEndpoints).toEqual(["studio.video", "studio.export"]);
  });
});

// ─── 2. heartbeat ─────────────────────────────────────────────────────────────
describe("heartbeat", () => {
  it("心跳更新負載，回傳 success", async () => {
    registryState.push({
      agentId: "agent-hb",
      capabilities: ["video"],
      allowedEndpoints: null,
      costPerToken: "0",
      currentLoad: "0",
      isActive: true,
      lastHeartbeatAt: new Date(),
    });

    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.heartbeat({ agentId: "agent-hb", currentLoad: 0.6 });
    expect(result.success).toBe(true);
    expect(result.currentLoad).toBe(0.6);
  });

  it("未登記代理心跳 → 拋 NOT_FOUND（避免靜默更新）", async () => {
    const caller = agentCapabilityRouter.createCaller(userCtx);
    await expect(
      caller.heartbeat({ agentId: "ghost-agent", currentLoad: 0.5 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── 3. assign — load balancing ───────────────────────────────────────────────
describe("assign — 負載平衡", () => {
  beforeEach(() => {
    registryState = [
      {
        agentId: "heavy-agent",
        capabilities: ["video"],
        allowedEndpoints: null,
        costPerToken: "0",
        currentLoad: "0.9",
        isActive: true,
        lastHeartbeatAt: new Date(),
      },
      {
        agentId: "light-agent",
        capabilities: ["video"],
        allowedEndpoints: null,
        costPerToken: "0",
        currentLoad: "0.1",
        isActive: true,
        lastHeartbeatAt: new Date(),
      },
      {
        agentId: "mid-agent",
        capabilities: ["video"],
        allowedEndpoints: null,
        costPerToken: "0",
        currentLoad: "0.5",
        isActive: true,
        lastHeartbeatAt: new Date(),
      },
    ];
  });

  it("三個代理可用時，選負載最低者", async () => {
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.assign({
      taskType: "video_generation",
      requiredCapabilities: ["video"],
    });
    expect(result.agentId).toBe("light-agent");
    expect(result.currentLoad).toBeCloseTo(0.1);
  });

  it("非 video 能力的代理不入選", async () => {
    registryState[0].capabilities = ["image"];
    registryState[2].capabilities = ["audio"];

    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.assign({
      taskType: "video_generation",
      requiredCapabilities: ["video"],
    });
    expect(result.agentId).toBe("light-agent");
  });
});

// ─── 4. assign — priority hint ────────────────────────────────────────────────
describe("assign — X-Agent-Priority header", () => {
  const agent = {
    agentId: "priority-agent",
    capabilities: ["video"],
    allowedEndpoints: null,
    costPerToken: "0",
    currentLoad: "0.2",
    isActive: true,
    lastHeartbeatAt: new Date(),
  };

  it("X-Agent-Priority: urgent → priority=urgent 回傳", async () => {
    registryState = [agent];
    const ctx = { ...userCtx, req: { headers: { "x-agent-priority": "urgent" } } };
    const caller = agentCapabilityRouter.createCaller(ctx);
    const result = await caller.assign({ taskType: "t", requiredCapabilities: ["video"] });
    expect(result.priority).toBe("urgent");
  });

  it("X-Agent-Priority: background → priority=background 回傳", async () => {
    registryState = [agent];
    const ctx = { ...userCtx, req: { headers: { "x-agent-priority": "background" } } };
    const caller = agentCapabilityRouter.createCaller(ctx);
    const result = await caller.assign({ taskType: "t", requiredCapabilities: ["video"] });
    expect(result.priority).toBe("background");
  });

  it("無 X-Agent-Priority → 預設 normal", async () => {
    registryState = [agent];
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.assign({ taskType: "t", requiredCapabilities: ["video"] });
    expect(result.priority).toBe("normal");
  });

  it("無效 priority 值 → fallback normal", async () => {
    registryState = [agent];
    const ctx = { ...userCtx, req: { headers: { "x-agent-priority": "INVALID" } } };
    const caller = agentCapabilityRouter.createCaller(ctx);
    const result = await caller.assign({ taskType: "t", requiredCapabilities: ["video"] });
    expect(result.priority).toBe("normal");
  });
});

// ─── 5. assign — scope guard ──────────────────────────────────────────────────
describe("assign — scope guard", () => {
  it("代理 allowedEndpoints 不含 requiredScope → 拋 SERVICE_UNAVAILABLE", async () => {
    registryState = [
      {
        agentId: "limited-agent",
        capabilities: ["video"],
        allowedEndpoints: ["studio.image"],
        costPerToken: "0",
        currentLoad: "0",
        isActive: true,
        lastHeartbeatAt: new Date(),
      },
    ];
    const caller = agentCapabilityRouter.createCaller(userCtx);
    await expect(
      caller.assign({ taskType: "t", requiredCapabilities: ["video"], requiredScope: ["studio.video"] })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("代理 allowedEndpoints 全含 requiredScope → 成功派工", async () => {
    registryState = [
      {
        agentId: "full-scope-agent",
        capabilities: ["video"],
        allowedEndpoints: ["studio.video", "studio.export"],
        costPerToken: "0",
        currentLoad: "0",
        isActive: true,
        lastHeartbeatAt: new Date(),
      },
    ];
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.assign({
      taskType: "t",
      requiredCapabilities: ["video"],
      requiredScope: ["studio.video"],
    });
    expect(result.agentId).toBe("full-scope-agent");
  });
});

// ─── 6. listActive ────────────────────────────────────────────────────────────
describe("listActive", () => {
  it("回傳活躍代理清單，依負載排序", async () => {
    registryState = [
      { agentId: "a1", capabilities: ["v"], allowedEndpoints: null, costPerToken: "0", currentLoad: "0.5", isActive: true, lastHeartbeatAt: new Date() },
      { agentId: "a2", capabilities: ["v"], allowedEndpoints: null, costPerToken: "0", currentLoad: "0.1", isActive: true, lastHeartbeatAt: new Date() },
    ];
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.listActive();
    expect(result.agents).toHaveLength(2);
    expect(result.agents[0].agentId).toBe("a2");
    expect(result.agents[0].currentLoad).toBeCloseTo(0.1);
  });

  it("DB 不可用時回傳空陣列（graceful degradation）", async () => {
    vi.mocked(db.getDb as any).mockResolvedValueOnce(null);
    const caller = agentCapabilityRouter.createCaller(userCtx);
    const result = await caller.listActive();
    expect(result.agents).toEqual([]);
  });
});

// ─── 7. Pipeline 煙霧測試：register → create videoProject → assign ─────────────
describe("AIDV-406 pipeline smoke test", () => {
  it("register 代理 → 建立 videoProject → assign 代理，流程完整不拋錯", async () => {
    const agentCaller = agentCapabilityRouter.createCaller(userCtx);
    const videoCaller = videoProjectRouter.createCaller(userCtx);

    // Step 1: 代理上線登記
    await agentCaller.register({
      agentId: "video-processor-smoke",
      capabilities: ["video", "fal"],
      costPerToken: 0.002,
      allowedEndpoints: ["studio.video"],
    });
    expect(registryState).toHaveLength(1);

    // Step 2: 代理送出心跳（負載 20%）
    await agentCaller.heartbeat({ agentId: "video-processor-smoke", currentLoad: 0.2 });

    // Step 3: 創作者建立影片專案
    const project = await videoCaller.create({
      title: "淡大煙霧測試影片",
      aspectRatio: "16:9",
      priorityClass: "standard",
    });
    expect(project.id).toBe(101);

    // Step 4: 系統為新專案派工（選最低負載代理）
    const assigned = await agentCaller.assign({
      taskType: "video_generation",
      requiredCapabilities: ["video", "fal"],
      requiredScope: ["studio.video"],
    });
    expect(assigned.agentId).toBe("video-processor-smoke");
    expect(assigned.currentLoad).toBeCloseTo(0.2);
    expect(assigned.priority).toBe("normal");
  });

  it("多代理競爭時，負載最低者接下 video 任務", async () => {
    const agentCaller = agentCapabilityRouter.createCaller(userCtx);
    const videoCaller = videoProjectRouter.createCaller(userCtx);

    // 登記三個代理
    const agents = [
      { id: "agent-busy", load: 0.8 },
      { id: "agent-free", load: 0.05 },
      { id: "agent-mid", load: 0.5 },
    ];
    for (const a of agents) {
      await agentCaller.register({ agentId: a.id, capabilities: ["video"], costPerToken: 0 });
      registryState.find(r => r.agentId === a.id)!.currentLoad = String(a.load);
    }

    // 建立影片專案後派工
    await videoCaller.create({ title: "競爭派工測試", aspectRatio: "9:16" });
    const assigned = await agentCaller.assign({ taskType: "video", requiredCapabilities: ["video"] });
    expect(assigned.agentId).toBe("agent-free");
  });
});
