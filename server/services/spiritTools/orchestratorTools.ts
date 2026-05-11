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
 */
export function processClarificationResponse(
  response: string
): Record<string, string> {
  const parsed: Record<string, string> = {};

  // Extract dimension choices from response
  // Format: "[總總澄清/goal]: 一支短影片（15-60 秒）"
  const matches = response.matchAll(/\[總總澄清\/([\w]+)\]:\s*(.+?)(?=\[|$)/g);

  for (const match of matches) {
    const dimension = match[1];
    const choice = match[2].trim();
    parsed[dimension] = choice;
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
