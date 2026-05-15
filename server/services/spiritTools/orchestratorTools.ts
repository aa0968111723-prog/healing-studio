/**
 * server/services/spiritTools/orchestratorTools.ts
 *
 * Tools specifically for chief-orchestrator (總總).
 * Enables intent analysis, clarification, and team coordination.
 */

import {
  SPIRIT_COLLAB_PROTOCOL,
  type AgentRole,
} from "../../../shared/orb-agent-roles";
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
      atRiskTasks: [],
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

// ============================================================================
// AUTONOMY TOOLS — chief-orchestrator (總總) as a real AI agent
//
// The tools above let 總總 *observe* the team. The five below let him *act*:
// decompose goals into a DAG, pick the best spirit for new work, surface
// bottlenecks proactively, retry failures on alternates, and enforce
// deadlines. Each tool is deterministic and side-effect-light so 總總's
// LLM layer can call them freely without surprise costs.
// ============================================================================

/** Domain inferred from a goal string — used to map a step to a specialist. */
type GoalDomain =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "script"
  | "training"
  | "research"
  | "inspiration"
  | "anatomy"
  | "social"
  | "legal"
  | "settings"
  | "notes"
  | "general";

const DOMAIN_PATTERNS: ReadonlyArray<{ domain: GoalDomain; pattern: RegExp }> = [
  { domain: "video", pattern: /影片|短片|reel|vlog|mv|微電影|宣傳片|廣告片|video|animation/i },
  { domain: "image", pattern: /圖片|圖像|海報|封面|插畫|主視覺|banner|image|poster|illustration/i },
  { domain: "music", pattern: /音樂|配樂|bgm|歌曲|主題曲|music|soundtrack/i },
  { domain: "voice", pattern: /配音|旁白|tts|voice|narration|口白|對嘴|lip\s*sync/i },
  { domain: "script", pattern: /腳本|劇本|文案|分鏡|story\s*board|script|copy/i },
  { domain: "training", pattern: /lora|微調|訓練|fine.?tune|train\s*model/i },
  { domain: "research", pattern: /研究|比較|找資料|趨勢|research|trend|compare/i },
  { domain: "inspiration", pattern: /靈感|風格|參考|moodboard|inspiration|style\s*ref/i },
  { domain: "anatomy", pattern: /解剖|人體|肌肉|骨骼|anatomy|musculoskeletal/i },
  { domain: "social", pattern: /社群|貼文|ig|tiktok|youtube|小紅書|facebook|hashtag|post/i },
  { domain: "legal", pattern: /版權|商標|授權|肖像|copyright|trademark|license|portrait\s*right/i },
  { domain: "settings", pattern: /設定|偏好|通知|主題|preference|theme|setting/i },
  { domain: "notes", pattern: /筆記|存檔|排程|行事曆|todo|note|schedule|calendar/i },
];

const DOMAIN_PRIMARY_SPIRIT: Record<GoalDomain, AgentRole> = {
  image: "image-specialist",
  video: "video-specialist",
  music: "music-specialist",
  voice: "voice-specialist",
  script: "director",
  training: "training-specialist",
  research: "researcher",
  inspiration: "inspiration-specialist",
  anatomy: "anatomy-specialist",
  social: "community-manager",
  legal: "legal-advisor",
  settings: "settings-detail",
  notes: "notes-curator",
  general: "director",
};

/** Domains that don't block one another can be marked parallelizable. */
const PARALLEL_SAFE_DOMAINS = new Set<GoalDomain>([
  "music",
  "voice",
  "research",
  "inspiration",
]);

/** Rough wall-clock estimates per domain (ms) — used for deadline planning. */
const DOMAIN_ETA_MS: Record<GoalDomain, number> = {
  image: 60 * 1000,
  video: 4 * 60 * 1000,
  music: 90 * 1000,
  voice: 45 * 1000,
  script: 30 * 1000,
  training: 20 * 60 * 1000,
  research: 30 * 1000,
  inspiration: 20 * 1000,
  anatomy: 75 * 1000,
  social: 25 * 1000,
  legal: 20 * 1000,
  settings: 10 * 1000,
  notes: 10 * 1000,
  general: 30 * 1000,
};

