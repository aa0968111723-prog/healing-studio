/**
 * shared/agent-communication-protocol.ts
 *
 * Agent-to-Agent Communication Protocol
 *
 * Enables all 12 AI agents (6 role agents + 6 specialized agents) to
 * communicate, share context, and collaborate on complex multi-modal tasks.
 *
 * Core agents:
 * - director, composer, critic, researcher, navigator, companion
 *
 * Specialized agents:
 * - image-specialist, video-specialist, music-specialist, voice-specialist,
 *   training-specialist, learning-specialist
 */

import type { AgentRole } from "./orb-agent-roles";

/** Message types for inter-agent communication */
export type AgentMessageType =
  | "request"       // Request another agent to perform a task
  | "response"      // Response to a request
  | "notification"  // Inform other agents of an event
  | "handoff"       // Transfer control to another agent
  | "broadcast"     // Send to all agents
  | "query"         // Ask for information/capability
  | "share_context"; // Share execution context

/** Priority levels for agent messages */
export type MessagePriority = "low" | "normal" | "high" | "urgent";

/** Shared context that agents pass between each other */
export interface AgentSharedContext {
  /** User ID for scoping */
  userId?: number;
  /** Current session ID */
  sessionId: string;
  /** Task or workflow ID */
  taskId?: string;
  /** Collaboration session ID (multiple agents working together) */
  collaborationId?: string;
  /** Current step in multi-step workflow */
  currentStep?: number;
  /** Total steps in workflow */
  totalSteps?: number;
  /** User's original intent/request */
  originalIntent?: string;
  /** Generated assets (URLs or IDs) */
  generatedAssets?: Array<{
    type: "image" | "video" | "audio" | "voice" | "3d" | "lora";
    url: string;
    metadata?: Record<string, unknown>;
  }>;
  /** Parameters used in previous steps */
  previousParameters?: Record<string, unknown>;
  /** Constraints and requirements */
  constraints?: {
    budget?: number;
    timeLimit?: number;
    quality?: "draft" | "standard" | "high" | "premium";
    style?: string;
    aspectRatio?: string;
    duration?: number;
  };
  /** User preferences learned so far */
  learnedPreferences?: Record<string, unknown>;
  /** Errors or warnings from previous agents */
  issues?: Array<{
    severity: "warning" | "error";
    message: string;
    fromAgent: AgentRole;
  }>;
}

/** Agent message structure */
export interface AgentMessage {
  /** Unique message ID */
  messageId: string;
  /** Sender agent */
  fromAgent: AgentRole;
  /** Recipient agent(s) - "broadcast" for all agents */
  toAgent: AgentRole | "broadcast" | AgentRole[];
  /** Message type */
  messageType: AgentMessageType;
  /** Message priority */
  priority: MessagePriority;
  /** Message content */
  content: {
    /** Action requested or performed */
    action?: string;
    /** Data payload */
    data?: Record<string, unknown>;
    /** Shared context */
    context?: AgentSharedContext;
    /** Reason for the message */
    reason?: string;
    /** Expected response format */
    responseFormat?: string;
  };
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Expiry time (auto-cleanup old messages) */
  expiresAt?: number;
  /** Reference to parent message (for threading) */
  inReplyTo?: string;
  /** Correlation ID for tracking message chains */
  correlationId?: string;
}

/** Agent capability declaration for discovery */
export interface AgentCapabilityDeclaration {
  agentId: AgentRole;
  /** What this agent can do */
  capabilities: string[];
  /** Tools this agent has access to */
  availableTools: string[];
  /** Knowledge domains */
  knowledgeDomains: string[];
  /** Whether agent is currently available */
  available: boolean;
  /** Current load (0-100) */
  load?: number;
  /** Specialized for specific modalities */
  specializations?: Array<"image" | "video" | "audio" | "voice" | "3d" | "training" | "learning">;
}

/** Agent collaboration request */
export interface AgentCollaborationRequest {
  /** Requesting agent */
  requestingAgent: AgentRole;
  /** Target agent(s) */
  targetAgents: AgentRole | AgentRole[] | "auto";
  /** Task description */
  task: string;
  /** Task type */
  taskType: "generate" | "edit" | "analyze" | "plan" | "learn" | "teach";
  /** Required capabilities */
  requiredCapabilities?: string[];
  /** Shared context */
  context: AgentSharedContext;
  /** Deadline (milliseconds from now) */
  deadline?: number;
  /** Callback when complete */
  onComplete?: (result: AgentCollaborationResult) => void;
}

/** Result from agent collaboration */
export interface AgentCollaborationResult {
  /** Success status */
  success: boolean;
  /** Agent that completed the task */
  completedBy: AgentRole;
  /** Result data */
  result?: Record<string, unknown>;
  /** Updated context */
  context?: AgentSharedContext;
  /** Errors if any */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Next recommended agent (if task should continue) */
  nextAgent?: AgentRole;
}

