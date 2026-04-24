import type { OrbTask, OrbPlanStep, OrbTaskStatus } from "../../shared/orb-agent-contract";

export interface CreateOrbTaskInput {
  userId: number;
  intent: string;
  steps: OrbPlanStep[];
  needsApproval?: boolean;
  now?: number;
}

export interface ReportStepInput {
  taskId: string;
  stepId: string;
  ok: boolean;
  at?: number;
}

const TASK_TTL_MS = 30 * 60 * 1000;

function makeTaskId(now: number): string {
  return `orb_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OrbTaskStore {
  private tasks = new Map<string, OrbTask>();

  private cleanup(now: number): void {
    this.tasks.forEach((task, id) => {
      if (now - task.updatedAt > TASK_TTL_MS) this.tasks.delete(id);
    });
  }

  create(input: CreateOrbTaskInput): OrbTask {
    const now = input.now ?? Date.now();
    this.cleanup(now);
    const status: OrbTaskStatus = input.needsApproval
      ? "waiting_approval"
      : "running";
    const task: OrbTask = {
      taskId: makeTaskId(now),
      userId: input.userId,
      intent: input.intent,
      status,
      steps: input.steps,
      currentStepIndex: 0,
      needsApproval: Boolean(input.needsApproval),
      approvedStepIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  get(taskId: string, userId: number, now: number = Date.now()): OrbTask | null {
    this.cleanup(now);
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    return task;
  }

  approve(taskId: string, userId: number, approved: boolean, now: number = Date.now()): OrbTask | null {
    const task = this.get(taskId, userId, now);
    if (!task) return null;
    task.needsApproval = !approved;
    task.status = approved ? "running" : "cancelled";
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    return task;
  }

  approveStep(
    taskId: string,
    userId: number,
    stepId: string,
    approved: boolean,
    now: number = Date.now()
  ): OrbTask | null {
    const task = this.get(taskId, userId, now);
    if (!task) return null;
    const set = new Set(task.approvedStepIds);
    if (approved) set.add(stepId);
    else set.delete(stepId);
    task.approvedStepIds = Array.from(set);
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    return task;
  }

  reportStep(input: ReportStepInput, userId: number, now: number = Date.now()): OrbTask | null {
    const task = this.get(input.taskId, userId, now);
    if (!task) return null;
    if (task.status !== "running") return task;

    const current = task.steps[task.currentStepIndex];
    if (!current || current.id !== input.stepId) {
      task.status = "failed";
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      return task;
    }

    if (!input.ok) {
      task.status = "failed";
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      return task;
    }

    const nextIndex = task.currentStepIndex + 1;
    task.currentStepIndex = nextIndex;
    task.status = nextIndex >= task.steps.length ? "succeeded" : "running";
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    return task;
  }
}

export const orbTaskStore = new OrbTaskStore();
