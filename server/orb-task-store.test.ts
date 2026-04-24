import { describe, expect, it } from "vitest";
import { OrbTaskStore } from "./services/orbTaskStore";

const demoSteps = [
  { id: "s1", label: "go", uiActions: [], toolCalls: [] },
  { id: "s2", label: "render", uiActions: [], toolCalls: [] },
];

describe("OrbTaskStore", () => {
  it("creates waiting_approval task", () => {
    const store = new OrbTaskStore();
    const task = store.create({
      userId: 1,
      intent: "test",
      steps: demoSteps,
      needsApproval: true,
      now: 1000,
    });
    expect(task.status).toBe("waiting_approval");
    expect(task.needsApproval).toBe(true);
  });

  it("approve(true) moves task to running", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, needsApproval: true, now: 1000 });
    const next = store.approve(task.taskId, 1, true, 1200);
    expect(next?.status).toBe("running");
    expect(next?.needsApproval).toBe(false);
  });

  it("report step success advances and eventually succeeds", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    const t1 = store.reportStep(
      { taskId: task.taskId, stepId: "s1", ok: true, detail: "done-1" },
      1,
      1100
    );
    expect(t1?.status).toBe("running");
    expect(t1?.currentStepIndex).toBe(1);
    expect(t1?.stepReports[0]?.detail).toBe("done-1");

    const t2 = store.reportStep({ taskId: task.taskId, stepId: "s2", ok: true }, 1, 1200);
    expect(t2?.status).toBe("succeeded");
    expect(t2?.currentStepIndex).toBe(2);
  });

  it("wrong step id marks failed", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    const out = store.reportStep({ taskId: task.taskId, stepId: "unknown", ok: true }, 1, 1050);
    expect(out?.status).toBe("failed");
  });

  it("approveStep adds step id into approvedStepIds", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    const out = store.approveStep(task.taskId, 1, "s1", true, 1010);
    expect(out?.approvedStepIds).toContain("s1");
    expect(out?.stepApprovals.find(x => x.stepId === "s1")?.token).toBeTruthy();
  });

  it("isStepApproved validates token and expiry", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    const approved = store.approveStep(task.taskId, 1, "s1", true, 1100)!;
    const token = approved.stepApprovals.find(x => x.stepId === "s1")?.token;
    expect(store.isStepApproved(task.taskId, 1, "s1", token, 1200)).toBe(true);
    expect(store.isStepApproved(task.taskId, 1, "s1", token, 9_999_999)).toBe(false);
  });

  it("builds chronological task timeline", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    store.approveStep(task.taskId, 1, "s1", true, 1200);
    store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true, detail: "ok" }, 1, 1300);
    const timeline = store.getTimeline(task.taskId, 1, 1400);
    expect(timeline.map(x => x.type)).toEqual([
      "task_created",
      "step_approved",
      "step_reported",
    ]);
    expect(timeline[2]?.detail).toBe("ok");
  });
});