export interface DecomposedStep {
  stepId: string;
  spirit: AgentRole;
  domain: GoalDomain;
  description: string;
  estimatedDurationMs: number;
  /** stepIds this step waits for. Empty array means it can start immediately. */
  dependsOn: string[];
  /** True if this step can run in parallel with siblings sharing dependencies. */
  parallelizable: boolean;
}

export interface DecomposedPlan {
  steps: DecomposedStep[];
  /** stepIds on the critical (longest-duration) path — drive total ETA. */
  criticalPath: string[];
  /** Conservative end-to-end ETA in milliseconds. */
  totalEtaMs: number;
  /** Steps grouped by stage: each stage runs after the previous completes. */
  parallelGroups: Array<{ stage: number; stepIds: string[] }>;
  /** Risk notes worth surfacing to the user before kicking off. */
  risks: string[];
}

/**
 * Decompose a user goal into a structured plan with spirit assignments.
 *
 * Pure / deterministic — pattern-matches the message into one or more domains
 * and lays them out with realistic dependencies. 總總's LLM layer is expected
 * to consume this skeleton, then narrate / refine it before kicking off
 * delegateTaskToSpirit. We deliberately don't call an LLM here so the tool
 * stays cheap and testable.
 */
export function decomposeGoal(input: {
  userMessage: string;
  /** Optional pre-resolved domain hints (e.g. user already picked "video"). */
  domainHints?: ReadonlyArray<GoalDomain>;
}): DecomposedPlan {
  const text = input.userMessage;
  const detected = new Set<GoalDomain>(input.domainHints ?? []);

  DOMAIN_PATTERNS.forEach(({ domain, pattern }) => {
    if (pattern.test(text)) detected.add(domain);
  });

  // If nothing matched, default to a single "general" step so 總總 can still
  // narrate the next move (likely "ask director to plan").
  if (detected.size === 0) detected.add("general");

  // ── Stage-1: planning. Always present, owned by director, no deps. ──
  // We skip it when the user only asked for a tiny task (notes / settings /
  // legal-only) since those don't need an upfront plan.
  const planningSkipDomains = new Set<GoalDomain>(["notes", "settings", "legal"]);
  const needsPlanning =
    detected.size > 1 ||
    !Array.from(detected).every(d => planningSkipDomains.has(d));

  const steps: DecomposedStep[] = [];
  if (needsPlanning) {
    steps.push({
      stepId: "plan",
      spirit: "director",
      domain: "general",
      description: "導導：把目標拆解成可執行步驟並排序",
      estimatedDurationMs: DOMAIN_ETA_MS.general,
      dependsOn: [],
      parallelizable: false,
    });
  }

  // ── Stage-2: domain-specific creation. Parallel-safe domains share deps. ──
  const stageDeps = needsPlanning ? ["plan"] : [];
  const creationDomains = Array.from(detected).filter(
    d => !planningSkipDomains.has(d) && d !== "general"
  );

  creationDomains.forEach((domain, idx) => {
    steps.push({
      stepId: `do-${domain}`,
      spirit: DOMAIN_PRIMARY_SPIRIT[domain],
      domain,
      description: `${domainNarration(domain)}：${describeStep(domain, text)}`,
      estimatedDurationMs: DOMAIN_ETA_MS[domain],
      // Voice / music depend on video output when both are present (you need
      // a video to lay audio over). Otherwise they're parallel with siblings.
      dependsOn:
        (domain === "voice" || domain === "music") && detected.has("video")
          ? [...stageDeps, "do-video"]
          : stageDeps,
      parallelizable: PARALLEL_SAFE_DOMAINS.has(domain) && creationDomains.length > 1,
    });
  });

  // ── Stage-3: review. Critic closes the loop on multi-step outputs. ──
  const hasCreationSteps = creationDomains.length > 0;
  if (hasCreationSteps) {
    steps.push({
      stepId: "review",
      spirit: "critic",
      domain: "general",
      description: "品品：交付前看一輪整體性、給 1-3 個改進建議",
      estimatedDurationMs: DOMAIN_ETA_MS.general,
      dependsOn: creationDomains.map(d => `do-${d}`),
      parallelizable: false,
    });
  }

  // Cover the case where only "lightweight" domains were detected — emit a
  // single step rather than an empty plan.
  if (steps.length === 0) {
    const onlyDomain = Array.from(detected)[0];
    steps.push({
      stepId: `do-${onlyDomain}`,
      spirit: DOMAIN_PRIMARY_SPIRIT[onlyDomain],
      domain: onlyDomain,
      description: `${domainNarration(onlyDomain)}：${describeStep(onlyDomain, text)}`,
      estimatedDurationMs: DOMAIN_ETA_MS[onlyDomain],
      dependsOn: [],
      parallelizable: false,
    });
  }

  const parallelGroups = computeParallelGroups(steps);
  const criticalPath = computeCriticalPath(steps);
  const totalEtaMs = sumPathDuration(criticalPath, steps);
  const risks = inferRisks(detected, text);

  return {
    steps,
    parallelGroups,
    criticalPath,
    totalEtaMs,
    risks,
  };
}

