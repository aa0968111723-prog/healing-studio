/**
 * shared/spirit-handoff-protocol.ts
 *
 * Standardized Spirit Handoff Protocol
 *
 * Defines the contract for passing work between AI spirits (精靈) in a
 * multi-agent workflow. This protocol ensures:
 * - Smooth transitions between specialists
 * - Context preservation across handoffs
 * - Asset and state continuity
 * - Failure recovery and escalation
 *
 * Used by:
 * - agentCollaborationOrchestrator: Execute handoffs
 * - chief-orchestrator (總總): Monitor and coordinate
 * - Front-end: Display handoff progress
 */

import type { AgentRole } from "./orb-agent-roles";

/**
 * Reason for a spirit handoff
 */
export type HandoffReason =
  | "task_complete"        // Previous spirit finished their part
  | "needs_expertise"      // Requires specialized skills
  | "error_escalation"     // Previous spirit encountered error
  | "user_request"         // User explicitly requested handoff
  | "parallel_work"        // Concurrent work by multiple spirits
  | "quality_review";      // Handoff for quality check/critique

/**
 * Status of a handoff
 */
export type HandoffStatus =
  | "pending"              // Handoff scheduled but not started
  | "in_progress"          // Currently transferring
  | "completed"            // Successfully handed off
  | "failed"               // Handoff failed
  | "cancelled";           // Cancelled by user or system

/**
 * Shared asset between spirits
 */
export interface SharedAsset {
  /** Asset type */
  type: "image" | "video" | "audio" | "voice" | "3d" | "text" | "lora" | "other";
  /** Asset URL or identifier */
  url: string;
  /** Display name */
  name?: string;
  /** Asset metadata (dimensions, duration, format, etc.) */
  metadata?: Record<string, unknown>;
  /** Which spirit created this asset */
  createdBy: AgentRole;
  /** When this asset was created */
  createdAt: number;
  /** Purpose of this asset in the workflow */
  purpose?: string;
}

/**
 * Task context passed during handoff
 */
export interface HandoffTaskContext {
  /** Original user intent */
  originalIntent: string;
  /** Steps completed so far */
  completedSteps: string[];
  /** Steps remaining */
  remainingSteps: string[];
  /** Current step description */
  currentStep?: string;
  /** Assets generated and shared */
  sharedAssets: SharedAsset[];
  /** Parameters used in previous steps */
  usedParameters?: Record<string, unknown>;
  /** Constraints to respect */
  constraints?: {
    budget?: number;
    timeLimit?: number;
    quality?: "draft" | "standard" | "high" | "premium";
    style?: string;
    aspectRatio?: string;
    duration?: number;
  };
  /** Learned preferences from user interaction */
  learnedPreferences?: Record<string, unknown>;
  /** Issues or warnings from previous work */
  issues?: Array<{
    severity: "info" | "warning" | "error";
    message: string;
    fromSpirit: AgentRole;
    timestamp: number;
  }>;
}

/**
 * Instructions for the receiving spirit
 */
export interface HandoffContinuation {
  /** What the receiving spirit should do */
  prompt: string;
  /** Expected output type */
  expectedOutput?: "image" | "video" | "audio" | "text" | "plan" | "analysis";
  /** Specific tools to use */
  suggestedTools?: string[];
  /** Parameters to apply */
  suggestedParameters?: Record<string, unknown>;
  /** Quality requirements */
  qualityRequirements?: string[];
  /** Dependencies on previous assets */
  dependencies?: Array<{
    assetUrl: string;
    purpose: string;
  }>;
}

/**
 * Complete spirit handoff structure
 */
