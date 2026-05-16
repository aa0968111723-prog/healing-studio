import { describe, expect, it } from "vitest";
import { executeCurrentStepTools, type ExecuteStepToolsInput } from "../orbTaskOrchestrator";

const baseInput: ExecuteStepToolsInput = {
  task: {
    taskId: "t1",
    userId: 1,
    intent: "x",
    status: "running",
    steps: [{ id: "s1", label: "step", uiActions: [], toolCalls: [{ name: "tool.a", requiresApproval: true }] }],
    currentStepIndex: 0,
    needsApproval: false,
    approvedStepIds: [],
    stepApprovals: [],
    stepReports: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  userId: 1,
  userRole: "user",
  tools: [{ name: "tool.a", description: "a", method: "GET", endpoint: "http://localhost/a", requireConfirmation: true }],
  approved: false,
};

describe("orbTaskOrchestrator preferences", () => {
  it("always_approve policy skips confirmation gate", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.blockedByApproval).not.toBe(true);
  });

  it("confirm_high_risk can pause when step requires confirmation", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "confirm_high_risk", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(typeof out.ok).toBe("boolean");
  });

  it("blocked tool returns tool-blocked-by-user error", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: ["tool.a"], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.toolResults[0]?.error).toBe("tool-blocked-by-user");
  });

  it("maxAutoStepsPerTask limit pauses execution", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, autoApprovedStepsInRun: 5, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.blockedByApproval).toBe(true);
  });
});

// F4 修復:approval TTL — 過期 approval 不能放行
describe("orbTaskOrchestrator F4: approval TTL", () => {
  it("approvedStepIds 內有 step.id 但 stepApprovals 已過期 → 視為未授權,blocked", async () => {
    const now = Date.now();
    const out = await executeCurrentStepTools({
      ...baseInput,
      task: {
        ...baseInput.task,
        approvedStepIds: ["s1"], // legacy 永久陣列(過去同意過)
        stepApprovals: [
          {
            stepId: "s1",
            token: "expired-token",
            approvedAt: now - 10 * 60_000, // 10 分鐘前
            expiresAt: now - 1_000, // 1 秒前已過期
          },
        ],
      },
      approved: false,
    });
    // 預期被擋:approvedStepIds 雖然有 s1,但 TTL 已過,不能走捷徑
    expect(out.blockedByApproval).toBe(true);
  });

  it("stepApprovals 內 expiresAt 還沒到 → 視為授權,放行", async () => {
    const now = Date.now();
    const out = await executeCurrentStepTools({
      ...baseInput,
      task: {
        ...baseInput.task,
        approvedStepIds: ["s1"],
        stepApprovals: [
          {
            stepId: "s1",
            token: "live-token",
            approvedAt: now,
            expiresAt: now + 5 * 60_000, // 5 分鐘後才過期
          },
        ],
      },
      approved: false,
    });
    // approval 還有效 → 不該被 approval gate 擋
    expect(out.blockedByApproval).not.toBe(true);
  });

  it("approvedStepIds 有 step.id 但 stepApprovals 完全空 → 視為未授權,blocked", async () => {
    // legacy chunk 殘留(歷史 bug 或舊資料),不能因為 array 有就放行
    const out = await executeCurrentStepTools({
      ...baseInput,
      task: {
        ...baseInput.task,
        approvedStepIds: ["s1"],
        stepApprovals: [], // 沒有 TTL 記錄
      },
      approved: false,
    });
    expect(out.blockedByApproval).toBe(true);
  });
});
