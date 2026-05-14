/**
 * server/services/spiritTools/orchestratorTools.ts
 *
 * Tools specifically for chief-orchestrator (總總).
 * Enables intent analysis, clarification, and team coordination.
 */

import type { AgentRole } from "../../../shared/orb-agent-roles";
import {
  analyzeOrchestratorIntent,
  shouldChiefOrchestratorClarify,
  buildOrchestratorClarificationMessage,
  type OrchestratorContext,
  type IntentClarity,
} from "../../../shared/orchestrator-clarification";
import { AgentCollaborationOrchestrator } from "../agentCollaborationOrchestrator";
import { SpiritStatusMonitor, type SpiritStatus, type TeamStatusSummary } from "../spiritStatusMonitor";
import { logger } from "../../_core/logger";

export interface OrchestratorAnalysis {
  shouldClarify: boolean;
  clarity: IntentClarity;
  clarificationMessage?: {
    message: string;
    options: Array<{ key: string; title: string; description: string; pick: string }>;
  };
  suggestedHandoffs?: Array<{ toAgent: AgentRole; reason: string }>;
  teamStatus?: {
    activeSessions: number;
    participatingAgents: string[];
    nextRecommendations: string[];
  };
}

/**
 * Analyze user intent for chief-orchestrator.
 * Determines if clarification is needed before delegation.
 */
