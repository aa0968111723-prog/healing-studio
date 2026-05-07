/**
 * multiAgentIntegration.ts — Integration layer between single-agent
 * orbTaskChainRunner and multi-agent AgentCollaborationOrchestrator.
 *
 * Provides a unified entry point that routes tasks to the appropriate
 * execution path based on complexity detection.
 */

import type { AgentRole } from "../../shared/orb-agent-roles";
import type { OrbApiTool } from "./agentToolExecutor";
import type { AgentPreferences } from "../../shared/agent-preferences";
import type { RunOrbTaskChainInput, OrbTaskChainResult } from "./orbTaskChainRunner";
import { runOrbTaskWithContinuationLoop } from "./orbTaskChainRunner";
import { detectMultiAgentNeed, isObviouslySingleAgentTask } from "./multiAgentDetector";
import { AgentCollaborationOrchestrator } from "./agentCollaborationOrchestrator";
import { getOrbAgentTask } from "./orbTaskStateMachine";
import { logger } from "../_core/logger";
import type { AgentCollaborationRequest } from "../../shared/agent-communication-protocol";

export interface MultiAgentIntegrationInput {
  /** Initial task ID from planner */
  initialTaskId: string;
  /** User ID */
  userId: number;
  /** User role */
  userRole: string;
  /** Available tools */
  tools: OrbApiTool[];
  /** Agent preferences */
  agentPreferences?: AgentPreferences;
  /** Max continuation loop iterations */
  maxIterations?: number;
  /** User's original message/intent */
  userMessage: string;
  /** Current page snapshot */
  pageSnapshot?: any;
  /** Primary agent role detected by planner */
  primaryRole?: AgentRole;
  /** Session ID for collaboration tracking */
  sessionId?: string;
  /** Callback for tool audit events */
  onToolAuditEvent?: RunOrbTaskChainInput["onToolAuditEvent"];
}

export interface MultiAgentIntegrationResult {
  /** Execution mode used */
  mode: "single-agent" | "multi-agent-collaboration";
  /** Result from single-agent execution */
  chainResult?: OrbTaskChainResult;
  /** Collaboration session from multi-agent execution */
  collaborationSession?: Awaited<ReturnType<typeof AgentCollaborationOrchestrator.startCollaboration>>;
  /** Detection result that determined the mode */
  detectionResult: {
    shouldCollaborate: boolean;
    confidence: number;
    reason: string;
  };
}

/**
 * Unified entry point for orb task execution with automatic routing
 * between single-agent and multi-agent paths.
 */