function domainNarration(domain: GoalDomain): string {
  switch (domain) {
    case "image": return "圖圖";
    case "video": return "影影";
    case "music": return "音音";
    case "voice": return "聲聲";
    case "script": return "導導";
    case "training": return "練練";
    case "research": return "查查";
    case "inspiration": return "靈靈";
    case "anatomy": return "體體";
    case "social": return "群群";
    case "legal": return "律律";
    case "settings": return "細細";
    case "notes": return "記記";
    case "general": return "導導";
  }
}

function describeStep(domain: GoalDomain, _text: string): string {
  // Short verbs per domain. Intentionally not echoing user text back —
  // 總總's LLM layer phrases the final user-facing line.
  switch (domain) {
    case "image": return "依規格出主視覺";
    case "video": return "依分鏡產出影片";
    case "music": return "依情緒產生配樂";
    case "voice": return "錄配音 / 旁白";
    case "script": return "撰寫腳本 / 文案";
    case "training": return "啟動 LoRA 訓練";
    case "research": return "蒐集對標資料 / 比較";
    case "inspiration": return "丟風格 / 方向參考";
    case "anatomy": return "輸出解剖示意圖";
    case "social": return "規劃貼文 + 排程";
    case "legal": return "檢查版權 / IP 風險";
    case "settings": return "套用偏好設定";
    case "notes": return "建檔 / 排程";
    case "general": return "規劃下一棒";
  }
}

function computeParallelGroups(
  steps: ReadonlyArray<DecomposedStep>
): Array<{ stage: number; stepIds: string[] }> {
  // Topological staging: a step belongs to stage = 1 + max(dep.stage). Steps
  // with no deps go in stage 0; siblings in the same stage run in parallel.
  const stageOf = new Map<string, number>();
  const stepById = new Map(steps.map(s => [s.stepId, s]));

  const computeStage = (stepId: string, visiting: Set<string>): number => {
    const cached = stageOf.get(stepId);
    if (cached !== undefined) return cached;
    if (visiting.has(stepId)) {
      // Cycle — shouldn't happen with our DAG, but fail safe rather than loop.
      return 0;
    }
    visiting.add(stepId);
    const step = stepById.get(stepId);
    if (!step) return 0;
    const stage = step.dependsOn.length === 0
      ? 0
      : 1 + Math.max(...step.dependsOn.map(d => computeStage(d, visiting)));
    visiting.delete(stepId);
    stageOf.set(stepId, stage);
    return stage;
  };

  steps.forEach(s => computeStage(s.stepId, new Set()));

  const byStage = new Map<number, string[]>();
  stageOf.forEach((stage, stepId) => {
    const list = byStage.get(stage) ?? [];
    list.push(stepId);
    byStage.set(stage, list);
  });

  return Array.from(byStage.entries())
    .sort(([a], [b]) => a - b)
    .map(([stage, stepIds]) => ({ stage, stepIds }));
}

