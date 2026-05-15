/**
 * server/services/spiritStatusMonitor.ts
 *
 * Spirit Status Monitoring System
 *
 * Tracks the real-time status of all AI spirits (精靈) in the system.
 * Enables chief-orchestrator (總總) to monitor and coordinate the team.
 *
 * Key features:
 * - Track spirit status: idle, busy, error
 * - Record current task and progress
 * - Monitor task duration and detect stuck tasks
 * - Provide team-wide status queries
 */

import type { AgentRole } from "../../shared/orb-agent-roles";
import { logger } from "../_core/logger";

export type SpiritStatusState = "idle" | "busy" | "error" | "offline";

export interface SpiritStatus {
  /** Spirit identifier (e.g., "image-specialist", "video-specialist") */
  spiritId: AgentRole;
  /** Current status */
  status: SpiritStatusState;
  /** Current task ID if busy */
  currentTaskId?: string;
  /** Task type description */
  currentTaskType?: string;
  /** Task started timestamp */
  startedAt?: number;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Last error message if status is 'error' */
  lastError?: string;
  /** Last error timestamp */
  lastErrorAt?: number;
  /** Last status update timestamp */
  lastUpdatedAt: number;
  /** User ID associated with current task */
  userId?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface SpiritTaskUpdate {
  spiritId: AgentRole;
  taskId: string;
  taskType: string;
  userId?: number;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface TeamStatusSummary {
  /** Total number of spirits */
  totalSpirits: number;
  /** Number of idle spirits */
  idleCount: number;
  /** Number of busy spirits */
  busyCount: number;
  /** Number of spirits with errors */
  errorCount: number;
  /** Number of offline spirits */
  offlineCount: number;
  /** All spirit statuses */
  spirits: SpiritStatus[];
  /** Tasks running longer than threshold (5 minutes) */
  longRunningTasks: Array<{
    spiritId: AgentRole;
    taskId: string;
    duration: number;
    taskType?: string;
  }>;
  /** Tasks with a deadline that's already passed or within the at-risk window */
  atRiskTasks: Array<{
    spiritId: AgentRole;
    taskId: string;
    taskType?: string;
    deadlineAt: number;
    remainingMs: number;
    overdue: boolean;
  }>;
  /** Recent errors (last 10) */
  recentErrors: Array<{
    spiritId: AgentRole;
    error: string;
    occurredAt: number;
  }>;
}

/**
 * Outcome of a finished task, recorded so the orchestrator can learn which
 * spirits handle which task types reliably and which keep failing.
 * Kept in a bounded in-memory ring (HISTORY_LIMIT) — production callers that
 * want long-term stats should persist these separately.
 */
export interface TaskOutcomeRecord {
  spiritId: AgentRole;
  taskId: string;
  taskType: string;
  outcome: "success" | "failure" | "cancelled";
  durationMs: number;
  recordedAt: number;
  /** When outcome === "failure", the error message that ended the task. */
  errorMessage?: string;
}

export interface TaskDeadline {
  taskId: string;
  spiritId: AgentRole;
  deadlineAt: number;
  setAt: number;
}

/**
 * In-memory status store for all spirits.
 * In production, this could be backed by Redis or another distributed cache.
 */
class SpiritStatusMonitorClass {
  private statusMap: Map<AgentRole, SpiritStatus> = new Map();
  private readonly LONG_RUNNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  /** A task is "at risk" if its deadline is within this window. */
  private readonly DEADLINE_AT_RISK_WINDOW_MS = 60 * 1000; // 1 minute
  private readonly ERROR_HISTORY_LIMIT = 10;
  /** Rolling outcome buffer used for historical success-rate calculations. */
  private readonly OUTCOME_HISTORY_LIMIT = 200;
  private errorHistory: Array<{
    spiritId: AgentRole;
    error: string;
    occurredAt: number;
  }> = [];
  private outcomeHistory: TaskOutcomeRecord[] = [];
  /** Deadlines indexed by taskId — wins are unique per task. */
  private deadlines: Map<string, TaskDeadline> = new Map();

  /**
   * All spirit roles that can be monitored.
   * 必須涵蓋全 25 位 AgentRole — 不然總總 (chief-orchestrator) 的
   * 「團隊現況」永遠看不到 6 通用 role 與 3 主動 trio 的 busy 狀態。
   */
  private readonly MONITORED_SPIRITS: readonly AgentRole[] = [
    // 6 通用 role
    "director",
    "composer",
    "critic",
    "researcher",
    "navigator",
    "companion",
    // 3 主動 trio
    "accountant",
    "quality-coach",
    "inspector",
    // 6 多模態 specialist
    "image-specialist",
    "video-specialist",
    "music-specialist",
    "voice-specialist",
    "training-specialist",
    "learning-specialist",
    // 8 位新增精靈
    "legal-advisor",
    "security-guard",
    "community-manager",
    "chief-orchestrator",
    "onboarding-coach",
    "notes-curator",
    "settings-detail",
    "plan-executor",
    // 靈靈 / 體體
    "inspiration-specialist",
    "anatomy-specialist",
  ] as const;

  constructor() {
    // Initialize all spirits as idle
    this.MONITORED_SPIRITS.forEach(spiritId => {
      this.statusMap.set(spiritId, {
        spiritId,
        status: "idle",
        lastUpdatedAt: Date.now(),
      });
    });

    logger.info("spirit_status_monitor_initialized", {
      totalSpirits: this.MONITORED_SPIRITS.length,
    });
  }

  /**
   * Start tracking a new task for a spirit
   */
  startTask(update: SpiritTaskUpdate): void {
    const current = this.statusMap.get(update.spiritId);
    if (!current) {
      logger.warn("spirit_not_found", { spiritId: update.spiritId });
      return;
    }

    const newStatus: SpiritStatus = {
      ...current,
      status: "busy",
      currentTaskId: update.taskId,
      currentTaskType: update.taskType,
      startedAt: Date.now(),
      progress: update.progress ?? 0,
      userId: update.userId,
      metadata: update.metadata,
      lastUpdatedAt: Date.now(),
      // Clear previous error when starting new task
      lastError: undefined,
      lastErrorAt: undefined,
    };

    this.statusMap.set(update.spiritId, newStatus);

    logger.debug("spirit_task_started", {
      spiritId: update.spiritId,
      taskId: update.taskId,
      taskType: update.taskType,
      userId: update.userId,
    });
  }

  /**
   * Update progress for a running task
   */
  updateProgress(spiritId: AgentRole, progress: number, metadata?: Record<string, unknown>): void {
    const current = this.statusMap.get(spiritId);
    if (!current) {
      logger.warn("spirit_not_found", { spiritId });
      return;
    }

    if (current.status !== "busy") {
      logger.warn("spirit_not_busy", { spiritId, currentStatus: current.status });
      return;
    }

    const newStatus: SpiritStatus = {
      ...current,
      progress: Math.max(0, Math.min(100, progress)),
      metadata: metadata ? { ...current.metadata, ...metadata } : current.metadata,
      lastUpdatedAt: Date.now(),
    };

    this.statusMap.set(spiritId, newStatus);

    logger.debug("spirit_progress_updated", {
      spiritId,
      progress,
      taskId: current.currentTaskId,
    });
  }

  /**
   * Complete a task and return spirit to idle
   */
  completeTask(spiritId: AgentRole, taskId: string): void {
    const current = this.statusMap.get(spiritId);
    if (!current) {
      logger.warn("spirit_not_found", { spiritId });
      return;
    }

    if (current.currentTaskId !== taskId) {
      logger.warn("task_id_mismatch", {
        spiritId,
        expectedTaskId: current.currentTaskId,
        providedTaskId: taskId,
      });
      return;
    }

    const duration = current.startedAt ? Date.now() - current.startedAt : 0;
    const taskType = current.currentTaskType ?? "unknown";

    const newStatus: SpiritStatus = {
      spiritId,
      status: "idle",
      lastUpdatedAt: Date.now(),
      // Clear task-related fields
      currentTaskId: undefined,
      currentTaskType: undefined,
      startedAt: undefined,
      progress: undefined,
      userId: undefined,
      metadata: undefined,
    };

    this.statusMap.set(spiritId, newStatus);
    this.recordOutcome({
      spiritId,
      taskId,
      taskType,
      outcome: "success",
      durationMs: duration,
      recordedAt: Date.now(),
    });
    this.deadlines.delete(taskId);

    logger.info("spirit_task_completed", {
      spiritId,
      taskId,
      durationMs: duration,
    });
  }

  /**
   * Mark a spirit as having an error
   */
  reportError(spiritId: AgentRole, error: string, taskId?: string): void {
    const current = this.statusMap.get(spiritId);
    if (!current) {
      logger.warn("spirit_not_found", { spiritId });
      return;
    }

    const now = Date.now();

    const newStatus: SpiritStatus = {
      ...current,
      status: "error",
      lastError: error,
      lastErrorAt: now,
      lastUpdatedAt: now,
    };

    this.statusMap.set(spiritId, newStatus);

    // Add to error history
    this.errorHistory.unshift({
      spiritId,
      error,
      occurredAt: now,
    });

    // Trim error history
    if (this.errorHistory.length > this.ERROR_HISTORY_LIMIT) {
      this.errorHistory = this.errorHistory.slice(0, this.ERROR_HISTORY_LIMIT);
    }

    // Failure outcome — only when the failing task is identifiable. Prefer the
    // caller-supplied taskId; fall back to the spirit's current task if the
    // caller omitted it (older call sites). Without either, we still flag the
    // spirit but don't pollute outcome history with phantom records.
    const failedTaskId = taskId ?? current.currentTaskId;
    if (failedTaskId) {
      const duration = current.startedAt ? now - current.startedAt : 0;
      this.recordOutcome({
        spiritId,
        taskId: failedTaskId,
        taskType: current.currentTaskType ?? "unknown",
        outcome: "failure",
        durationMs: duration,
        recordedAt: now,
        errorMessage: error,
      });
      this.deadlines.delete(failedTaskId);
    }

    logger.error("spirit_error_reported", {
      spiritId,
      error,
      taskId,
    });
  }

  /**
   * Recover a spirit from error state back to idle
   */
  recoverFromError(spiritId: AgentRole): void {
    const current = this.statusMap.get(spiritId);
    if (!current) {
      logger.warn("spirit_not_found", { spiritId });
      return;
    }

    if (current.status !== "error") {
      logger.warn("spirit_not_in_error", { spiritId, currentStatus: current.status });
      return;
    }

    const newStatus: SpiritStatus = {
      spiritId,
      status: "idle",
      lastUpdatedAt: Date.now(),
      // Preserve error info for debugging
      lastError: current.lastError,
      lastErrorAt: current.lastErrorAt,
    };

    this.statusMap.set(spiritId, newStatus);

    logger.info("spirit_recovered_from_error", { spiritId });
  }

  /**
   * Get status of a specific spirit
   */
  getStatus(spiritId: AgentRole): SpiritStatus | null {
    return this.statusMap.get(spiritId) ?? null;
  }

  /**
   * Get statuses of all spirits
   */
  getAllStatuses(): SpiritStatus[] {
    return Array.from(this.statusMap.values());
  }

  /**
   * Get comprehensive team status summary
   */
  getTeamSummary(): TeamStatusSummary {
    const spirits = this.getAllStatuses();
    const now = Date.now();

    const summary: TeamStatusSummary = {
      totalSpirits: spirits.length,
      idleCount: spirits.filter(s => s.status === "idle").length,
      busyCount: spirits.filter(s => s.status === "busy").length,
      errorCount: spirits.filter(s => s.status === "error").length,
      offlineCount: spirits.filter(s => s.status === "offline").length,
      spirits,
      longRunningTasks: [],
      atRiskTasks: [],
      recentErrors: [...this.errorHistory],
    };

    // Detect long-running tasks + collect at-risk-by-deadline tasks
    spirits.forEach(spirit => {
      if (spirit.status === "busy" && spirit.startedAt && spirit.currentTaskId) {
        const duration = now - spirit.startedAt;
        if (duration > this.LONG_RUNNING_THRESHOLD_MS) {
          summary.longRunningTasks.push({
            spiritId: spirit.spiritId,
            taskId: spirit.currentTaskId,
            duration,
            taskType: spirit.currentTaskType,
          });
        }

        const deadline = this.deadlines.get(spirit.currentTaskId);
        if (deadline) {
          const remainingMs = deadline.deadlineAt - now;
          if (remainingMs <= this.DEADLINE_AT_RISK_WINDOW_MS) {
            summary.atRiskTasks.push({
              spiritId: spirit.spiritId,
              taskId: spirit.currentTaskId,
              taskType: spirit.currentTaskType,
              deadlineAt: deadline.deadlineAt,
              remainingMs,
              overdue: remainingMs < 0,
            });
          }
        }
      }
    });

    return summary;
  }

  /**
   * Get statuses filtered by status state
   */
  getSpiritsByStatus(status: SpiritStatusState): SpiritStatus[] {
    return Array.from(this.statusMap.values()).filter(s => s.status === status);
  }

  /**
   * Get all spirits currently working on tasks for a specific user
   */
  getSpiritsForUser(userId: number): SpiritStatus[] {
    return Array.from(this.statusMap.values()).filter(
      s => s.status === "busy" && s.userId === userId
    );
  }

  /**
   * Check if a spirit is available (idle or has low progress)
   */
  isSpiritAvailable(spiritId: AgentRole): boolean {
    const status = this.statusMap.get(spiritId);
    if (!status) return false;

    if (status.status === "idle") return true;
    if (status.status === "busy" && status.progress !== undefined && status.progress < 10) {
      // Spirit just started a task, might be available for quick queries
      return true;
    }

    return false;
  }

  /**
   * Get statistics for monitoring dashboards
   */
  getStatistics(): {
    statusDistribution: Record<SpiritStatusState, number>;
    averageTaskDuration: number;
    totalTasksInProgress: number;
    errorRate: number;
  } {
    const spirits = this.getAllStatuses();
    const busySpirits = spirits.filter(s => s.status === "busy");
    const now = Date.now();

    const statusDistribution: Record<SpiritStatusState, number> = {
      idle: spirits.filter(s => s.status === "idle").length,
      busy: busySpirits.length,
      error: spirits.filter(s => s.status === "error").length,
      offline: spirits.filter(s => s.status === "offline").length,
    };

    const durations = busySpirits
      .filter(s => s.startedAt)
      .map(s => now - s.startedAt!);

    const averageTaskDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    const errorRate = spirits.length > 0
      ? statusDistribution.error / spirits.length
      : 0;

    return {
      statusDistribution,
      averageTaskDuration,
      totalTasksInProgress: busySpirits.length,
      errorRate,
    };
  }

  /**
   * Reset all spirits to idle (useful for testing or system restart)
   */
  resetAll(): void {
    const now = Date.now();
    this.MONITORED_SPIRITS.forEach(spiritId => {
      this.statusMap.set(spiritId, {
        spiritId,
        status: "idle",
        lastUpdatedAt: now,
      });
    });

    this.errorHistory = [];
    this.outcomeHistory = [];
    this.deadlines.clear();

    logger.info("all_spirits_reset_to_idle", {
      totalSpirits: this.MONITORED_SPIRITS.length,
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Autonomy features for chief-orchestrator (總總)
  //
  // The methods below let 總總 reason about who to pick, who to retry on,
  // and which tasks are at risk — turning the monitor from a read-only
  // dashboard into an active decision support layer.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Append a finished-task record to the rolling outcome history. Bounded
   * by OUTCOME_HISTORY_LIMIT so the buffer never grows unbounded in long-
   * running processes. Newest records live at index 0.
   */
  recordOutcome(record: TaskOutcomeRecord): void {
    this.outcomeHistory.unshift(record);
    if (this.outcomeHistory.length > this.OUTCOME_HISTORY_LIMIT) {
      this.outcomeHistory = this.outcomeHistory.slice(0, this.OUTCOME_HISTORY_LIMIT);
    }
  }

  /**
   * Read-only access to the outcome history (newest first). Callers must
   * not mutate the returned array — defensive copy.
   */
  getOutcomeHistory(filter?: { spiritId?: AgentRole; taskType?: string }): TaskOutcomeRecord[] {
    return this.outcomeHistory.filter(o => {
      if (filter?.spiritId && o.spiritId !== filter.spiritId) return false;
      if (filter?.taskType && o.taskType !== filter.taskType) return false;
      return true;
    });
  }

  /**
   * Compute success rate (0..1) for a spirit, optionally filtered by task type.
   * Returns `null` when there's no history to score against — callers should
   * treat that as "unknown" rather than "zero".
   */
  getSuccessRate(
    spiritId: AgentRole,
    taskType?: string
  ): { successRate: number; sampleSize: number } | null {
    const records = this.getOutcomeHistory({ spiritId, taskType });
    if (records.length === 0) return null;

    const successes = records.filter(r => r.outcome === "success").length;
    return {
      successRate: successes / records.length,
      sampleSize: records.length,
    };
  }

  /**
   * Set a soft deadline for a running task. Used by `getTeamSummary` to surface
   * at-risk tasks so 總總 can intervene before SLA breach instead of after.
   * Returns false if the task isn't currently owned by any spirit.
   */
  setDeadline(taskId: string, deadlineAt: number): boolean {
    const owner = this.getAllStatuses().find(s => s.currentTaskId === taskId);
    if (!owner) {
      logger.warn("set_deadline_no_owner", { taskId });
      return false;
    }
    this.deadlines.set(taskId, {
      taskId,
      spiritId: owner.spiritId,
      deadlineAt,
      setAt: Date.now(),
    });
    return true;
  }

  /** Remove a deadline (e.g. user cancelled the task externally). */
  clearDeadline(taskId: string): void {
    this.deadlines.delete(taskId);
  }

  /**
   * Pick the least-loaded available spirit from a candidate list. Used by
   * 總總 when more than one spirit can handle the same domain — gives
   * preference to idle > low-progress busy > anything-else. Returns null
   * when every candidate is unavailable.
   */
  getLeastLoadedSpirit(candidates: ReadonlyArray<AgentRole>): AgentRole | null {
    type Scored = { spiritId: AgentRole; score: number };
    const scored: Scored[] = [];

    candidates.forEach(spiritId => {
      const status = this.statusMap.get(spiritId);
      if (!status) return;

      // Score: higher is better. idle=100, just-started=60, busy=20, error=0, offline=skip.
      let score = 0;
      if (status.status === "idle") score = 100;
      else if (status.status === "busy") {
        score = status.progress !== undefined && status.progress < 10 ? 60 : 20;
      } else if (status.status === "error") score = 0;
      else return; // offline → don't consider

      scored.push({ spiritId, score });
    });

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].spiritId;
  }

  /**
   * Group long-running tasks by spirit + task type so 總總 can spot patterns
   * ("video-specialist is stuck on every lipSync run today"). Returns the
   * counts so callers can rank intervention priority.
   */
  getStuckTaskAnalysis(): Array<{
    spiritId: AgentRole;
    taskType: string;
    stuckCount: number;
    longestDurationMs: number;
  }> {
    const now = Date.now();
    type Key = string;
    const buckets = new Map<Key, {
      spiritId: AgentRole;
      taskType: string;
      stuckCount: number;
      longestDurationMs: number;
    }>();

    this.getAllStatuses().forEach(spirit => {
      if (
        spirit.status !== "busy" ||
        !spirit.startedAt ||
        !spirit.currentTaskId
      ) {
        return;
      }
      const duration = now - spirit.startedAt;
      if (duration <= this.LONG_RUNNING_THRESHOLD_MS) return;

      const taskType = spirit.currentTaskType ?? "unknown";
      const key = `${spirit.spiritId}::${taskType}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.stuckCount += 1;
        existing.longestDurationMs = Math.max(existing.longestDurationMs, duration);
      } else {
        buckets.set(key, {
          spiritId: spirit.spiritId,
          taskType,
          stuckCount: 1,
          longestDurationMs: duration,
        });
      }
    });

    return Array.from(buckets.values()).sort(
      (a, b) => b.longestDurationMs - a.longestDurationMs
    );
  }

  /**
   * Rank spirits by recent failure rate so 總總 can see who's degraded
   * before assigning new work. Only includes spirits with at least one
   * recorded outcome — silent ones aren't penalised.
   */
  getFailureClusters(windowMs: number = 60 * 60 * 1000): Array<{
    spiritId: AgentRole;
    failureCount: number;
    successCount: number;
    failureRate: number;
  }> {
    const cutoff = Date.now() - windowMs;
    type Bucket = { failureCount: number; successCount: number };
    const buckets = new Map<AgentRole, Bucket>();

    this.outcomeHistory.forEach(record => {
      if (record.recordedAt < cutoff) return;
      const b = buckets.get(record.spiritId) ?? { failureCount: 0, successCount: 0 };
      if (record.outcome === "failure") b.failureCount += 1;
      else if (record.outcome === "success") b.successCount += 1;
      buckets.set(record.spiritId, b);
    });

    return Array.from(buckets.entries())
      .map(([spiritId, b]) => {
        const total = b.failureCount + b.successCount;
        return {
          spiritId,
          failureCount: b.failureCount,
          successCount: b.successCount,
          failureRate: total > 0 ? b.failureCount / total : 0,
        };
      })
      .filter(entry => entry.failureCount > 0)
      .sort((a, b) => b.failureRate - a.failureRate);
  }
}

// Singleton instance
export const SpiritStatusMonitor = new SpiritStatusMonitorClass();
