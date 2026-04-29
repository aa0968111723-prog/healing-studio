import cron, { type ScheduledTask } from "node-cron";
import { runSchemaFirstAgentPlanner } from "./agentPlanner";
import { executeCurrentStepTools } from "./orbTaskOrchestrator";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import type { OrbTask } from "../../shared/orb-agent-contract";

export interface OrbScheduledJob {
  id: string;
  userId: number;
  cronExpression: string;
  taskDescription: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

type ScheduledJobRecord = {
  job: OrbScheduledJob;
  task: ScheduledTask;
};

const jobRegistry = new Map<string, ScheduledJobRecord>();

async function runScheduledOrbJob(job: OrbScheduledJob): Promise<void> {
  const plannerResult = await runSchemaFirstAgentPlanner({
    messages: [{ role: "user", content: job.taskDescription }],
  });

  if (plannerResult.status !== "tasked" || !plannerResult.task) return;

  const tools = getOrbToolRegistry();
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
  });

  job.lastRunAt = Date.now();
}

export function scheduleOrbJob(job: OrbScheduledJob): void {
  unscheduleOrbJob(job.id);
  if (!job.enabled) return;

  const task = cron.schedule(job.cronExpression, async () => {
    await runScheduledOrbJob(job);
    job.nextRunAt = Date.now();
  });

  jobRegistry.set(job.id, { job, task });
}

export function unscheduleOrbJob(jobId: string): void {
  const existing = jobRegistry.get(jobId);
  if (!existing) return;
  existing.task.stop();
  existing.task.destroy();
  jobRegistry.delete(jobId);
}

export function listScheduledJobs(userId: number): OrbScheduledJob[] {
  return Array.from(jobRegistry.values())
    .map(({ job }) => job)
    .filter(job => job.userId === userId);
}

export function startOrbScheduler(): void {
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
    scheduleOrbJob(seedJob);
  }
}
