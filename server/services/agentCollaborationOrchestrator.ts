/**
 * server/services/agentCollaborationOrchestrator.ts
 *
 * Orchestrates collaboration between multiple AI agents to complete complex tasks.
 * Manages agent handoffs, shared context, and multi-agent workflows.
 */

import type {
  AgentRole
} from "../../shared/orb-agent-roles";
import type {
  AgentMessage,
  AgentSharedContext,
  AgentCollaborationRequest,
  AgentCollaborationResult,
  AgentHandoff,
  AgentCapabilityDeclaration,
} from "../../shared/agent-communication-protocol";
import {
  createAgentMessage,
  createHandoffMessage,
  generateCollaborationId,
  agentHasCapability,
} from "../../shared/agent-communication-protocol";
import {
  getSpecializedAgentCapability,
  findAgentForTool,
} from "../../shared/orb-specialized-agents";
import { AgentCommunicationBus } from "./agentCommunicationBus";
import { logger } from "../_core/logger";

/** Active collaboration session */
interface CollaborationSession {
  collaborationId: string;
  userId?: number;
  sessionId: string;
  taskDescription: string;
  startedAt: number;
  currentAgent: AgentRole;
  participatingAgents: AgentRole[];
  sharedContext: AgentSharedContext;
  status: "active" | "completed" | "failed" | "cancelled";
  completedSteps: string[];
  result?: AgentCollaborationResult;
}

class AgentCollaborationOrchestratorClass {
  private activeSessions: Map<string, CollaborationSession> = new Map();
  private agentCapabilities: Map<AgentRole, AgentCapabilityDeclaration> = new Map();

  constructor() {
    // Initialize with default capabilities for all agents
    this.initializeAgentCapabilities();
  }