/** Agent handoff - transfer control from one agent to another */
export interface AgentHandoff {
  /** Agent handing off */
  fromAgent: AgentRole;
  /** Agent receiving control */
  toAgent: AgentRole;
  /** Reason for handoff */
  reason: string;
  /** Context to transfer */
  context: AgentSharedContext;
  /** What the next agent should do */
  nextAction?: string;
  /** Completed steps */
  completedSteps?: string[];
  /** Remaining steps */
  remainingSteps?: string[];
}

/** Agent query - ask for capabilities or information */
export interface AgentQuery {
  /** Querying agent */
  fromAgent: AgentRole;
  /** Query type */
  queryType: "capabilities" | "status" | "recommendation" | "knowledge";
  /** Query parameters */
  params?: {
    /** For capability queries */
    requiredTools?: string[];
    requiredDomains?: string[];
    /** For recommendation queries */
    taskDescription?: string;
    /** For knowledge queries */
    topic?: string;
  };
}

/** Agent query response */
export interface AgentQueryResponse {
  /** Responding agent */
  fromAgent: AgentRole;
  /** Query being responded to */
  inResponseTo: AgentQuery;
  /** Response data */
  data: {
    /** For capability queries */
    capabilities?: AgentCapabilityDeclaration;
    /** For status queries */
    status?: "available" | "busy" | "offline";
    load?: number;
    /** For recommendation queries */
    canHandle?: boolean;
    confidence?: number;
    /** For knowledge queries */
    knowledge?: string;
    references?: string[];
  };
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Generate a unique collaboration ID
 */
export function generateCollaborationId(): string {
  return `collab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create an agent message
 */
export function createAgentMessage(
  fromAgent: AgentRole,
  toAgent: AgentRole | "broadcast" | AgentRole[],
  messageType: AgentMessageType,
  content: AgentMessage["content"],
  options?: {
    priority?: MessagePriority;
    correlationId?: string;
    inReplyTo?: string;
    expiresInMs?: number;
  }
): AgentMessage {
  const now = Date.now();
  return {
    messageId: generateMessageId(),
    fromAgent,
    toAgent,
    messageType,
    priority: options?.priority ?? "normal",
    content,
    timestamp: now,
    expiresAt: options?.expiresInMs ? now + options.expiresInMs : undefined,
    inReplyTo: options?.inReplyTo,
    correlationId: options?.correlationId ?? generateMessageId(),
  };
}

/**
 * Create a handoff message
 */
export function createHandoffMessage(
  handoff: AgentHandoff,
  correlationId?: string
): AgentMessage {
  return createAgentMessage(
    handoff.fromAgent,
    handoff.toAgent,
    "handoff",
    {
      action: "transfer_control",
      reason: handoff.reason,
      context: handoff.context,
      data: {
        nextAction: handoff.nextAction,
        completedSteps: handoff.completedSteps,
        remainingSteps: handoff.remainingSteps,
      },
    },
    {
      priority: "high",
      correlationId,
    }
  );
}

/**
 * Create a collaboration request message
 */
export function createCollaborationRequestMessage(
  request: AgentCollaborationRequest,
  correlationId?: string
): AgentMessage {
  return createAgentMessage(
    request.requestingAgent,
    request.targetAgents === "auto" ? "broadcast" : request.targetAgents,
    "request",
    {
      action: request.taskType,
      data: {
        task: request.task,
        requiredCapabilities: request.requiredCapabilities,
        deadline: request.deadline,
      },
      context: request.context,
    },
    {
      priority: request.deadline ? "high" : "normal",
      correlationId,
    }
  );
}

/**
 * Check if agent can handle a specific capability
 */
export function agentHasCapability(
  capability: AgentCapabilityDeclaration,
  required: {
    tools?: string[];
    domains?: string[];
  }
): boolean {
  if (required.tools && required.tools.length > 0) {
    const hasAllTools = required.tools.every(tool =>
      capability.availableTools.includes(tool)
    );
    if (!hasAllTools) return false;
  }

  if (required.domains && required.domains.length > 0) {
    const hasAnyDomain = required.domains.some(domain =>
      capability.knowledgeDomains.some(kd =>
        kd.toLowerCase().includes(domain.toLowerCase())
      )
    );
    if (!hasAnyDomain) return false;
  }

  return capability.available;
}

/**
 * Serialize agent message for logging/debugging
 */
export function serializeAgentMessage(message: AgentMessage): string {
  return `[${message.fromAgent} → ${Array.isArray(message.toAgent) ? message.toAgent.join(",") : message.toAgent}] ${message.messageType}: ${message.content.action || "no-action"}`;
}
