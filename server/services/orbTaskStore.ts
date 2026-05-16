import type { OrbTask, OrbPlanStep, OrbTaskStatus } from "../../shared/orb-agent-contract";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface CreateOrbTaskInput {
  userId: number;
  intent: string;
  steps: OrbPlanStep[];
  needsApproval?: boolean;
  now?: number;
  /**
   * Optional override so the FSM (orbTaskStateMachine) and the legacy store
   * can share the same identifier. Without this, the two stores generated
   * different IDs (`orb_task_*` vs `orb_*`) for the same logical task and
   * `reportTaskStep` silently failed because the legacy store had no record
   * under the FSM's id.
   */
  taskId?: string;
}

export interface ReportStepInput {
  taskId: string;
  stepId: string;
  ok: boolean;
  detail?: string;
  errorCode?: string;
  source?: "ui" | "tool" | "system";
  actor?: "user" | "agent" | "system";
  at?: number;
}

const TASK_TTL_MS = 30 * 60 * 1000;
const STEP_APPROVAL_TTL_MS = 5 * 60 * 1000;

function makeTaskId(now: number): string {
  // Keep the `orb_task_*` prefix consistent with orbTaskStateMachine so the
  // FSM and the legacy store can address the same task by the same id.
  return `orb_task_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OrbTaskStore {
  constructor(private readonly persistenceFile?: string) {
    this.loadFromDisk();
  }

  private tasks = new Map<string, OrbTask>();

  private normalizeLegacyStatus(status: string): OrbTaskStatus {
    if (status === "waiting_approval") return "waiting_human";
    if (status === "succeeded") return "done";
    if (
      status === "planned" ||
      status === "running" ||
      status === "waiting_human" ||
      status === "done" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return status;
    }
    return "failed";
  }

  private canTransition(from: OrbTaskStatus, to: OrbTaskStatus): boolean {
    if (from === to) return true;
    const allowed: Record<OrbTaskStatus, OrbTaskStatus[]> = {
      planned: ["running", "waiting_human", "cancelled", "failed"],
      running: ["waiting_human", "done", "failed", "cancelled"],
      waiting_human: ["running", "cancelled", "failed"],
      done: [],
      failed: [],
      cancelled: [],
    };
    return allowed[from].includes(to);
  }

  private setStatus(task: OrbTask, next: OrbTaskStatus): void {
    const current = this.normalizeLegacyStatus(task.status);
    if (!this.canTransition(current, next)) return;
    task.status = next;
  }

  private loadFromDisk(): void {
    if (!this.persistenceFile) return;
    try {
      if (!existsSync(this.persistenceFile)) return;
      const raw = readFileSync(this.persistenceFile, "utf8");
      const parsed = JSON.parse(raw) as OrbTask[];
      if (!Array.isArray(parsed)) return;
      this.tasks = new Map(
        parsed.map(task => [
          task.taskId,
          {
            ...task,
            status: this.normalizeLegacyStatus(task.status),
          },
        ])
      );
    } catch (err) {
      console.error("[OrbTaskStore] Failed to load persistence file:", err);
    }
  }

  private persistToDisk(): void {
    if (!this.persistenceFile) return;
    try {
      const payload = JSON.stringify(Array.from(this.tasks.values()));
      writeFileSync(this.persistenceFile, payload, "utf8");
    } catch (err) {
      console.error("[OrbTaskStore] Failed to persist task store:", err);
    }
  }

  private cleanup(now: number): void {
    this.tasks.forEach((task, id) => {
      if (now - task.updatedAt > TASK_TTL_MS) this.tasks.delete(id);
    });
    this.persistToDisk();
  }

  create(input: CreateOrbTaskInput): OrbTask {
    const now = input.now ?? Date.now();
    this.cleanup(now);
    const task: OrbTask = {
      taskId: input.taskId ?? makeTaskId(now),
      userId: input.userId,
      intent: input.intent,
      status: "planned",
      steps: input.steps,
      currentStepIndex: 0,
      needsApproval: Boolean(input.needsApproval),
      approvedStepIds: [],
      stepApprovals: [],
      stepReports: [],
      createdAt: now,
      updatedAt: now,
    };
    this.setStatus(task, input.needsApproval ? "waiting_human" : "running");
    this.tasks.set(task.taskId, task);
    this.persistToDisk();
    return task;
  }

  get(taskId: string, userId: number, now: number = Date.now()): OrbTask | null {
    this.cleanup(now);
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    task.status = this.normalizeLegacyStatus(task.status);
    return task;
  }

  getTaskSyncMeta(
    taskId: string,
    userId: number,
    now: number = Date.now()
  ): { latestEventId: string | null; etag: string | null } {
    const task = this.get(taskId, userId, now);
    if (!task) return { latestEventId: null, etag: null };
    const latest = this.getTimeline(taskId, userId, {
      now,
      limit: 1,
      order: "desc",
    })[0];
    const etag = `W/\"${task.updatedAt}-${task.currentStepIndex}-${task.stepReports.length}\"`;
    return {
      latestEventId: latest?.eventId ?? null,
      etag,
    };
  }

  approve(taskId: string, userId: number, approved: boolean, now: number = Date.now()): OrbTask | null {
    const task = this.get(taskId, userId, now);
    if (!task) return null;
    task.needsApproval = !approved;
    this.setStatus(task, approved ? "running" : "cancelled");
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    this.persistToDisk();
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
    if (approved && task.status === "waiting_human") {
      this.setStatus(task, "running");
    }
    const set = new Set(task.approvedStepIds);
    if (approved) set.add(stepId);
    else set.delete(stepId);
    task.approvedStepIds = Array.from(set);
    if (approved) {
      task.stepApprovals = [
        ...task.stepApprovals.filter(x => x.stepId !== stepId),
        {
          stepId,
          token: `${task.taskId}_${stepId}_${Math.random().toString(36).slice(2, 12)}`,
          approvedAt: now,
          expiresAt: now + STEP_APPROVAL_TTL_MS,
        },
      ];
    } else {
      task.stepApprovals = task.stepApprovals.filter(x => x.stepId !== stepId);
    }
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    this.persistToDisk();
    return task;
  }

  isStepApproved(
    taskId: string,
    userId: number,
    stepId: string,
    token: string | undefined,
    now: number = Date.now()
  ): boolean {
    const task = this.get(taskId, userId, now);
    if (!task) return false;
    const approval = task.stepApprovals.find(x => x.stepId === stepId);
    if (!approval) return false;
    const valid = approval.expiresAt >= now && Boolean(token) && approval.token === token;
    if (!valid && approval.expiresAt < now) {
      task.stepApprovals = task.stepApprovals.filter(x => x.stepId !== stepId);
      task.approvedStepIds = task.approvedStepIds.filter(x => x !== stepId);
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      this.persistToDisk();
    }
    return valid;
  }

  /**
   * F4 修復:TTL-aware token-less approval check。orchestrator 內部要
   * 判斷「這 step 之前是否被使用者同意過」時不應該繞過 expiresAt 直接
   * 看 task.approvedStepIds 陣列 — 否則使用者 6 分鐘前同意後關掉視窗、
   * 5 分鐘後重連時,過期 approval 仍然觸發昂貴的工具呼叫(刷信用 / 發
   * webhook / 付外部 API 錢)。
   *
   * 跟 isStepApproved 的差異:不需要 token(orchestrator 自己 driver 沒
   * 有 token,而 stepApprovals 陣列裡存的 token 是給外部 caller 用的)。
   * 過期條目也會就地清除,避免無限累積。
   */
  hasUnexpiredStepApproval(
    taskId: string,
    userId: number,
    stepId: string,
    now: number = Date.now()
  ): boolean {
    const task = this.get(taskId, userId, now);
    if (!task) return false;
    const approval = task.stepApprovals.find(x => x.stepId === stepId);
    if (!approval) return false;
    if (approval.expiresAt < now) {
      // 過期了 — 順便清掉,讓 approvedStepIds 也一致(get 已經 TTL-prune
      // 過 stepApprovals,但 approvedStepIds 還是 legacy 陣列)。
      task.stepApprovals = task.stepApprovals.filter(x => x.stepId !== stepId);
      task.approvedStepIds = task.approvedStepIds.filter(x => x !== stepId);
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      this.persistToDisk();
      return false;
    }
    return true;
  }

  /**
   * Replace the step at `atIndex` with `revisedSteps` and resume execution.
   *
   * Used by the replan integration when a step fails and either deterministic
   * or LLM-based replanning produces a viable replacement chain. Without this
   * method the revised steps were generated but never applied — see
   * `orbTaskReplanIntegration.ts`.
   *
   * Behaviour:
   *   - The target step is spliced out and replaced with `revisedSteps`.
   *   - `currentStepIndex` stays at `atIndex` so the orchestrator picks up
   *     the first injected step on the next tick.
   *   - If the task had been forced to `failed` for this attempt, transition
   *     it back to `running` so the next orchestrator run actually executes
   *     the new plan. (`canTransition` blocks `failed → running`, so we set
   *     status directly here — the replan path is the documented exception.)
   *   - Total step count is capped at 24 (the schema allows up to 12 in the
   *     initial plan; we double that to leave headroom for repeated replans
   *     without unbounded growth).
   *
   * Returns the updated task on success, or null when the task is missing,
   * the index is out of range, or `revisedSteps` is empty.
   */
  injectRevisedSteps(
    taskId: string,
    userId: number,
    atIndex: number,
    revisedSteps: OrbPlanStep[],
    now: number = Date.now()
  ): OrbTask | null {
    const task = this.get(taskId, userId, now);
    if (!task) return null;
    if (revisedSteps.length === 0) return null;
    if (atIndex < 0 || atIndex >= task.steps.length) return null;

    const MAX_STEPS = 24;
    const projectedLength =
      task.steps.length - 1 + revisedSteps.length;
    if (projectedLength > MAX_STEPS) {
      console.warn(
        `[OrbTaskStore] injectRevisedSteps refused: would grow steps to ${projectedLength} (cap ${MAX_STEPS})`
      );
      return null;
    }

    const next: OrbPlanStep[] = [
      ...task.steps.slice(0, atIndex),
      ...revisedSteps,
      ...task.steps.slice(atIndex + 1),
    ];
    task.steps = next;
    task.currentStepIndex = atIndex;
    // Replan recovers a failed run; force-revive into running so the next
    // orchestrator iteration picks up the injected steps.
    task.status = "running";
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    this.persistToDisk();
    return task;
  }

  reportStep(input: ReportStepInput, userId: number, now: number = Date.now()): OrbTask | null {
    const task = this.get(input.taskId, userId, now);
    if (!task) return null;
    task.status = this.normalizeLegacyStatus(task.status);
    if (task.status !== "running") return task;

    const current = task.steps[task.currentStepIndex];
    if (!current || current.id !== input.stepId) {
      this.setStatus(task, "failed");
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      this.persistToDisk();
      return task;
    }

    if (!input.ok) {
      this.setStatus(task, "failed");
      task.stepReports.push({
        stepId: input.stepId,
        ok: false,
        detail: input.detail,
        errorCode: input.errorCode,
        source: input.source ?? "ui",
        actor: input.actor ?? "user",
        at: input.at ?? now,
      });
      task.updatedAt = now;
      this.tasks.set(task.taskId, task);
      this.persistToDisk();
      return task;
    }

    const nextIndex = task.currentStepIndex + 1;
    task.currentStepIndex = nextIndex;
    task.stepReports.push({
      stepId: input.stepId,
      ok: true,
      detail: input.detail,
      errorCode: input.errorCode,
      source: input.source ?? "ui",
      actor: input.actor ?? "user",
      at: input.at ?? now,
    });
    this.setStatus(task, nextIndex >= task.steps.length ? "done" : "running");
    task.updatedAt = now;
    this.tasks.set(task.taskId, task);
    this.persistToDisk();
    return task;
  }

  getTimeline(
    taskId: string,
    userId: number,
    optsOrNow:
      | number
      | {
      now?: number;
      from?: number;
      to?: number;
      limit?: number;
      types?: Array<"task_created" | "step_approved" | "step_reported">;
      order?: "asc" | "desc";
    } = {}
  ): Array<{
    type: "task_created" | "step_approved" | "step_reported";
    eventId: string;
    schemaVersion: 1;
    at: number;
    source: "ui" | "tool" | "system";
    actor: "user" | "agent" | "system";
    stepId?: string;
    ok?: boolean;
    detail?: string;
    errorCode?: string;
  }> {
    const opts = typeof optsOrNow === "number" ? { now: optsOrNow } : optsOrNow;
    const now = opts.now ?? Date.now();
    const task = this.get(taskId, userId, now);
    if (!task) return [];
    const events: Array<{
      type: "task_created" | "step_approved" | "step_reported";
      eventId: string;
      schemaVersion: 1;
      at: number;
      source: "ui" | "tool" | "system";
      actor: "user" | "agent" | "system";
      stepId?: string;
      ok?: boolean;
      detail?: string;
      errorCode?: string;
    }> = [
      {
        type: "task_created",
        eventId: `task_created:${task.taskId}:${task.createdAt}`,
        schemaVersion: 1 as const,
        source: "system",
        actor: "system",
        at: task.createdAt,
      },
      ...task.stepApprovals.map(x => ({
        type: "step_approved" as const,
        eventId: `step_approved:${task.taskId}:${x.stepId}:${x.approvedAt}`,
        schemaVersion: 1 as const,
        source: "ui" as const,
        actor: "user" as const,
        at: x.approvedAt,
        stepId: x.stepId,
      })),
      ...task.stepReports.map(x => ({
        type: "step_reported" as const,
        eventId: `step_reported:${task.taskId}:${x.stepId}:${x.at}`,
        schemaVersion: 1 as const,
        source: x.source ?? "ui",
        actor: x.actor ?? (x.source === "tool" ? "agent" : x.source === "system" ? "system" : "user"),
        at: x.at,
        stepId: x.stepId,
        ok: x.ok,
        detail: x.detail,
        errorCode: x.errorCode,
      })),
    ];
    events.sort((a, b) => a.at - b.at);
    const from = opts.from ?? Number.NEGATIVE_INFINITY;
    const to = opts.to ?? Number.POSITIVE_INFINITY;
    const typeSet = opts.types && opts.types.length > 0 ? new Set(opts.types) : null;
    const filtered = events.filter(
      e => e.at >= from && e.at <= to && (typeSet ? typeSet.has(e.type) : true)
    );
    const order = opts.order ?? "asc";
    const ordered = order === "desc" ? [...filtered].reverse() : filtered;
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    if (order === "desc") return ordered.slice(0, limit);
    return ordered.slice(-limit);
  }

  getTimelinePage(
    taskId: string,
    userId: number,
    opts: {
      now?: number;
      from?: number;
      to?: number;
      cursor?: number;
      limit?: number;
      types?: Array<"task_created" | "step_approved" | "step_reported">;
      order?: "asc" | "desc";
    } = {}
  ): {
    events: Array<{
      type: "task_created" | "step_approved" | "step_reported";
      eventId: string;
      schemaVersion: 1;
      at: number;
      source: "ui" | "tool" | "system";
      actor: "user" | "agent" | "system";
      stepId?: string;
      ok?: boolean;
      detail?: string;
      errorCode?: string;
    }>;
    nextCursor: number | null;
  } {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const to = opts.cursor ? Math.min(opts.to ?? Number.POSITIVE_INFINITY, opts.cursor - 1) : opts.to;
    const events = this.getTimeline(taskId, userId, {
      now: opts.now,
      from: opts.from,
      to,
      limit: 10_000,
      types: opts.types,
      order: "asc",
    });
    if (events.length <= limit) {
      return { events, nextCursor: null };
    }
    const pageAsc = events.slice(-limit);
    const nextCursor = pageAsc[0]?.at ?? null;
    const order = opts.order ?? "asc";
    const page = order === "desc" ? [...pageAsc].reverse() : pageAsc;
    return { events: page, nextCursor };
  }
}

export const orbTaskStore = new OrbTaskStore(process.env.ORB_TASK_STORE_FILE);
