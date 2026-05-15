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

/** Shared context that agents pass between each other.
 *
 * Carries an open `[key: string]` index signature so callers can attach
 * task-specific extras without extending this interface every time.
 * agentCollaborationOrchestrator stores it via `as unknown as Record<...>`
 * for DB persistence — the index signature lets that cast happen
 * directly without `as unknown as` workarounds.
 */
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
  /** Open extension slot — keeps the type assignable to
   *  `Record<string, unknown>` for downstream JSON storage / structured
   *  cloning, and lets callers attach extras without extending this
   *  interface every release. */
  [key: string]: unknown;
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
  specializations?: Array<
    | "image"
    | "video"
    | "audio"
    | "voice"
    | "3d"
    | "training"
    | "learning"
    // 8 位新增精靈專屬 specialization
    | "legal"
    | "security"
    | "community"
    | "orchestration"
    | "onboarding"
    | "notes"
    | "settings"
    | "execution"
    // 靈靈 / 體體
    | "inspiration"
    | "anatomy"
  >;
}

/** Agent collaboration request.
 *
 * 兩種等價的呼叫風格，type 都接受：
 *   - 內部 protocol shape：requestingAgent + task + targetAgents + context
 *   - chat router shape：initiatingAgent + taskDescription + sharedContext
 *     + 平鋪的 userId/sessionId
 *
 * orchestrator 讀的是 task / context 那一組，但兩組欄位都標 optional，
 * 讓兩條 caller 都不會被型別擋住。新呼叫端應該優先用內部 protocol shape，
 * 平鋪欄位是 transitional 用。
 */
export interface AgentCollaborationRequest {
  /** Requesting agent (alias of requestingAgent kept for back-compat
   *  with multiAgentIntegration.ts which uses the older name). */
  initiatingAgent?: AgentRole;
  /** Requesting agent */
  requestingAgent?: AgentRole;
  /** Target agent(s) */
  targetAgents?: AgentRole | AgentRole[] | "auto";
  /** Owning user. Optional only because the chat router fills it in
   *  before persisting; planners and orchestrators that take the
   *  request by value must supply it for per-user scoping. */
  userId?: number;
  /** Caller-supplied session id (used for grouping related requests
   *  across the orb chat router and the multi-agent orchestrator). */
  sessionId?: string;
  /** Task description */
  task?: string;
  /** Alias of `task` used by chat-router-style callers. */
  taskDescription?: string;
  /** Task type */
  taskType?: "generate" | "edit" | "analyze" | "plan" | "learn" | "teach";
  /** Required capabilities */
  requiredCapabilities?: string[];
  /** Shared context */
  context?: AgentSharedContext;
  /** Alias of `context` used by chat-router-style callers (which build
   *  a flat record rather than the structured AgentSharedContext). */
  sharedContext?: AgentSharedContext | Record<string, unknown>;
  /** Deadline (milliseconds from now) */
  deadline?: number;
  /** Callback when complete */
  onComplete?: (result: AgentCollaborationResult) => void;
}

/** Result from agent collaboration */
export interface AgentCollaborationResult {
  /** Success status */
  success: boolean;
  /** When the result was finalised (ms epoch). Routers populate this
   *  on cancellation paths so the client can show the elapsed time. */
  completedAt?: number;
  /** Agent that completed the task */
  completedBy?: AgentRole;
  /** Result data */
  result?: Record<string, unknown>;
  /** Final output payload — alias of `result` kept for the chat
   *  router's response shape (it forwards `output` to the client). */
  output?: Record<string, unknown>;
  /** Roster of agents that took part in this collaboration. Mirrors
   *  the orchestrator's `session.participatingAgents`; nullable for
   *  results created from a single-agent fallback path. */
  participants?: AgentRole[];
  /** Updated context */
  context?: AgentSharedContext;
  /** Errors if any */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Next recommended agent (if task should continue) */
  nextAgent?: AgentRole;
}

/** Snapshot of an active collaboration session — exposed via
 *  `agentCollaborationOrchestrator.getSessionStatus()` so routers can
 *  poll progress without loading the orchestrator's internal state. */
export interface CollaborationSession {
  collaborationId: string;
  userId?: number;
  sessionId: string;
  taskDescription: string;
  startedAt: number;
  /** Filled in when status transitions to "completed"/"failed"/"cancelled".
   *  Routers use this to compute total duration without holding their
   *  own start-time copy. */
  completedAt?: number;
  currentAgent: AgentRole;
  participatingAgents: AgentRole[];
  sharedContext: AgentSharedContext;
  status: "active" | "completed" | "failed" | "cancelled";
  completedSteps: string[];
  result?: AgentCollaborationResult;
  /**
   * 最近 N 個成功的 handoff 目標，最新的塞末端。pickBestHandoff 用此做
   * cycle 防呆 — A→B→A→B 反覆觸發時越靠後的扣越多分，迫使選擇其它
   * handoff。orchestrator.executeProtocolHandoff 會在每次 handoff 完成
   * 後 push、保留最後 6 個 entry。
   */
  recentHandoffTargets?: AgentRole[];
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
  // Both protocol-style and chat-router-style fields are accepted on
  // AgentCollaborationRequest; coalesce here so the message constructor
  // always sees concrete values.
  const requestingAgent: AgentRole = request.requestingAgent ?? request.initiatingAgent ?? "director";
  const target = request.targetAgents ?? "broadcast";
  return createAgentMessage(
    requestingAgent,
    target === "auto" ? "broadcast" : target,
    "request",
    {
      action: request.taskType,
      data: {
        task: request.task ?? request.taskDescription,
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