export interface SpiritHandoff {
  /** Unique handoff ID */
  handoffId: string;
  /** Spirit passing the work */
  fromSpirit: AgentRole;
  /** Spirit receiving the work */
  toSpirit: AgentRole;
  /** Reason for handoff */
  handoffReason: HandoffReason;
  /** Current status */
  status: HandoffStatus;
  /** Task context */
  taskContext: HandoffTaskContext;
  /** Instructions for continuation */
  continuation: HandoffContinuation;
  /** User ID */
  userId: number;
  /** Session ID */
  sessionId: string;
  /** Collaboration ID (multiple spirits working together) */
  collaborationId?: string;
  /** When handoff was initiated */
  initiatedAt: number;
  /** When handoff completed (or failed) */
  completedAt?: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Handoff chain for complex workflows
 */
export interface HandoffChain {
  /** Chain ID */
  chainId: string;
  /** Original user intent */
  intent: string;
  /** All spirits involved */
  spirits: AgentRole[];
  /** Individual handoffs in sequence */
  handoffs: SpiritHandoff[];
  /** Overall chain status */
  chainStatus: "planned" | "in_progress" | "completed" | "failed" | "paused";
  /** User ID */
  userId: number;
  /** Started at */
  startedAt: number;
  /** Completed at */
  completedAt?: number;
  /** Total duration */
  totalDuration?: number;
}

/**
 * Handoff history record
 */
export interface HandoffHistoryRecord {
  handoffId: string;
  fromSpirit: AgentRole;
  toSpirit: AgentRole;
  handoffReason: HandoffReason;
  status: HandoffStatus;
  userId: number;
  sessionId: string;
  initiatedAt: number;
  completedAt?: number;
  duration?: number;
  assetsTransferred: number;
  errorMessage?: string;
}

/**
 * Handoff statistics
 */
export interface HandoffStatistics {
  /** Total handoffs */
  totalHandoffs: number;
  /** Successful handoffs */
  successfulHandoffs: number;
  /** Failed handoffs */
  failedHandoffs: number;
  /** Average handoff duration */
  averageDuration: number;
  /** Most common handoff pairs */
  commonPairs: Array<{
    from: AgentRole;
    to: AgentRole;
    count: number;
  }>;
  /** Success rate by spirit pair */
  successRateByPair: Record<string, number>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique handoff ID
 */
export function generateHandoffId(): string {
  return `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Generate a unique chain ID
 */
export function generateChainId(): string {
  return `chain_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a handoff record
 */
export function createHandoff(input: {
  fromSpirit: AgentRole;
  toSpirit: AgentRole;
  handoffReason: HandoffReason;
  taskContext: HandoffTaskContext;
  continuation: HandoffContinuation;
  userId: number;
  sessionId: string;
  collaborationId?: string;
}): SpiritHandoff {
  return {
    handoffId: generateHandoffId(),
    fromSpirit: input.fromSpirit,
    toSpirit: input.toSpirit,
    handoffReason: input.handoffReason,
    status: "pending",
    taskContext: input.taskContext,
    continuation: input.continuation,
    userId: input.userId,
    sessionId: input.sessionId,
    collaborationId: input.collaborationId,
    initiatedAt: Date.now(),
  };
}

/**
 * Create a shared asset record
 */
export function createSharedAsset(input: {
  type: SharedAsset["type"];
  url: string;
  name?: string;
  metadata?: Record<string, unknown>;
  createdBy: AgentRole;
  purpose?: string;
}): SharedAsset {
  return {
    type: input.type,
    url: input.url,
    name: input.name,
    metadata: input.metadata,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    purpose: input.purpose,
  };
}

/**
 * Calculate handoff duration
 */
export function calculateHandoffDuration(handoff: SpiritHandoff): number | null {
  if (!handoff.completedAt) return null;
  return handoff.completedAt - handoff.initiatedAt;
}

/**
 * Check if handoff is complete
 */
export function isHandoffComplete(handoff: SpiritHandoff): boolean {
  return handoff.status === "completed" || handoff.status === "failed" || handoff.status === "cancelled";
}

/**
 * Get handoff display name (for UI)
 */
export function getHandoffDisplayName(fromSpirit: AgentRole, toSpirit: AgentRole): string {
  const spiritNames: Record<AgentRole, string> = {
    // Core roles
    "director": "導導",
    "composer": "編編",
    "critic": "品品",
    "researcher": "查查",
    "navigator": "路路",
    "companion": "暖暖",
    // Specialized
    "image-specialist": "圖圖",
    "video-specialist": "影影",
    "music-specialist": "音音",
    "voice-specialist": "聲聲",
    "training-specialist": "練練",
    "learning-specialist": "學學",
    // Functional
    "legal-advisor": "律律",
    "security-guard": "安安",
    "community-manager": "群群",
    "chief-orchestrator": "總總",
    "onboarding-coach": "帶帶",
    "notes-curator": "記記",
    "settings-detail": "細細",
    "plan-executor": "步步",
    // New
    "inspiration-specialist": "靈靈",
    "anatomy-specialist": "體體",
    // Proactive
    "accountant": "財財",
    "quality-coach": "巧巧",
    "inspector": "守守",
  };

  const fromName = spiritNames[fromSpirit] || fromSpirit;
  const toName = spiritNames[toSpirit] || toSpirit;

  return `${fromName} → ${toName}`;
}

/**
 * Validate handoff can proceed
 */
export function validateHandoff(handoff: SpiritHandoff): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!handoff.fromSpirit) {
    errors.push("Missing fromSpirit");
  }

  if (!handoff.toSpirit) {
    errors.push("Missing toSpirit");
  }

  if (handoff.fromSpirit === handoff.toSpirit) {
    errors.push("Cannot handoff to same spirit");
  }

  if (!handoff.taskContext?.originalIntent) {
    errors.push("Missing original intent in task context");
  }

  if (!handoff.continuation?.prompt) {
    errors.push("Missing continuation prompt");
  }

  if (!handoff.userId) {
    errors.push("Missing userId");
  }

  if (!handoff.sessionId) {
    errors.push("Missing sessionId");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
