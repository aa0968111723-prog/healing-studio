import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { runSchemaFirstAgentPlanner } from "./agentPlanner";
import { runOrbTaskToCompletion } from "./orbTaskOrchestrator";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import { loadAgentPreferencesForUser } from "./agentPreferenceService";
import { orbScheduledJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { orbTaskStore } from "./orbTaskStore";
import { SCHEDULER_TIMEZONE } from "./cronPreview";
import { invokeLLM, extractMessageText, type InvokeParams, type InvokeResult } from "../_core/llm";

// All user-defined orb cron expressions are interpreted in this timezone so
// they fire at the wall-clock time Taiwanese users expect (and the time the
// preview UI showed them when they saved the schedule).
const CRON_OPTIONS = { timezone: SCHEDULER_TIMEZONE } as const;

export interface OrbScheduledJob {
  id: string;
  userId: number;
  cronExpression: string;
  taskDescription: string;
  enabled: boolean;
  lastRunAt?: number;
  lastError?: string;
  /**
   * What the most recent run actually produced. For tasked plans this is the
   * planner's `summaryForUser`; for fallback runs (planner returned
   * invalid / clarification / blocked / converted) this is the direct LLM's
   * report text. Surfaced in the panel so users can see the cron actually
   * did something useful instead of a bare error code.
   */
  lastResult?: string;
  /**
   * Compact status code for the most recent run. Examples:
   *   "completed"            – orchestrator finished every step
   *   "outcome:failed"       – orchestrator ran but a step failed
   *   "fallback:invalid"     – planner couldn't structure the task; ran
   *                            direct-LLM fallback instead
   *   "error"                – the run threw before producing output
   */
  lastRunStatus?: string;
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
  payload: {
    lastRunAt: number;
    lastError?: string;
    lastResult?: string;
    lastRunStatus?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Try the full update first. If migration 0024 hasn't been applied yet the
  // lastResult / lastRunStatus columns don't exist — drop them and retry so
  // we never lose the lastRunAt / lastError write that the UI relies on.
  try {
    await db
      .update(orbScheduledJobs)
      .set({
        lastRunAt: new Date(payload.lastRunAt),
        lastError: payload.lastError ?? null,
        lastResult: payload.lastResult ?? null,
        lastRunStatus: payload.lastRunStatus ?? null,
      })
      .where(eq(orbScheduledJobs.id, jobId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unknown column|column .*does not exist/i.test(message)) {
      try {
        await db
          .update(orbScheduledJobs)
          .set({
            lastRunAt: new Date(payload.lastRunAt),
            lastError: payload.lastError ?? null,
          })
          .where(eq(orbScheduledJobs.id, jobId));
        return;
      } catch (fallbackError) {
        console.warn(
          "[OrbScheduler] recordRunResult fallback failed:",
          fallbackError instanceof Error ? fallbackError.message : fallbackError
        );
        return;
      }
    }
    console.warn("[OrbScheduler] recordRunResult failed:", message);
  }
}

/**
 * Direct-LLM fallback used when the schema-first planner can't produce a
 * `tasked` plan for the user's description. Most user-supplied schedule
 * descriptions ("整理昨日生成紀錄成短報告", "盤點素材庫近 30 天沒用到的圖片")
 * are analytical/reporting tasks: they don't need a structured multi-step
 * tool plan, just a textual answer. Without this fallback the scheduler
 * would swallow the error and only persist `planner-status:invalid`,
 * leaving users with a red badge and nothing to read. With it, every
 * cron tick produces real text the user can act on.
 *
 * Pluggable via the `invoke` parameter so tests can stub the LLM call.
 */
export async function runDirectLlmFallback(
  taskDescription: string,
  invoke: (params: InvokeParams) => Promise<InvokeResult> = invokeLLM
): Promise<string> {
  const result = await invoke({
    messages: [
      {
        role: "system",
        content:
          "你是排程助理。使用者排了一個定時任務，但這個任務不需要呼叫工具，只需要文字輸出。請依使用者描述產出一份精簡的繁中報告（150–400 字）：先用一句話說明任務目的，接著用條列或段落呈現結論，最後給一個明確的下一步建議。直接輸出純文字，不要 JSON、不要 Markdown 標題。",
      },
      { role: "user", content: taskDescription },
    ],
    runName: "orb-scheduler-direct-fallback",
    maxTokens: 800,
  });
  const text = extractMessageText(result.choices[0]?.message?.content).trim();
  return text || "（任務已執行，但模型未回傳內容）";
}

/**
 * Trim text to a UI-friendly size before persisting. The DB column is TEXT
 * (~64KB) so this is purely about not surfacing a wall of text in the
 * settings panel; the truncation marker tells the user there was more.
 */
function clampForPersistence(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…\n\n（已截斷，原文 ${text.length} 字）`;
}

/**
 * Test seams: override the planner and fallback so unit tests can drive
 * `runScheduledOrbJob` end-to-end without booting a real LLM. Callers in
 * production pass nothing and get the real implementations.
 */
export interface RunScheduledOrbJobDeps {
  runPlanner?: typeof runSchemaFirstAgentPlanner;
  runFallback?: (taskDescription: string) => Promise<string>;
}

export async function runScheduledOrbJob(
  job: OrbScheduledJob,
  deps: RunScheduledOrbJobDeps = {}
): Promise<void> {
  const runPlanner = deps.runPlanner ?? runSchemaFirstAgentPlanner;
  const runFallback = deps.runFallback ?? runDirectLlmFallback;
  // The cron callback is invoked by node-cron's worker thread. We MUST
  // catch every error here — an unhandled rejection bubbling out would
  // crash the entire scheduler, taking every other user's job down with
  // it. The job's lastError is persisted so the UI can surface it.
  try {
    const plannerResult = await runPlanner({
      messages: [{ role: "user", content: job.taskDescription }],
    });

    if (plannerResult.status === "tasked" && plannerResult.task) {
      const tools = getOrbToolRegistry();
      const agentPreferences = await loadAgentPreferencesForUser(job.userId);
      // Materialize the plan into the legacy store so the orchestrator can
      // walk every step. Scheduled jobs run unattended → pre-approve so the
      // driver doesn't park at the first requiresApproval gate.
      const stored = orbTaskStore.create({
        userId: job.userId,
        intent: plannerResult.task.intent,
        needsApproval: false,
        steps: plannerResult.task.steps.map(step => ({
          id: step.id,
          label: step.label,
          pagePath: step.pagePath,
          uiActions: step.uiActions,
          toolCalls: step.toolCalls,
        })),
      });

      const result = await runOrbTaskToCompletion({
        taskId: stored.taskId,
        userId: job.userId,
        userRole: "user",
        tools,
        requestId: `orb_scheduler_${job.id}_${Date.now()}`,
        agentPreferences,
      });

      const ok = result.outcome === "completed";
      const planSummary = (plannerResult.reply ?? plannerResult.task.intent ?? "").trim();
      job.lastRunAt = Date.now();
      job.lastError = ok
        ? undefined
        : `outcome=${result.outcome} reason=${result.reason ?? "unknown"}`;
      job.lastRunStatus = ok ? "completed" : `outcome:${result.outcome}`;
      job.lastResult = planSummary
        ? clampForPersistence(planSummary)
        : undefined;
      await recordRunResult(job.id, {
        lastRunAt: job.lastRunAt,
        lastError: job.lastError,
        lastResult: job.lastResult,
        lastRunStatus: job.lastRunStatus,
      });
      return;
    }

    // Planner returned clarification / blocked / converted / invalid —
    // none of those are actionable through the orchestrator path. Run the
    // direct-LLM fallback so the user always gets a usable text result
    // back from every cron tick, instead of just `planner-status:invalid`.
    const fallbackText = await runFallback(job.taskDescription);
    job.lastRunAt = Date.now();
    job.lastError = undefined;
    job.lastRunStatus = `fallback:${plannerResult.status}`;
    job.lastResult = clampForPersistence(fallbackText);
    await recordRunResult(job.id, {
      lastRunAt: job.lastRunAt,
      lastError: undefined,
      lastResult: job.lastResult,
      lastRunStatus: job.lastRunStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.lastRunAt = Date.now();
    job.lastError = message;
    job.lastRunStatus = "error";
    job.lastResult = undefined;
    console.error(
      `[OrbScheduler] job "${job.id}" failed during run:`,
      message
    );
    await recordRunResult(job.id, {
      lastRunAt: job.lastRunAt,
      lastError: message,
      lastResult: undefined,
      lastRunStatus: "error",
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

  const task = cron.schedule(
    job.cronExpression,
    () => {
      void runScheduledOrbJob(job);
    },
    CRON_OPTIONS
  );

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

export function getScheduledJob(jobId: string): OrbScheduledJob | undefined {
  return jobRegistry.get(jobId)?.job;
}

/**
 * Toggle a job's enabled flag without losing its definition. When disabled
 * we stop the cron task but keep the row in the DB so the user can resume
 * it later from the panel without re-typing the cron expression.
 *
 * `expectedUserId` is the caller's authenticated user id. When provided,
 * mutations are refused unless the persisted job belongs to that user —
 * without this guard the DB-lookup fallback (used after a server restart
 * before the cron registry has been rebuilt) would mutate ANY tenant's
 * job because the legacy code only looked up by id. The route still
 * double-checks the returned row, but doing the gate inside the service
 * means no DB write ever happens for a cross-tenant request.
 */
export async function setOrbJobEnabled(
  jobId: string,
  enabled: boolean,
  expectedUserId?: number
): Promise<OrbScheduledJob | undefined> {
  const existing = jobRegistry.get(jobId);
  if (!existing) {
    // Not in memory — try to load it from DB (e.g. server just rebooted and
    // the cron rebuild raced with the user's click).
    try {
      const db = await getDb();
      if (!db) return undefined;
      const rows = await db
        .select()
        .from(orbScheduledJobs)
        .where(eq(orbScheduledJobs.id, jobId))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      if (expectedUserId !== undefined && row.userId !== expectedUserId) {
        // Cross-tenant request — refuse to read state back to the caller
        // and refuse to mutate. Return undefined so the route's NOT_FOUND
        // path fires (same surface as "no such job"), avoiding the leak
        // that the row exists for another user.
        return undefined;
      }
      const job: OrbScheduledJob = { ...rowToJob(row as ScheduledJobRow), enabled };
      await scheduleOrbJob(job);
      return job;
    } catch (error) {
      console.warn(
        "[OrbScheduler] setOrbJobEnabled DB lookup failed:",
        error instanceof Error ? error.message : error
      );
      return undefined;
    }
  }

  if (expectedUserId !== undefined && existing.job.userId !== expectedUserId) {
    return undefined;
  }

  existing.job.enabled = enabled;
  if (enabled) {
    await scheduleOrbJob(existing.job);
  } else {
    try {
      existing.task.stop();
      existing.task.destroy();
    } catch {
      // best-effort
    }
    jobRegistry.delete(jobId);
    await persistJob({ ...existing.job, enabled: false });
  }
  return existing.job;
}

type ScheduledJobRow = typeof orbScheduledJobs.$inferSelect & {
  lastResult?: string | null;
  lastRunStatus?: string | null;
};

function rowToJob(row: ScheduledJobRow): OrbScheduledJob {
  return {
    id: row.id,
    userId: row.userId,
    cronExpression: row.cronExpression,
    taskDescription: row.taskDescription,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt ? row.lastRunAt.getTime() : undefined,
    lastError: row.lastError ?? undefined,
    lastResult: row.lastResult ?? undefined,
    lastRunStatus: row.lastRunStatus ?? undefined,
  };
}

async function loadPersistedJobs(): Promise<OrbScheduledJob[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(orbScheduledJobs);
    return rows.map(row => rowToJob(row as ScheduledJobRow));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("no such table")
    ) {
      console.info(
        "[OrbScheduler] orb_scheduled_jobs table not found yet; skipping persisted-job reload."
      );
      return [];
    }
    console.warn(
      "[OrbScheduler] loadPersistedJobs failed (table may not exist yet):",
      message
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
      const task = cron.schedule(
        job.cronExpression,
        () => {
          void runScheduledOrbJob(job);
        },
        CRON_OPTIONS
      );
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
