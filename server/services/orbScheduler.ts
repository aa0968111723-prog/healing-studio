import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { runSchemaFirstAgentPlanner } from "./agentPlanner";
import { executeCurrentStepTools } from "./orbTaskOrchestrator";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import { loadAgentPreferencesForUser } from "./agentPreferenceService";
import { orbScheduledJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import type { OrbTask } from "../../shared/orb-agent-contract";

export interface OrbScheduledJob {
  id: string;
  userId: number;
  cronExpression: string;
  taskDescription: string;
  enabled: boolean;
  lastRunAt?: number;
  lastError?: string;
}

type ScheduledJobRecord = {
  job: OrbScheduledJob;
  task: ScheduledTask;
};

const jobRegistry = new Map<string, ScheduledJobRecord>();

/**
 * Validate a cron expression. node-cron's `validate` accepts both 5-field
 * and 6-field forms (the 6-field form has a leading seconds field). We
 * keep both since the route accepts whatever the user typed.
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    return cron.validate(expression);
  } catch {
    return false;
  }
}

async function persistJob(job: OrbScheduledJob): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .insert(orbScheduledJobs)
      .values({
        id: job.id,
        userId: job.userId,
        cronExpression: job.cronExpression,
        taskDescription: job.taskDescription,
        enabled: job.enabled,
      })
      .onDuplicateKeyUpdate({
        set: {
          userId: job.userId,
          cronExpression: job.cronExpression,
          taskDescription: job.taskDescription,
          enabled: job.enabled,
        },
      });
  } catch (error) {
    console.warn(
      "[OrbScheduler] persistJob failed (continuing in-memory):",
      error instanceof Error ? error.message : error
    );
  }
}

async function deleteJobRow(jobId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.delete(orbScheduledJobs).where(eq(orbScheduledJobs.id, jobId));
  } catch (error) {
    console.warn(
      "[OrbScheduler] deleteJobRow failed:",
      error instanceof Error ? error.message : error
    );
  }
}

async function recordRunResult(
  jobId: string,
  payload: { lastRunAt: number; lastError?: string }
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(orbScheduledJobs)
      .set({
        lastRunAt: new Date(payload.lastRunAt),
        lastError: payload.lastError ?? null,
      })
      .where(eq(orbScheduledJobs.id, jobId));
  } catch (error) {
    console.warn(
      "[OrbScheduler] recordRunResult failed:",
      error instanceof Error ? error.message : error
    );
  }
}

async function runScheduledOrbJob(job: OrbScheduledJob): Promise<void> {
  // The cron callback is invoked by node-cron's worker thread. We MUST
  // catch every error here — an unhandled rejection bubbling out would
  // crash the entire scheduler, taking every other user's job down with
  // it. The job's lastError is persisted so the UI can surface it.
  try {
    const plannerResult = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: job.taskDescription }],
    });

    if (plannerResult.status !== "tasked" || !plannerResult.task) {
      job.lastRunAt = Date.now();
      job.lastError = `planner-status:${plannerResult.status}`;
      await recordRunResult(job.id, {
        lastRunAt: job.lastRunAt,
        lastError: job.lastError,
      });
      return;
    }

    const tools = getOrbToolRegistry();
    const agentPreferences = await loadAgentPreferencesForUser(job.userId);
    const now = Date.now();
    const orchestratorTask: OrbTask = {
      ...plannerResult.task,
      userId: job.userId,
      status: "running",
      currentStepIndex: 0,
      approvedStepIds: [],
      stepApprovals: [],
      stepReports: [],
      createdAt: now,
      updatedAt: now,
    };

    await executeCurrentStepTools({
      task: orchestratorTask,
      userId: job.userId,
      userRole: "user",
      tools,
      approved: true,
      requestId: `orb_scheduler_${job.id}_${Date.now()}`,
      agentPreferences,
    });

    job.lastRunAt = Date.now();
    job.lastError = undefined;
    await recordRunResult(job.id, { lastRunAt: job.lastRunAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.lastRunAt = Date.now();
    job.lastError = message;
    console.error(
      `[OrbScheduler] job "${job.id}" failed during run:`,
      message
    );
    await recordRunResult(job.id, {
      lastRunAt: job.lastRunAt,
      lastError: message,
    });
  }
}

export async function scheduleOrbJob(job: OrbScheduledJob): Promise<void> {
  if (!isValidCronExpression(job.cronExpression)) {
    throw new Error(`Invalid cron expression: ${job.cronExpression}`);
  }

  unscheduleOrbJob(job.id, { deleteRow: false });
  await persistJob(job);
  if (!job.enabled) return;

  const task = cron.schedule(job.cronExpression, () => {
    void runScheduledOrbJob(job);
  });

  jobRegistry.set(job.id, { job, task });
}

export function unscheduleOrbJob(
  jobId: string,
  opts: { deleteRow?: boolean } = { deleteRow: true }
): void {
  const existing = jobRegistry.get(jobId);
  if (existing) {
    try {
      existing.task.stop();
      existing.task.destroy();
    } catch (error) {
      console.warn(
        `[OrbScheduler] failed to stop job "${jobId}":`,
        error instanceof Error ? error.message : error
      );
    }
    jobRegistry.delete(jobId);
  }
  if (opts.deleteRow !== false) {
    void deleteJobRow(jobId);
  }
}

export function listScheduledJobs(userId: number): OrbScheduledJob[] {
  return Array.from(jobRegistry.values())
    .map(({ job }) => job)
    .filter(job => job.userId === userId);
}

async function loadPersistedJobs(): Promise<OrbScheduledJob[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(orbScheduledJobs);
    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      cronExpression: row.cronExpression,
      taskDescription: row.taskDescription,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt ? row.lastRunAt.getTime() : undefined,
      lastError: row.lastError ?? undefined,
    }));
  } catch (error) {
    console.warn(
      "[OrbScheduler] loadPersistedJobs failed (table may not exist yet):",
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

export async function startOrbScheduler(): Promise<void> {
  // 1) Rebuild the in-process cron registry from DB rows so user-defined
  //    schedules survive restarts and multi-instance deployments.
  const persisted = await loadPersistedJobs();
  for (const job of persisted) {
    if (!isValidCronExpression(job.cronExpression)) {
      console.warn(
        `[OrbScheduler] skipping persisted job "${job.id}" — invalid cron "${job.cronExpression}"`
      );
      continue;
    }
    if (!job.enabled) continue;
    try {
      const task = cron.schedule(job.cronExpression, () => {
        void runScheduledOrbJob(job);
      });
      jobRegistry.set(job.id, { job, task });
    } catch (error) {
      console.error(
        `[OrbScheduler] failed to (re)schedule "${job.id}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  // 2) Apply env-seeded jobs (ops/admin overrides). These take precedence
  //    over DB rows with the same id and are NOT persisted, so removing
  //    them from env actually removes them from the next boot.
  const raw = process.env.ORB_SCHEDULER_SEED_JSON ?? "[]";
  let seedJobs: OrbScheduledJob[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) seedJobs = parsed as OrbScheduledJob[];
  } catch (error) {
    console.error("[OrbScheduler] Failed to parse ORB_SCHEDULER_SEED_JSON", error);
    return;
  }

  for (const seedJob of seedJobs) {
    try {
      await scheduleOrbJob(seedJob);
    } catch (error) {
      console.error(
        `[OrbScheduler] seed job "${seedJob.id}" failed to schedule:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
