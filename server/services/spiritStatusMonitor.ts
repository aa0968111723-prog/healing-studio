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
  /** Recent errors (last 10) */
  recentErrors: Array<{
    spiritId: AgentRole;
    error: string;
    occurredAt: number;
  }>;
}

/**
 * In-memory status store for all spirits.
 * In production, this could be backed by Redis or another distributed cache.
 */
class SpiritStatusMonitorClass {
  private statusMap: Map<AgentRole, SpiritStatus> = new Map();
  private readonly LONG_RUNNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  private readonly ERROR_HISTORY_LIMIT = 10;
  private errorHistory: Array<{
    spiritId: AgentRole;
    error: string;
    occurredAt: number;
  }> = [];

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
      recentErrors: [...this.errorHistory],
    };

    // Detect long-running tasks
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

    logger.info("all_spirits_reset_to_idle", {
      totalSpirits: this.MONITORED_SPIRITS.length,
    });
  }
}

// Singleton instance
export const SpiritStatusMonitor = new SpiritStatusMonitorClass();
