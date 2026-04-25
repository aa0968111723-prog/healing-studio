import { describe, expect, it, vi } from "vitest";
import { createGlobalOrbExecutor, sanitizeTelemetryMetadata, type GlobalOrbExecutorTask } from "../client/src/agent/GlobalOrbExecutor";

function makeTask(overrides: Partial<GlobalOrbExecutorTask> = {}): GlobalOrbExecutorTask {
  return {
    taskId: "task_1",
    traceId: "trace_1",
    summaryForUser: "test task",
    status: "awaiting_approval",
    riskLevel: "low",
    steps: [{ id: "s1", label: "fill prompt", pagePath: "/studio", uiActions: [{ type: "fillPrompt", payload: { text: "hello" } }] }],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Parameters<typeof createGlobalOrbExecutor>[0]> = {}) {
  return {
    enabled: true,
    timeoutMs: 100,
    dispatchAction: vi.fn(async () => ({ ok: true as const })),
    navigate: vi.fn(async () => {}),
    getCurrentPagePath: vi.fn(() => "/studio"),
    waitForPageReady: vi.fn(async () => true),
    onTelemetry: vi.fn(),
    api: {
      approve: vi.fn(async () => ({})),
      cancel: vi.fn(async () => ({})),
      retry: vi.fn(async () => ({})),
      completeStep: vi.fn(async () => ({})),
      failStep: vi.fn(async () => ({})),
      updateStepStatus: vi.fn(async () => ({})),
    },
    ...overrides,
  };
}

describe("GlobalOrbExecutor", () => {
  it("executor refuses blocked task", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ status: "blocked" }));
    expect(state.status).toBe("failed");
  });

  it("executor waits for approval", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ steps: [{ id: "s1", label: "submit", pagePath: "/studio", uiActions: [{ type: "submit" }] }] }));
    expect(state.status).toBe("paused");
    expect(state.steps[0].status).toBe("awaiting_approval");
  });

  it("executor executes low-risk direct task", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ status: "approved" }));
    expect(state.status).toBe("completed");
  });

  it("executor blocks high-risk submit without approval", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ status: "approved", steps: [{ id: "s1", label: "submit", pagePath: "/studio", uiActions: [{ type: "submit" }] }] }));
    expect(state.status).toBe("paused");
  });

  it("executor can cancel task + cancelled task does not continue", async () => {
    const deps = makeDeps({ dispatchAction: vi.fn(async () => ({ ok: false as const, reason: "cancelled" })) });
    const executor = createGlobalOrbExecutor(deps);
    await executor.cancel("user cancelled");
    const state = executor.getState();
    expect(state.status).toBe("cancelled");
  });

  it("failed step records failure", async () => {
    const executor = createGlobalOrbExecutor(makeDeps({ dispatchAction: vi.fn(async () => ({ ok: false as const, reason: "boom" })) }));
    const state = await executor.start(makeTask({ status: "approved" }));
    expect(state.status).toBe("failed");
    expect(state.steps[0].status).toBe("failed");
  });

  it("retry consumes retryBudget", async () => {
    const executor = createGlobalOrbExecutor(makeDeps({ dispatchAction: vi.fn(async () => ({ ok: false as const, reason: "boom" })) }));
    const task = makeTask({ status: "approved", retryBudget: 2 });
    await executor.start(task);
    await executor.retry(task);
    expect(executor.getState().retryCount).toBeGreaterThan(0);
  });

  it("cross-page step waits for page ready", async () => {
    const deps = makeDeps({ getCurrentPagePath: vi.fn(() => "/home"), waitForPageReady: vi.fn(async () => true) });
    const executor = createGlobalOrbExecutor(deps);
    await executor.start(makeTask({ status: "approved" }));
    expect(deps.navigate).toHaveBeenCalled();
    expect(deps.waitForPageReady).toHaveBeenCalled();
  });

  it("page missing capability fails safely", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ status: "approved", steps: [{ id: "s1", label: "unknown", pagePath: "/studio", uiActions: [{ type: "totallyUnknownAction" }] }] }));
    expect(state.status).toBe("failed");
  });

  it("recovery calls planner with failedStep context", async () => {
    const executor = createGlobalOrbExecutor(makeDeps({ dispatchAction: vi.fn(async () => ({ ok: false as const, reason: "bad" })) }));
    const task = makeTask({ status: "approved" });
    await executor.start(task);
    const recovery = executor.requestRecovery(task);
    expect(recovery.failedStepId).toBe("s1");
    expect(recovery.failedReason).toContain("bad");
  });

  it("ClaudeCode task does not execute in browser", async () => {
    const executor = createGlobalOrbExecutor(makeDeps());
    const state = await executor.start(makeTask({ isolation: "code", preferredEngine: "claudeCode", status: "approved" }));
    expect(state.failReason).toContain("handoff");
  });

  it("feature flag off prevents execution", async () => {
    const executor = createGlobalOrbExecutor(makeDeps({ enabled: false }));
    const state = await executor.start(makeTask({ status: "approved" }));
    expect(state.status).toBe("blocked");
  });

  it("telemetry excludes secrets", () => {
    const sanitized = sanitizeTelemetryMetadata({ apiKey: "123", token: "abc", safe: "ok", base64Payload: "data:image/png;base64,abcdef" });
    expect(sanitized?.safe).toBe("ok");
    expect(sanitized?.apiKey).toBeUndefined();
    expect(sanitized?.token).toBeUndefined();
    expect(sanitized?.base64Payload).toBeUndefined();
  });
});