  /**
   * Initialize agent capabilities registry
   */
  private initializeAgentCapabilities(): void {
    // Role-based agents
    this.registerAgentCapability({
      agentId: "director",
      capabilities: ["multi-step planning", "workflow design", "task decomposition"],
      availableTools: ["director.suggestPlan"],
      knowledgeDomains: ["project planning", "creative workflow", "narrative structure"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "composer",
      capabilities: ["task execution", "parameter filling", "form submission"],
      availableTools: ["studio.*"],
      knowledgeDomains: ["studio operations", "parameter tuning"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "critic",
      capabilities: ["review", "improvement suggestions", "quality assessment"],
      availableTools: [],
      knowledgeDomains: ["content critique", "quality standards"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "researcher",
      capabilities: ["information gathering", "comparison", "search"],
      availableTools: ["research.deepSearch", "inspiration.fetch"],
      knowledgeDomains: ["web research", "model comparison", "trend analysis"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "navigator",
      capabilities: ["page navigation", "UI guidance"],
      availableTools: [],
      knowledgeDomains: ["site navigation", "feature location"],
      available: true,
    });

    this.registerAgentCapability({
      agentId: "companion",
      capabilities: ["conversation", "emotional support", "intent clarification"],
      availableTools: [],
      knowledgeDomains: ["open conversation", "user intent"],
      available: true,
    });

    // Specialized agents - dynamically load from registry
    const specializedAgents: AgentRole[] = [
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
      "learning-specialist",
    ];

    specializedAgents.forEach(agentId => {
      const capability = getSpecializedAgentCapability(agentId);
      if (capability) {
        this.registerAgentCapability({
          agentId: agentId as AgentRole,
          capabilities: capability.useCases,
          availableTools: capability.primaryTools,
          knowledgeDomains: capability.knowledgeDomains,
          available: true,
          specializations: this.mapToSpecializations(agentId),
        });
      }
    });
  }

  /**
   * Map agent ID to specializations
   */
  private mapToSpecializations(agentId: string): AgentCapabilityDeclaration["specializations"] {
    const mapping: Record<string, AgentCapabilityDeclaration["specializations"][0]> = {
      "image-specialist": "image",
      "video-specialist": "video",
      "music-specialist": "audio",
      "voice-specialist": "voice",
      "training-specialist": "training",
      "learning-specialist": "learning",
    };
    const spec = mapping[agentId];
    return spec ? [spec] : undefined;
  }

  /**
   * Register an agent's capabilities
   */
  registerAgentCapability(capability: AgentCapabilityDeclaration): void {
    this.agentCapabilities.set(capability.agentId, capability);
    logger.debug({
      event: "agent_capability_registered",
      agentId: capability.agentId,
      capabilities: capability.capabilities,
    });
  }

  /**
   * Start a collaboration session
   */
  startCollaboration(
    request: AgentCollaborationRequest
  ): CollaborationSession {
    const collaborationId = request.context.collaborationId || generateCollaborationId();
    const session: CollaborationSession = {
      collaborationId,
      userId: request.context.userId,
      sessionId: request.context.sessionId,
      taskDescription: request.task,
      startedAt: Date.now(),
      currentAgent: request.requestingAgent,
      participatingAgents: [request.requestingAgent],
      sharedContext: {
        ...request.context,
        collaborationId,
      },
      status: "active",
      completedSteps: [],
    };

    this.activeSessions.set(collaborationId, session);

    logger.info({
      event: "collaboration_started",
      collaborationId,
      taskDescription: request.task,
      requestingAgent: request.requestingAgent,
    });

    return session;
  }

  /**
   * Find the best agent for a specific task
   */
  findBestAgent(requirements: {
    tools?: string[];
    domains?: string[];
    specialization?: AgentCapabilityDeclaration["specializations"][0];
    excludeAgents?: AgentRole[];
  }): AgentRole | null {
    const candidates: Array<{ agent: AgentRole; score: number }> = [];

    this.agentCapabilities.forEach((capability, agentId) => {
      // Skip excluded agents
      if (requirements.excludeAgents?.includes(agentId)) {
        return;
      }

      // Skip unavailable agents
      if (!capability.available) {
        return;
      }

      let score = 0;

      // Check tools match
      if (requirements.tools && requirements.tools.length > 0) {
        const matchingTools = requirements.tools.filter(tool =>
          capability.availableTools.some(availTool =>
            availTool === tool || availTool.includes("*")
          )
        );
        score += matchingTools.length * 10;
      }

      // Check domain match
      if (requirements.domains && requirements.domains.length > 0) {
        const matchingDomains = requirements.domains.filter(domain =>
          capability.knowledgeDomains.some(kd =>
            kd.toLowerCase().includes(domain.toLowerCase())
          )
        );
        score += matchingDomains.length * 5;
      }

      // Check specialization match
      if (requirements.specialization && capability.specializations) {
        if (capability.specializations.includes(requirements.specialization)) {
          score += 20;
        }
      }

      // Consider agent load (lower is better)
      if (capability.load !== undefined) {
        score -= capability.load / 10;
      }

      if (score > 0) {
        candidates.push({ agent: agentId, score });
      }
    });

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0].agent : null;
  }

  /**
   * Execute agent handoff
   */
  async executeHandoff(handoff: AgentHandoff): Promise<void> {
    const session = Array.from(this.activeSessions.values()).find(
      s => s.sharedContext.collaborationId === handoff.context.collaborationId
    );

    if (!session) {
      logger.warn({
        event: "handoff_no_session",
        collaborationId: handoff.context.collaborationId,
      });
      return;
    }

    // Update session
    session.currentAgent = handoff.toAgent;
    if (!session.participatingAgents.includes(handoff.toAgent)) {
      session.participatingAgents.push(handoff.toAgent);
    }
    session.sharedContext = handoff.context;

    if (handoff.completedSteps) {
      session.completedSteps.push(...handoff.completedSteps);
    }

    // Send handoff message via bus
    const message = createHandoffMessage(handoff, session.collaborationId);
    await AgentCommunicationBus.publish(message);

    logger.info({
      event: "agent_handoff",
      collaborationId: session.collaborationId,
      fromAgent: handoff.fromAgent,
      toAgent: handoff.toAgent,
      reason: handoff.reason,
    });
  }

  /**
   * Complete a collaboration session
   */
  completeCollaboration(
    collaborationId: string,
    result: AgentCollaborationResult
  ): void {
    const session = this.activeSessions.get(collaborationId);
    if (!session) {
      logger.warn({
        event: "complete_collaboration_no_session",
        collaborationId,
      });
      return;
    }

    session.status = result.success ? "completed" : "failed";
    session.result = result;

    logger.info({
      event: "collaboration_completed",
      collaborationId,
      success: result.success,
      duration: Date.now() - session.startedAt,
      participatingAgents: session.participatingAgents,
      completedBy: result.completedBy,
    });

    // Keep session for a while for history, then clean up
    setTimeout(() => {
      this.activeSessions.delete(collaborationId);
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Get active collaboration session
   */
  getSession(collaborationId: string): CollaborationSession | undefined {
    return this.activeSessions.get(collaborationId);
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: number): CollaborationSession[] {
    return Array.from(this.activeSessions.values()).filter(
      s => s.userId === userId && s.status === "active"
    );
  }

  /**
   * Cancel a collaboration session
   */
  cancelCollaboration(collaborationId: string, reason: string): void {
    const session = this.activeSessions.get(collaborationId);
    if (session) {
      session.status = "cancelled";
      logger.info({
        event: "collaboration_cancelled",
        collaborationId,
        reason,
      });
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    activeSessions: number;
    totalAgents: number;
    availableAgents: number;
    sessionsByAgent: Record<string, number>;
  } {
    const sessionsByAgent: Record<string, number> = {};

    this.activeSessions.forEach(session => {
      session.participatingAgents.forEach(agent => {
        sessionsByAgent[agent] = (sessionsByAgent[agent] || 0) + 1;
      });
    });

    return {
      activeSessions: this.activeSessions.size,
      totalAgents: this.agentCapabilities.size,
      availableAgents: Array.from(this.agentCapabilities.values()).filter(
        c => c.available
      ).length,
      sessionsByAgent,
    };
  }
}

// Singleton instance
export const AgentCollaborationOrchestrator = new AgentCollaborationOrchestratorClass();

// Export for testing
export { AgentCollaborationOrchestratorClass };
