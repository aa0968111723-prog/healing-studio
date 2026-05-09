import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./services/agentPlanner", () => ({
  runSchemaFirstAgentPlanner: vi.fn(),
}));

vi.mock("./_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/llm")>();
  return {
    ...actual,
    invokeLLM: vi.fn().mockResolvedValue({
      id: "fallback",
      created: Date.now(),
      model: "test-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "先去影像工作室 [ACTION:navigate:/studio] [ACTION:setMode:video]",
          },
          finish_reason: "stop",
        },
      ],
    }),
  };
});

import { appRouter } from "./routers";
import { invokeLLM, LLMPermanentError } from "./_core/llm";
import { runSchemaFirstAgentPlanner } from "./services/agentPlanner";
import { orbTaskRepository } from "./repositories/orbTaskRepository";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockUser(): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user-001",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    remainingGenerations: 99,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function createMockContext(user: AuthenticatedUser | null = createMockUser()): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("ai.chat planner gating handling", () => {
  const mockedPlanner = vi.mocked(runSchemaFirstAgentPlanner);

  beforeEach(() => {
    mockedPlanner.mockReset();
    delete process.env.ENABLE_SCHEMA_FIRST_PLANNER;
    delete process.env.VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS;
  });

  it("returns clarification reply and no actions for status=clarification", async () => {
    mockedPlanner.mockResolvedValue({
      status: "clarification",
      ok: true,
      version: "agent-plan.v3",
      actions: [],
      askBeforeAct: false,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      reply: "你想要橫式還是直式？",
      intent: "clarify",
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我做海報" }],
      personality: "creative",
    });

    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(false);
    expect(result.reply).toContain("橫式");
    expect(result.plannerStatus).toBe("clarification");
    expect(result.planId).toBeTruthy();
    expect(result.traceId).toBeTruthy();
    expect(result.usedMultimodalPlanner).toBe(false);
    expect(result.telemetry).toMatchObject({
      plannerStatus: "clarification",
      planId: result.planId,
      traceId: result.traceId,
    });
  });

  it("returns blocked response with askBeforeAct=true and no actions", async () => {
    mockedPlanner.mockResolvedValue({
      status: "blocked",
      ok: false,
      version: "agent-plan.v3",
      actions: [],
      askBeforeAct: true,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      reply: "我已建立計畫，但因安全檢查暫停執行。",
      intent: "blocked-intent",
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "直接送出" }],
      personality: "technical",
    });

    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(true);
    expect(result.reply).toContain("暫停");
    expect(result.plannerStatus).toBe("blocked");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("materializes task payload when status=tasked", async () => {
    mockedPlanner.mockResolvedValue({
      status: "tasked",
      ok: true,
      version: "agent-plan.v3",
      actions: [],
      askBeforeAct: true,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      reply: "我先建立任務草稿給你確認。",
      intent: "code-task",
      preferredEngine: "claudeCode",
      task: {
        taskId: "draft_001",
        intent: "code-task",
        summaryForUser: "建立 PR",
        needsApproval: true,
        isolation: "code",
        preferredEngine: "claudeCode",
        rollbackMode: "manual",
        warnings: [],
        steps: [
          {
            id: "s1",
            label: "建立分支",
            pagePath: "/director",
            uiActions: [{ type: "fillPrompt", payload: { text: "建立分支" } }],
            toolCalls: [],
          },
        ],
      },
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我改 code 並建立 PR" }],
      personality: "technical",
    });

    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(true);
    expect(result.preferredEngine).toBe("claudeCode");
    expect(result.task).toBeTruthy();
    expect(result.task?.approvalRequired).toBe(true);
    expect(result.task?.status).toBe("awaiting_approval");
    expect(result.taskDraft?.steps).toHaveLength(1);
    expect(result.taskId).toBeTruthy();
    expect(result.plannerStatus).toBe("tasked");
  });

  it("workflow flag off keeps chat reply but strips actions", async () => {
    process.env.VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS = "false";
    mockedPlanner.mockResolvedValue({
      status: "converted",
      ok: true,
      version: "agent-plan.v3",
      actions: [
        {
          type: "runWorkflow",
          name: "video plan",
          steps: [{ label: "goto", actionType: "navigate", payload: "/studio" }],
        },
      ],
      askBeforeAct: true,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      usedMultimodalPlanner: true,
      reply: "我幫你規劃好了。",
      intent: "video-plan",
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我做一支短片" }],
      personality: "technical",
    });

    expect(result.reply).toContain("規劃");
    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(false);
    expect(result.warnings.join(" ")).toContain("workflows 已關閉");
    expect(result.usedMultimodalPlanner).toBe(true);
  });

  it("invalid planner output falls back to parseOrbReply legacy action markers", async () => {
    mockedPlanner.mockResolvedValue({
      status: "invalid",
      ok: false,
      version: "unknown",
      actions: [],
      askBeforeAct: false,
      blockers: [],
      warnings: ["schema does not match"],
      plannerUsed: true,
      reason: "invalid json",
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我切到影片模式" }],
      personality: "technical",
    });

    expect(result.plannerStatus).toBe("fallback-legacy");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0]?.type).toBe("navigate");
    expect(result.planId).toBeTruthy();
    expect(result.traceId).toBeTruthy();
    // Telemetry must record the invalid_fallback so ops can tell schema-first
    // is being skipped, and the planner warnings should bubble up to UI meta.
    const events = (result.telemetry.events ?? []) as Array<Record<string, unknown>>;
    expect(events.some(e => e.event === "planner.invalid_fallback")).toBe(true);
    expect(result.warnings.join(" ")).toContain("schema does not match");
  });

  it("planner exception is surfaced via fallback-planner-error and legacy still works", async () => {
    mockedPlanner.mockRejectedValueOnce(new Error("gemini blew up"));

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我切到影片模式" }],
      personality: "technical",
    });

    // Legacy parser must still produce actions (no full crash) and the
    // fallback status must be distinct from the "schema-disabled" one so
    // dashboards can split planner exceptions out cleanly.
    expect(result.plannerStatus).toBe("fallback-planner-error");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0]?.type).toBe("navigate");
    const events = (result.telemetry.events ?? []) as Array<Record<string, unknown>>;
    expect(events.some(e => e.event === "planner.exception")).toBe(true);
    expect(result.warnings.join(" ")).toContain("gemini blew up");
  });

  it("hot-path: '幫我做一支 30 秒短片' converts into a runWorkflow action via schema-first planner", async () => {
    // This is the canonical Issue #165 regression case: a short-video request
    // that previously fell through to the heuristic marker fallback. Once the
    // planner is wired in (which it now is), this MUST come back as a
    // status=converted plan with a runWorkflow action and a needs-confirm card.
    mockedPlanner.mockResolvedValue({
      status: "converted",
      ok: true,
      version: "agent-plan.v3",
      actions: [
        {
          type: "runWorkflow",
          name: "短片創作流程",
          steps: [
            { label: "前往影像工作室", actionType: "navigate", payload: "/studio" },
            { label: "切換為影片模式", actionType: "setMode", payload: "video" },
            { label: "送出生成", actionType: "submit", payload: "" },
          ],
        },
      ],
      askBeforeAct: true,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      preferredEngine: "gemini",
      reply: "我幫你規劃了一支 30 秒短片的工作流，請確認後我會自動執行。",
      intent: "video-30s-short",
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我做一支 30 秒短片" }],
      personality: "creative",
    });

    expect(mockedPlanner).toHaveBeenCalledTimes(1);
    expect(result.plannerStatus).toBe("converted");
    expect(result.askBeforeAct).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.type).toBe("runWorkflow");
    expect(result.preferredEngine).toBe("gemini");
    expect(result.reply).toContain("30 秒短片");
  });

  it("schema-first planner flag off bypasses planner and uses legacy fallback", async () => {
    process.env.ENABLE_SCHEMA_FIRST_PLANNER = "false";
    mockedPlanner.mockResolvedValue({
      status: "converted",
      ok: true,
      version: "agent-plan.v3",
      actions: [],
      askBeforeAct: false,
      blockers: [],
      warnings: [],
      plannerUsed: true,
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我切到影片模式" }],
      personality: "technical",
    });

    expect(mockedPlanner).not.toHaveBeenCalled();
    expect(result.plannerStatus).toBe("fallback-schema-disabled");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.warnings.join(" ")).toContain("Schema-first planner 已關閉");
  });

  it("task materialization failure does not crash chat", async () => {
    const spy = vi.spyOn(orbTaskRepository, "create").mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });
    mockedPlanner.mockResolvedValue({
      status: "tasked",
      ok: true,
      version: "agent-plan.v3",
      actions: [],
      askBeforeAct: true,
      blockers: [],
      warnings: [],
      plannerUsed: true,
      reply: "我先建立任務草稿給你確認。",
      intent: "code-task",
      preferredEngine: "claudeCode",
      task: {
        taskId: "draft_002",
        intent: "code-task",
        summaryForUser: "建立 PR",
        needsApproval: true,
        isolation: "code",
        preferredEngine: "claudeCode",
        rollbackMode: "manual",
        warnings: [],
        steps: [
          {
            id: "s1",
            label: "建立分支",
            pagePath: "/director",
            uiActions: [{ type: "fillPrompt", payload: { text: "建立分支" } }],
            toolCalls: [],
          },
        ],
      },
    });

    const caller = appRouter.createCaller(createMockContext());
    const result = await caller.ai.chat({
      messages: [{ role: "user", content: "幫我改 code 並建立 PR" }],
      personality: "technical",
    });

    expect(result.reply).toContain("任務草稿");
    expect(result.task).toBeTruthy();
    expect(result.task?.taskId).toBeTruthy();
    expect(result.taskDraft?.taskId).toBe("draft_002");
    spy.mockRestore();
  });

  // Regression: production user saw the generic 「設定頁檢查 API 設定」 line
  // even when the underlying failure was a real permanent auth/quota error.
  // The catch handler now classifies LLMPermanentError and aggregate
  // 「金鑰／額度」 strings so the reply tells the operator what to fix.
  describe("api-connection error classification", () => {
    const mockedInvokeLLM = vi.mocked(invokeLLM);

    it("LLMPermanentError(auth) surfaces a 金鑰失效 hint, not the generic line", async () => {
      mockedPlanner.mockRejectedValueOnce(new Error("planner skipped"));
      mockedInvokeLLM.mockRejectedValueOnce(
        new LLMPermanentError(
          "[OpenRouter] 401 invalid api key",
          "permanent_auth",
          401
        )
      );

      const caller = appRouter.createCaller(createMockContext());
      const result = await caller.ai.chat({
        messages: [{ role: "user", content: "幫我錄一集 podcast" }],
        personality: "creative",
      });

      expect(result.plannerStatus).toBe("fallback-error");
      expect(result.reply).toMatch(/金鑰失效|金鑰.*被拒絕/);
      expect(result.reply).toContain("OPENROUTER_API_KEY");
      expect(result.reply).not.toContain("我剛才遇到了一點小狀況");
    });

    it("LLMPermanentError(quota) surfaces an 額度 hint", async () => {
      mockedPlanner.mockRejectedValueOnce(new Error("planner skipped"));
      mockedInvokeLLM.mockRejectedValueOnce(
        new LLMPermanentError(
          "[Anthropic] credit balance is too low",
          "permanent_quota",
          402
        )
      );

      const caller = appRouter.createCaller(createMockContext());
      const result = await caller.ai.chat({
        messages: [{ role: "user", content: "幫我錄一集 podcast" }],
        personality: "creative",
      });

      expect(result.plannerStatus).toBe("fallback-error");
      expect(result.reply).toMatch(/額度|餘額/);
      expect(result.reply).not.toContain("我剛才遇到了一點小狀況");
    });

    it("aggregate '金鑰／額度問題失敗' from invokeLLM is surfaced as the chain-failure hint", async () => {
      mockedPlanner.mockRejectedValueOnce(new Error("planner skipped"));
      mockedInvokeLLM.mockRejectedValueOnce(
        new Error(
          "[LLM] 所有可用引擎皆因金鑰／額度問題失敗：openrouter（permanent_auth）、anthropic（permanent_quota）"
        )
      );

      const caller = appRouter.createCaller(createMockContext());
      const result = await caller.ai.chat({
        messages: [{ role: "user", content: "幫我錄一集 podcast" }],
        personality: "creative",
      });

      expect(result.reply).toContain("所有 AI 引擎暫時都連不上");
      expect(result.reply).toContain("OPENROUTER_API_KEY");
    });

    it("'沒有可用的 LLM 引擎' surfaces the no-key-set hint", async () => {
      mockedPlanner.mockRejectedValueOnce(new Error("planner skipped"));
      mockedInvokeLLM.mockRejectedValueOnce(
        new Error("沒有可用的 LLM 引擎！請在 .env 中設定 OPENROUTER_API_KEY")
      );

      const caller = appRouter.createCaller(createMockContext());
      const result = await caller.ai.chat({
        messages: [{ role: "user", content: "幫我錄一集 podcast" }],
        personality: "creative",
      });

      expect(result.reply).toContain("尚未設定任何 AI 引擎金鑰");
    });

    it("plain transient error still uses the generic healing fallback", async () => {
      mockedPlanner.mockRejectedValueOnce(new Error("planner skipped"));
      mockedInvokeLLM.mockRejectedValueOnce(new Error("ECONNRESET upstream"));

      const caller = appRouter.createCaller(createMockContext());
      const result = await caller.ai.chat({
        messages: [{ role: "user", content: "幫我錄一集 podcast" }],
        personality: "creative",
      });

      expect(result.reply).toContain("我剛才遇到了一點小狀況");
    });
  });
});