export async function runOrbTaskWithAutoRouting(
  input: MultiAgentIntegrationInput
): Promise<MultiAgentIntegrationResult> {
  // ─── Phase 1: Detect if multi-agent collaboration is needed ────────

  // Fast path: skip detection for obviously simple tasks
  if (isObviouslySingleAgentTask(input.userMessage)) {
    logger.info("service event", {
      event: "multi_agent_detection_skipped",
      taskId: input.initialTaskId,
      reason: "obviously_simple_task",
    });

    const chainResult = await runOrbTaskWithContinuationLoop({
      initialTaskId: input.initialTaskId,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      agentPreferences: input.agentPreferences,
      maxIterations: input.maxIterations,
      onToolAuditEvent: input.onToolAuditEvent,
    });

    return {
      mode: "single-agent",
      chainResult,
      detectionResult: {
        shouldCollaborate: false,
        confidence: 1.0,
        reason: "明顯的簡單任務，跳過協作檢測",
      },
    };
  }

  // Full detection
  const detection = detectMultiAgentNeed({
    userMessage: input.userMessage,
    pageSnapshot: input.pageSnapshot,
    primaryRole: input.primaryRole,
  });

  logger.info("service event", {
    event: "multi_agent_detection_result",
    taskId: input.initialTaskId,
    shouldCollaborate: detection.shouldCollaborate,
    confidence: detection.confidence,
    reason: detection.reason,
    suggestedAgents: detection.suggestedAgents,
  });

  // ─── Phase 2: Route to appropriate execution path ──────────────────

  if (!detection.shouldCollaborate) {
    // Single-agent path (existing behavior)
    const chainResult = await runOrbTaskWithContinuationLoop({
      initialTaskId: input.initialTaskId,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      agentPreferences: input.agentPreferences,
      maxIterations: input.maxIterations,
      onToolAuditEvent: input.onToolAuditEvent,
    });

    return {
      mode: "single-agent",
      chainResult,
      detectionResult: {
        shouldCollaborate: detection.shouldCollaborate,
        confidence: detection.confidence,
        reason: detection.reason,
      },
    };
  }

  // ─── Phase 3: Multi-agent collaboration path (NEW) ─────────────────

  try {
    // Get the agent task to extract context
    const agentTask = getOrbAgentTask(input.initialTaskId);

    // Build shared context from agent task
    const sharedContext: any = {
      userMessage: input.userMessage,
      sessionId: input.sessionId || `session_${Date.now()}`,
      pageSnapshot: input.pageSnapshot,
      agentPreferences: input.agentPreferences,
      // Include any initial outputs or context from the task
      initialTask: agentTask ? {
        taskId: agentTask.taskId,
        intent: agentTask.intent,
        status: agentTask.status,
      } : undefined,
    };

    // Start collaboration session
    const collaborationRequest: AgentCollaborationRequest = {
      requestingAgent: input.primaryRole || "director",
      targetAgents: detection.suggestedAgents || "auto",
      task: input.userMessage,
      taskType: "plan",
      requiredCapabilities: detection.suggestedAgents,
      context: {
        userId: input.userId,
        sessionId: input.sessionId || sharedContext.sessionId,
        ...sharedContext,
      },
    };

    logger.info("service event", {
      event: "starting_multi_agent_collaboration",
      taskId: input.initialTaskId,
      collaborationRequest: {
        requestingAgent: collaborationRequest.requestingAgent,
        requiredCapabilities: collaborationRequest.requiredCapabilities,
      },
    });

    const collaborationSession = await AgentCollaborationOrchestrator.startCollaboration(
      collaborationRequest
    );

    logger.info("service event", {
      event: "multi_agent_collaboration_started",
      taskId: input.initialTaskId,
      collaborationId: collaborationSession.collaborationId,
      participatingAgents: collaborationSession.participatingAgents,
    });

    return {
      mode: "multi-agent-collaboration",
      collaborationSession,
      detectionResult: {
        shouldCollaborate: detection.shouldCollaborate,
        confidence: detection.confidence,
        reason: detection.reason,
      },
    };
  } catch (error) {
    // Fallback to single-agent on collaboration failure
    logger.error("service event", {
      event: "multi_agent_collaboration_failed",
      taskId: input.initialTaskId,
      error: error instanceof Error ? error.message : String(error),
      fallbackToSingleAgent: true,
    });

    const chainResult = await runOrbTaskWithContinuationLoop({
      initialTaskId: input.initialTaskId,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      agentPreferences: input.agentPreferences,
      maxIterations: input.maxIterations,
      onToolAuditEvent: input.onToolAuditEvent,
    });

    return {
      mode: "single-agent",
      chainResult,
      detectionResult: {
        shouldCollaborate: detection.shouldCollaborate,
        confidence: detection.confidence,
        reason: `${detection.reason}（協作失敗，退回單一 agent）`,
      },
    };
  }
}

/**
 * Environment flag to enable/disable multi-agent routing.
 * Default: disabled (false) for safety during initial rollout.
 * Set ORB_MULTI_AGENT_ENABLED=1 to enable.
 */
export function isMultiAgentRoutingEnabled(): boolean {
  return process.env.ORB_MULTI_AGENT_ENABLED === "1" || process.env.ORB_MULTI_AGENT_ENABLED === "true";
}

/**
 * Wrapper that respects the feature flag for gradual rollout.
 */
export async function runOrbTaskWithOptionalMultiAgent(
  input: MultiAgentIntegrationInput
): Promise<MultiAgentIntegrationResult> {
  if (!isMultiAgentRoutingEnabled()) {
    // Feature disabled: always use single-agent path
    const chainResult = await runOrbTaskWithContinuationLoop({
      initialTaskId: input.initialTaskId,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      agentPreferences: input.agentPreferences,
      maxIterations: input.maxIterations,
      onToolAuditEvent: input.onToolAuditEvent,
    });

    return {
      mode: "single-agent",
      chainResult,
      detectionResult: {
        shouldCollaborate: false,
        confidence: 1.0,
        reason: "多 agent 路由功能已停用（feature flag）",
      },
    };
  }

  // Feature enabled: use auto-routing with detection
  return runOrbTaskWithAutoRouting(input);
}
