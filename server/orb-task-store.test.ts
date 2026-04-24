import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrbTaskStore } from "./services/orbTaskStore";

const demoSteps = [
  { id: "s1", label: "go", uiActions: [], toolCalls: [] },
  { id: "s2", label: "render", uiActions: [], toolCalls: [] },
];

describe("OrbTaskStore", () => {
  it("creates waiting_human task when approval is required", () => {
    const store = new OrbTaskStore();
    const task = store.create({
      userId: 1,
      intent: "test",
      steps: demoSteps,
      needsApproval: true,
      now: 1000,
    });
    expect(task.status).toBe("waiting_human");
    expect(task.needsApproval).toBe(true);
  });

  it("approve(true) moves task to running", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, needsApproval: true, now: 1000 });
    const next = store.approve(task.taskId, 1, true, 1200);
    expect(next?.status).toBe("running");
    expect(next?.needsApproval).toBe(false);
  });

  it("report step success advances and eventually reaches done", () => {
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
    expect(t2?.status).toBe("done");
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
    expect(store.isStepApproved(task.taskId, 1, "s1", token, 1201)).toBe(false);
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
    expect(timeline[0]?.schemaVersion).toBe(1);
    expect(timeline[0]?.source).toBe("system");
    expect(timeline[0]?.actor).toBe("system");
    expect(timeline[0]?.eventId).toContain("task_created");
  });

  it("supports timeline from/to/limit filters", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    store.approveStep(task.taskId, 1, "s1", true, 1100);
    store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true }, 1, 1200);
    store.reportStep({ taskId: task.taskId, stepId: "s2", ok: true }, 1, 1300);

    const ranged = store.getTimeline(task.taskId, 1, {
      now: 1400,
      from: 1100,
      to: 1250,
      limit: 50,
    });
    expect(ranged.map(x => x.at)).toEqual([1100, 1200]);

    const limited = store.getTimeline(task.taskId, 1, { now: 1400, limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.at).toBe(1200);
    expect(limited[1]?.at).toBe(1300);
  });

  it("supports timeline cursor pagination", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    store.approveStep(task.taskId, 1, "s1", true, 1100);
    store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true }, 1, 1200);
    store.reportStep({ taskId: task.taskId, stepId: "s2", ok: true }, 1, 1300);

    const first = store.getTimelinePage(task.taskId, 1, { now: 1400, limit: 2 });
    expect(first.events.map(x => x.at)).toEqual([1200, 1300]);
    expect(first.nextCursor).toBe(1200);

    const second = store.getTimelinePage(task.taskId, 1, {
      now: 1400,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.events.map(x => x.at)).toEqual([1000, 1100]);
    expect(second.nextCursor).toBeNull();
  });

  it("supports timeline type filter and desc ordering", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    store.approveStep(task.taskId, 1, "s1", true, 1100);
    store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true }, 1, 1200);
    store.reportStep({ taskId: task.taskId, stepId: "s2", ok: true }, 1, 1300);

    const reportsOnlyDesc = store.getTimeline(task.taskId, 1, {
      now: 1400,
      order: "desc",
      types: ["step_reported"],
    });
    expect(reportsOnlyDesc.map(x => x.at)).toEqual([1300, 1200]);
    expect(reportsOnlyDesc[0]?.source).toBe("ui");
    expect(reportsOnlyDesc[0]?.actor).toBe("user");

    const pageDesc = store.getTimelinePage(task.taskId, 1, {
      now: 1400,
      limit: 2,
      order: "desc",
    });
    expect(pageDesc.events.map(x => x.at)).toEqual([1300, 1200]);
  });

  it("returns sync meta with latestEventId and etag", () => {
    const store = new OrbTaskStore();
    const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
    store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true }, 1, 1200);
    const meta = store.getTaskSyncMeta(task.taskId, 1, 1300);
    expect(meta.latestEventId).toContain("step_reported");
    expect(meta.etag).toContain("1200");
  });

  it("persists and reloads tasks when persistence file is configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "orb-task-store-"));
    const file = join(dir, "store.json");
    try {
      const store = new OrbTaskStore(file);
      const task = store.create({ userId: 1, intent: "x", steps: demoSteps, now: 1000 });
      store.reportStep({ taskId: task.taskId, stepId: "s1", ok: true }, 1, 1100);

      const reloaded = new OrbTaskStore(file);
      const fetched = reloaded.get(task.taskId, 1, 1200);
      expect(fetched?.taskId).toBe(task.taskId);
      expect(fetched?.stepReports.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy statuses from persisted tasks", () => {
    const dir = mkdtempSync(join(tmpdir(), "orb-task-store-legacy-"));
    const file = join(dir, "store.json");
    try {
      writeFileSync(
        file,
        JSON.stringify([
          {
            taskId: "legacy_1",
            userId: 1,
            intent: "legacy",
            status: "succeeded",
            steps: demoSteps,
            currentStepIndex: 2,
            needsApproval: false,
            approvedStepIds: [],
            stepApprovals: [],
            stepReports: [],
            createdAt: 1000,
            updatedAt: 1000,
          },
        ]),
        "utf8"
      );
      const store = new OrbTaskStore(file);
      const fetched = store.get("legacy_1", 1, 1100);
      expect(fetched?.status).toBe("done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