export async function analyzeIntentForOrchestrator(input: {
  userId: number;
  userMessage: string;
  sessionId?: string;
  rememberedPreferences?: OrchestratorContext["rememberedPreferences"];
}): Promise<OrchestratorAnalysis> {
  try {
    const context: OrchestratorContext = {
      userMessage: input.userMessage,
      rememberedPreferences: input.rememberedPreferences,
    };

    // Analyze intent clarity
    const clarity = analyzeOrchestratorIntent(context);
    const shouldClarify = shouldChiefOrchestratorClarify(context);

    logger.debug("orchestrator_intent_analyzed", {
      userId: input.userId,
      clarityScore: clarity.score,
      shouldClarify,
      missingDimensions: clarity.missingDimensions,
    });

    // If clarification needed, build the message and options
    let clarificationMessage;
    if (shouldClarify) {
      clarificationMessage = buildOrchestratorClarificationMessage(clarity);
    }

    // Get team status
    const stats = AgentCollaborationOrchestrator.getStats();
    const userSessions = AgentCollaborationOrchestrator.getUserSessions(input.userId);

    const teamStatus = {
      activeSessions: userSessions.length,
      participatingAgents: userSessions.flatMap(s => s.participatingAgents),
      nextRecommendations: userSessions.map(
        s => `Session ${s.collaborationId}: current = ${s.currentAgent}`
      ),
    };

    return {
      shouldClarify,
      clarity,
      clarificationMessage,
      teamStatus,
    };
  } catch (error) {
    logger.error("orchestrator_analysis_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return safe fallback - don't clarify on error
    return {
      shouldClarify: false,
      clarity: {
        score: 0.5,
        missingDimensions: [],
        suggestedQuestions: [],
      },
    };
  }
}

/**
 * Process clarification response from user.
 * Extracts chosen dimensions and updates context.
 *
 * 兩層命名空間 — 解析「總總澄清」與「使用者澄清」，並把 wizard 維度
 * (format / duration / style / platform / audience / subject / usecase /
 * purpose / open) 對應回總總的維度，讓兩層帳本互通。沒有對應映射的
 * wizard 維度會以原 key 保留，呼叫端仍能讀到完整答案。
 */
export function processClarificationResponse(
  response: string
): Record<string, string> {
  const parsed: Record<string, string> = {};

  // Layer 1: 總總's own namespace.
  // Format: "[總總澄清/goal]: 一支短影片（15-60 秒）"
  const totalMatches = response.matchAll(/\[總總澄清\/([\w]+)\]:\s*(.+?)(?=\[(?:總總澄清|使用者澄清)\/|$)/g);
  for (const match of totalMatches) {
    const dim = match[1];
    const choice = match[2].trim();
    if (dim && choice) parsed[dim] = choice;
  }

  // Layer 2: wizard's namespace. Map known wizard dims onto 總總's vocab so
  // analyzeOrchestratorIntent's previousAnswers sees them as already-answered.
  // Unknown wizard dims pass through verbatim under their own key.
  const WIZARD_TO_TOTAL: Record<string, string> = {
    format: "goal",
    duration: "goal",
    subject: "goal",
    style: "complexity",
    platform: "scope",
    audience: "scope",
    usecase: "scope",
    purpose: "scope",
  };
  const wizardMatches = response.matchAll(/\[使用者澄清\/([\w]+)\]:\s*(.+?)(?=\[(?:總總澄清|使用者澄清)\/|$)/g);
  for (const match of wizardMatches) {
    const wizardDim = match[1];
    const choice = match[2].trim();
    if (!wizardDim || !choice) continue;
    const mappedKey = WIZARD_TO_TOTAL[wizardDim] ?? wizardDim;
    // Don't overwrite a more-specific 總總 answer with a wizard answer.
    if (parsed[mappedKey]) continue;
    parsed[mappedKey] = choice;
  }

  logger.debug("clarification_response_processed", {
    parsedDimensions: Object.keys(parsed),
  });

  return parsed;
}

/**
 * Get team status summary for chief-orchestrator.
 * Returns current state of all active spirits and collaborations.
 */
export async function getTeamStatusSummary(userId: number): Promise<{
  activeSessions: number;
  sessionDetails: Array<{
    collaborationId: string;
    currentAgent: AgentRole;
    participatingAgents: AgentRole[];
    status: string;
    duration: number;
  }>;
  recommendations: string[];
}> {
  try {
    const sessions = AgentCollaborationOrchestrator.getUserSessions(userId);

    const sessionDetails = sessions.map(s => ({
      collaborationId: s.collaborationId,
      currentAgent: s.currentAgent,
      participatingAgents: s.participatingAgents,
      status: s.status,
      duration: Date.now() - s.startedAt,
    }));

    // Generate recommendations based on session state
    const recommendations: string[] = [];
    sessions.forEach(s => {
      if (s.status === "active" && Date.now() - s.startedAt > 300000) {
        // 5 minutes
        recommendations.push(
          `Session ${s.collaborationId} running for ${Math.floor((Date.now() - s.startedAt) / 60000)} minutes - may need attention`
        );
      }

      if (s.participatingAgents.length === 1) {
        recommendations.push(
          `Session ${s.collaborationId} only has ${s.currentAgent} - consider if handoff needed`
        );
      }
    });

    logger.debug("team_status_retrieved", {
      userId,
      activeSessions: sessions.length,
      recommendations: recommendations.length,
    });

    return {
      activeSessions: sessions.length,
      sessionDetails,
      recommendations,
    };
  } catch (error) {
    logger.error("team_status_summary_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      activeSessions: 0,
      sessionDetails: [],
      recommendations: ["Unable to retrieve team status"],
    };
  }
}

/**
 * Suggest optimal handoff chain for a given task.
 * Uses collaboration protocol to build recommended sequence.
 */
export function suggestHandoffChain(input: {
  fromAgent: AgentRole;
  taskType: "single_asset" | "multi_step" | "campaign";
  userPreferences?: {
    preferQuality?: boolean;
    timeConstrained?: boolean;
  };
}): Array<{ toAgent: AgentRole; reason: string; when: string }> {
  try {
    const handoffs = AgentCollaborationOrchestrator.getProtocolHandoffsFor(input.fromAgent);

    // Filter based on task type and preferences
    let filtered = handoffs;

    if (input.taskType === "single_asset") {
      // For single assets, suggest shorter chains
      filtered = handoffs.slice(0, 2);
    } else if (input.taskType === "campaign") {
      // For campaigns, include full chain
      filtered = handoffs;
    }

    logger.debug("handoff_chain_suggested", {
      fromAgent: input.fromAgent,
      taskType: input.taskType,
      chainLength: filtered.length,
    });

    return filtered.map(h => ({
      toAgent: h.to,
      reason: h.reason,
      when: h.when,
    }));
  } catch (error) {
    logger.error("handoff_chain_suggestion_failed", {
      fromAgent: input.fromAgent,
      error: error instanceof Error ? error.message : String(error),
    });

    return [];
  }
}

// ============================================================================
// NEW TOOLS FOR SPIRIT STATUS MONITORING (Gap 1 Implementation)
// ============================================================================

/**
 * Get real-time status of all spirits.
 * Returns comprehensive team monitoring data including:
 * - Spirit status (idle/busy/error)
 * - Current tasks and progress
 * - Long-running tasks
 * - Recent errors
 */
export function getAllSpiritsStatus(): TeamStatusSummary {
  try {
    const summary = SpiritStatusMonitor.getTeamSummary();

    logger.debug("all_spirits_status_retrieved", {
      totalSpirits: summary.totalSpirits,
      busyCount: summary.busyCount,
      errorCount: summary.errorCount,
      longRunningTasks: summary.longRunningTasks.length,
    });

    return summary;
  } catch (error) {
    logger.error("get_all_spirits_status_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Return safe fallback
    return {
      totalSpirits: 0,
      idleCount: 0,
      busyCount: 0,
      errorCount: 0,
      offlineCount: 0,
      spirits: [],
      longRunningTasks: [],
      recentErrors: [],
    };
  }
}

/**
 * Get status of a specific spirit.
 */
export function getSpiritStatus(spiritId: AgentRole): SpiritStatus | null {
  try {
    const status = SpiritStatusMonitor.getStatus(spiritId);

    if (status) {
      logger.debug("spirit_status_retrieved", {
        spiritId,
        status: status.status,
        currentTask: status.currentTaskId,
      });
    }

    return status;
  } catch (error) {
    logger.error("get_spirit_status_failed", {
      spiritId,
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

/**
 * Get all spirits currently working for a specific user.
 */
export function getSpiritsForUser(userId: number): SpiritStatus[] {
  try {
    const spirits = SpiritStatusMonitor.getSpiritsForUser(userId);

    logger.debug("user_spirits_retrieved", {
      userId,
      spiritCount: spirits.length,
    });

    return spirits;
  } catch (error) {
    logger.error("get_user_spirits_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return [];
  }
}

/**
 * Delegate a task to a specific spirit.
 * Starts tracking the task and updates spirit status to busy.
 */
export async function delegateTaskToSpirit(input: {
  spiritId: AgentRole;
  taskId: string;
  taskType: string;
  userId: number;
  metadata?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  message: string;
  spiritStatus?: SpiritStatus;
}> {
  try {
    // Check if spirit is available
    const currentStatus = SpiritStatusMonitor.getStatus(input.spiritId);

    if (!currentStatus) {
      return {
        success: false,
        message: `Spirit ${input.spiritId} not found in monitoring system`,
      };
    }

    if (currentStatus.status === "busy") {
      return {
        success: false,
        message: `Spirit ${input.spiritId} is already busy with task ${currentStatus.currentTaskId}`,
        spiritStatus: currentStatus,
      };
    }

    if (currentStatus.status === "error") {
      logger.warn("delegating_to_error_spirit", {
        spiritId: input.spiritId,
        lastError: currentStatus.lastError,
      });
    }

    // Start tracking the task
    SpiritStatusMonitor.startTask({
      spiritId: input.spiritId,
      taskId: input.taskId,
      taskType: input.taskType,
      userId: input.userId,
      metadata: input.metadata,
    });

    const newStatus = SpiritStatusMonitor.getStatus(input.spiritId);

    logger.info("task_delegated_to_spirit", {
      spiritId: input.spiritId,
      taskId: input.taskId,
      taskType: input.taskType,
      userId: input.userId,
    });

    return {
      success: true,
      message: `Task ${input.taskId} successfully delegated to ${input.spiritId}`,
      spiritStatus: newStatus ?? undefined,
    };
  } catch (error) {
    logger.error("delegate_task_failed", {
      spiritId: input.spiritId,
      taskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `Failed to delegate task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Query the progress of a specific task.
 */
export function queryTaskProgress(taskId: string): {
  found: boolean;
  spiritId?: AgentRole;
  status?: string;
  progress?: number;
  duration?: number;
  taskType?: string;
} {
  try {
    const allStatuses = SpiritStatusMonitor.getAllStatuses();
    const spiritWithTask = allStatuses.find(s => s.currentTaskId === taskId);

    if (!spiritWithTask) {
      logger.debug("task_not_found", { taskId });
      return { found: false };
    }

    const duration = spiritWithTask.startedAt
      ? Date.now() - spiritWithTask.startedAt
      : undefined;

    logger.debug("task_progress_queried", {
      taskId,
      spiritId: spiritWithTask.spiritId,
      progress: spiritWithTask.progress,
    });

    return {
      found: true,
      spiritId: spiritWithTask.spiritId,
      status: spiritWithTask.status,
      progress: spiritWithTask.progress,
      duration,
      taskType: spiritWithTask.currentTaskType,
    };
  } catch (error) {
    logger.error("query_task_progress_failed", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });

    return { found: false };
  }
}

/**
 * Escalate an issue when a spirit encounters an error or gets stuck.
 * Marks the spirit as having an error and provides recommendations.
 */
export async function escalateIssue(input: {
  spiritId: AgentRole;
  taskId: string;
  issue: string;
  severity: "warning" | "error" | "critical";
}): Promise<{
  escalated: boolean;
  recommendations: string[];
  alternativeSpirits?: AgentRole[];
}> {
  try {
    // Report the error to status monitor
    SpiritStatusMonitor.reportError(input.spiritId, input.issue, input.taskId);

    const recommendations: string[] = [];
    const alternativeSpirits: AgentRole[] = [];

    // Generate recommendations based on severity
    if (input.severity === "critical") {
      recommendations.push(`Immediate attention required for ${input.spiritId}`);
      recommendations.push(`Consider manual intervention or task cancellation`);
    } else if (input.severity === "error") {
      recommendations.push(`Task ${input.taskId} failed on ${input.spiritId}`);
      recommendations.push(`Consider retrying with different parameters or switching to alternative spirit`);

      // Suggest alternative spirits based on the failed spirit's role
      if (input.spiritId === "image-specialist") {
        alternativeSpirits.push("inspiration-specialist", "anatomy-specialist");
      } else if (input.spiritId === "video-specialist") {
        alternativeSpirits.push("image-specialist");
      }
    } else {
      recommendations.push(`Warning from ${input.spiritId}: ${input.issue}`);
      recommendations.push(`Monitor task ${input.taskId} for potential issues`);
    }

    logger.warn("issue_escalated", {
      spiritId: input.spiritId,
      taskId: input.taskId,
      severity: input.severity,
      issue: input.issue,
    });

    return {
      escalated: true,
      recommendations,
      alternativeSpirits: alternativeSpirits.length > 0 ? alternativeSpirits : undefined,
    };
  } catch (error) {
    logger.error("escalate_issue_failed", {
      spiritId: input.spiritId,
      taskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      escalated: false,
      recommendations: ["Failed to escalate issue - system error"],
    };
  }
}

/**
 * Get monitoring statistics for dashboards and reporting.
 */
export function getMonitoringStatistics(): {
  statusDistribution: Record<string, number>;
  averageTaskDuration: number;
  totalTasksInProgress: number;
  errorRate: number;
  longRunningCount: number;
} {
  try {
    const stats = SpiritStatusMonitor.getStatistics();
    const summary = SpiritStatusMonitor.getTeamSummary();

    return {
      ...stats,
      longRunningCount: summary.longRunningTasks.length,
    };
  } catch (error) {
    logger.error("get_monitoring_statistics_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusDistribution: {},
      averageTaskDuration: 0,
      totalTasksInProgress: 0,
      errorRate: 0,
      longRunningCount: 0,
    };
  }
}