function computeCriticalPath(steps: ReadonlyArray<DecomposedStep>): string[] {
  // Longest-duration path through the DAG. Built bottom-up so we visit deps
  // before the steps that need them.
  const stepById = new Map(steps.map(s => [s.stepId, s]));
  const bestPath = new Map<string, { duration: number; path: string[] }>();

  const visit = (id: string, visiting: Set<string>): { duration: number; path: string[] } => {
    const cached = bestPath.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return { duration: 0, path: [] };

    const step = stepById.get(id);
    if (!step) return { duration: 0, path: [] };

    visiting.add(id);
    let bestDepDuration = 0;
    let bestDepPath: string[] = [];
    step.dependsOn.forEach(depId => {
      const sub = visit(depId, visiting);
      if (sub.duration > bestDepDuration) {
        bestDepDuration = sub.duration;
        bestDepPath = sub.path;
      }
    });
    visiting.delete(id);

    const result = {
      duration: bestDepDuration + step.estimatedDurationMs,
      path: [...bestDepPath, id],
    };
    bestPath.set(id, result);
    return result;
  };

  let longest = { duration: 0, path: [] as string[] };
  steps.forEach(s => {
    const candidate = visit(s.stepId, new Set());
    if (candidate.duration > longest.duration) longest = candidate;
  });
  return longest.path;
}

function sumPathDuration(
  path: ReadonlyArray<string>,
  steps: ReadonlyArray<DecomposedStep>
): number {
  const stepById = new Map(steps.map(s => [s.stepId, s]));
  return path.reduce((acc, id) => acc + (stepById.get(id)?.estimatedDurationMs ?? 0), 0);
}

function inferRisks(domains: ReadonlySet<GoalDomain>, text: string): string[] {
  const risks: string[] = [];
  if (domains.has("legal") || /真實人物|明星|名人|商標/.test(text)) {
    risks.push("含名人 / IP 風險 — 建議律律先審");
  }
  if (domains.has("training")) {
    risks.push("LoRA 訓練約需 20+ 分鐘且花費點數較高");
  }
  if (domains.has("video") && domains.has("music") && domains.has("voice")) {
    risks.push("多媒體合成步驟長，建議用 plan-executor 自動跑");
  }
  if (/急|趕|asap|urgent/i.test(text)) {
    risks.push("使用者標記急件 — 建議選快速模型而非精細模型");
  }
  return risks;
}

export interface SpiritRecommendation {
  spiritId: AgentRole;
  score: number;
  /** Load-balance signal (0 = available, 1 = saturated). */
  loadScore: number;
  /** Historical success rate if known; null when insufficient data. */
  historicalSuccessRate: number | null;
  sampleSize: number;
  reason: string;
}

/**
 * Recommend the best spirit for a task by combining domain fit, real-time
 * load, and historical reliability. Returns a ranked list — the LLM layer
 * picks the head but can show alternatives to the user.
 */
export function recommendSpiritForTask(input: {
  domain?: GoalDomain;
  /** Hint phrase used to back-fill domain when caller didn't supply one. */
  taskHint?: string;
  /** Specialisation key understood by AgentCollaborationOrchestrator. */
  specialisation?: string;
  taskType?: string;
  excludeSpirits?: ReadonlyArray<AgentRole>;
}): SpiritRecommendation[] {
  try {
    const excluded = new Set<AgentRole>(input.excludeSpirits ?? []);
    const domain = input.domain ?? inferDomain(input.taskHint ?? "");

    // Primary candidate from domain map; supplement with collab-protocol siblings.
    const candidates = new Set<AgentRole>();
    candidates.add(DOMAIN_PRIMARY_SPIRIT[domain]);
    const protocolSiblings = SPIRIT_COLLAB_PROTOCOL[DOMAIN_PRIMARY_SPIRIT[domain]]?.handoffs ?? [];
    protocolSiblings.forEach(h => {
      // Don't pull every handoff target in — only role specialists make sense
      // as a "swap" candidate. Skip generic roles (composer/critic/etc).
      if (
        h.to === "image-specialist" ||
        h.to === "video-specialist" ||
        h.to === "music-specialist" ||
        h.to === "voice-specialist" ||
        h.to === "training-specialist" ||
        h.to === "inspiration-specialist" ||
        h.to === "anatomy-specialist"
      ) {
        candidates.add(h.to);
      }
    });

    const recommendations: SpiritRecommendation[] = [];
    candidates.forEach(spiritId => {
      if (excluded.has(spiritId)) return;
      const status = SpiritStatusMonitor.getStatus(spiritId);
      if (!status) return;

      // Load score: 0 (idle) → 1 (busy/saturated). Error counts as 0.9 — bad
      // but not impossible (caller might still want to know who they were).
      let loadScore = 0;
      if (status.status === "idle") loadScore = 0;
      else if (status.status === "busy") {
        loadScore = status.progress !== undefined && status.progress < 50 ? 0.6 : 0.9;
      } else if (status.status === "error") loadScore = 0.9;
      else loadScore = 1; // offline

      const history = SpiritStatusMonitor.getSuccessRate(spiritId, input.taskType);
      const reliability = history?.successRate ?? 0.75; // unknown → neutral-ish
      const isPrimary = spiritId === DOMAIN_PRIMARY_SPIRIT[domain];

      // Score: weighted blend. domain fit dominates; load and reliability tilt.
      const score =
        (isPrimary ? 1.0 : 0.5) * 60 +
        (1 - loadScore) * 25 +
        reliability * 15;

      recommendations.push({
        spiritId,
        score,
        loadScore,
        historicalSuccessRate: history?.successRate ?? null,
        sampleSize: history?.sampleSize ?? 0,
        reason: buildRecommendationReason(spiritId, domain, status, history),
      });
    });

    recommendations.sort((a, b) => b.score - a.score);

    logger.debug("spirit_recommendations_computed", {
      domain,
      candidates: recommendations.length,
      top: recommendations[0]?.spiritId,
    });

    return recommendations;
  } catch (error) {
    logger.error("recommend_spirit_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function inferDomain(hint: string): GoalDomain {
  for (const { domain, pattern } of DOMAIN_PATTERNS) {
    if (pattern.test(hint)) return domain;
  }
  return "general";
}

function buildRecommendationReason(
  spiritId: AgentRole,
  domain: GoalDomain,
  status: SpiritStatus,
  history: { successRate: number; sampleSize: number } | null
): string {
  const parts: string[] = [];
  parts.push(`${spiritId} 領域對應 ${domain}`);
  parts.push(`目前 ${status.status}`);
  if (history && history.sampleSize >= 3) {
    parts.push(`歷史成功率 ${(history.successRate * 100).toFixed(0)}% (n=${history.sampleSize})`);
  }
  return parts.join("、");
}

export interface BottleneckAnalysis {
  stuckTasks: ReturnType<typeof SpiritStatusMonitor.getStuckTaskAnalysis>;
  failureClusters: ReturnType<typeof SpiritStatusMonitor.getFailureClusters>;
  atRiskTasks: TeamStatusSummary["atRiskTasks"];
  /** Human-readable next actions 總總 should consider. */
  recommendations: string[];
}

/**
 * Look at the current team state and surface anything 總總 should act on:
 * stuck tasks, degraded spirits, deadlines about to breach. Pure analysis,
 * no side effects — the LLM decides whether to escalate or retry.
 */
export function analyzeBottlenecks(): BottleneckAnalysis {
  try {
    const stuckTasks = SpiritStatusMonitor.getStuckTaskAnalysis();
    const failureClusters = SpiritStatusMonitor.getFailureClusters();
    const summary = SpiritStatusMonitor.getTeamSummary();
    const recommendations: string[] = [];

    stuckTasks.forEach(s => {
      const mins = Math.floor(s.longestDurationMs / 60000);
      recommendations.push(
        `${s.spiritId} 的 ${s.taskType} 已跑 ${mins} 分鐘 — 考慮 retryWithFallback 或詢問使用者是否取消`
      );
    });

    failureClusters
      .filter(c => c.failureRate >= 0.5 && c.failureCount >= 2)
      .forEach(c => {
        recommendations.push(
          `${c.spiritId} 最近失敗率 ${(c.failureRate * 100).toFixed(0)}% (${c.failureCount}/${c.failureCount + c.successCount}) — 短期改派替代精靈`
        );
      });

    summary.atRiskTasks.forEach(t => {
      if (t.overdue) {
        recommendations.push(`任務 ${t.taskId} 已超過截止時間 — 立即升級`);
      } else {
        recommendations.push(
          `任務 ${t.taskId} 還剩 ${Math.floor(t.remainingMs / 1000)} 秒到截止 — 提示使用者風險`
        );
      }
    });

    return {
      stuckTasks,
      failureClusters,
      atRiskTasks: summary.atRiskTasks,
      recommendations,
    };
  } catch (error) {
    logger.error("analyze_bottlenecks_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      stuckTasks: [],
      failureClusters: [],
      atRiskTasks: [],
      recommendations: ["瓶頸分析失敗 — 系統錯誤"],
    };
  }
}

/**
 * When a task fails on its assigned spirit, pick an alternative and start
 * the retry. Records both outcomes (the failure that triggered it, plus the
 * retry itself) so historical success rates capture the recovery path.
 */
export async function retryTaskWithFallback(input: {
  failedSpiritId: AgentRole;
  failedTaskId: string;
  taskType: string;
  userId: number;
  failureReason: string;
  /** Caller-supplied preferred alternates; tried in order before fallback. */
  preferredAlternatives?: ReadonlyArray<AgentRole>;
  /** Hint phrase used by recommendSpiritForTask if no alternatives supplied. */
  taskHint?: string;
}): Promise<{
  retrying: boolean;
  newSpiritId?: AgentRole;
  newTaskId?: string;
  message: string;
}> {
  try {
    // Record the failure first so recommendSpiritForTask sees it.
    SpiritStatusMonitor.reportError(
      input.failedSpiritId,
      input.failureReason,
      input.failedTaskId
    );

    // Decide who to try next. Honor caller preference first, then ranked recs.
    const excluded: AgentRole[] = [input.failedSpiritId];
    let chosen: AgentRole | undefined;

    if (input.preferredAlternatives) {
      chosen = input.preferredAlternatives.find(alt => {
        if (excluded.includes(alt)) return false;
        const status = SpiritStatusMonitor.getStatus(alt);
        return status !== null && status.status !== "offline";
      });
    }

    if (!chosen) {
      const recommendations = recommendSpiritForTask({
        taskHint: input.taskHint,
        taskType: input.taskType,
        excludeSpirits: excluded,
      });
      chosen = recommendations[0]?.spiritId;
    }

    if (!chosen) {
      logger.warn("retry_no_alternative", {
        failedSpiritId: input.failedSpiritId,
        failedTaskId: input.failedTaskId,
      });
      return {
        retrying: false,
        message: `找不到 ${input.failedSpiritId} 的可用替代精靈 — 建議告知使用者並手動指派`,
      };
    }

    // Start a new task ID on the chosen spirit. Suffix the original taskId
    // so traceability is preserved on the new outcome record.
    const newTaskId = `${input.failedTaskId}::retry::${Date.now()}`;
    SpiritStatusMonitor.startTask({
      spiritId: chosen,
      taskId: newTaskId,
      taskType: input.taskType,
      userId: input.userId,
      metadata: {
        retryOf: input.failedTaskId,
        retryReason: input.failureReason,
      },
    });

    logger.info("task_retried_with_fallback", {
      failedSpiritId: input.failedSpiritId,
      failedTaskId: input.failedTaskId,
      newSpiritId: chosen,
      newTaskId,
    });

    return {
      retrying: true,
      newSpiritId: chosen,
      newTaskId,
      message: `已把 ${input.failedTaskId} 從 ${input.failedSpiritId} 改派給 ${chosen}`,
    };
  } catch (error) {
    logger.error("retry_with_fallback_failed", {
      failedTaskId: input.failedTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      retrying: false,
      message: `重試失敗 — ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Attach a soft deadline to a running task. The team summary will surface
 * the task in `atRiskTasks` when it's within 1 minute of breaching, so 總總's
 * next status check naturally exposes the risk.
 */
export function setTaskDeadline(input: {
  taskId: string;
  deadlineAt: number;
}): { set: boolean; message: string } {
  try {
    const ok = SpiritStatusMonitor.setDeadline(input.taskId, input.deadlineAt);
    if (!ok) {
      return {
        set: false,
        message: `任務 ${input.taskId} 不存在或沒有負責的精靈`,
      };
    }
    return {
      set: true,
      message: `任務 ${input.taskId} 的截止時間已設定`,
    };
  } catch (error) {
    logger.error("set_task_deadline_failed", {
      taskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      set: false,
      message: `設定截止時間失敗 — ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
