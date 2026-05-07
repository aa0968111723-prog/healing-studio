/**
 * multiAgentDetector.ts — Heuristics for detecting when multi-agent
 * collaboration is beneficial vs single-agent execution.
 *
 * Used by orbTaskChainRunner to route complex tasks through the
 * AgentCollaborationOrchestrator instead of direct single-agent execution.
 */

import type { PageAgentSnapshot } from "../../shared/agent-actions";
import type { AgentRole } from "../../shared/orb-agent-roles";

export interface MultiAgentDetectionInput {
  /** User's intent/message */
  userMessage: string;
  /** Current page snapshot if available */
  pageSnapshot?: PageAgentSnapshot | null;
  /** Detected primary agent role */
  primaryRole?: AgentRole;
  /** Conversation turn count */
  turnCount?: number;
}

export interface MultiAgentDetectionResult {
  /** Whether to use multi-agent collaboration */
  shouldCollaborate: boolean;
  /** Confidence level (0-1) */
  confidence: number;
  /** Reasoning for the decision */
  reason: string;
  /** Suggested participating agents if collaboration is recommended */
  suggestedAgents?: AgentRole[];
}

/**
 * Detect if a task requires multi-agent collaboration based on complexity
 * heuristics.
 */
export function detectMultiAgentNeed(
  input: MultiAgentDetectionInput
): MultiAgentDetectionResult {
  const msg = input.userMessage.toLowerCase();

  // ─── Heuristic 1: Multiple modalities mentioned ────────────────────
  const modalityKeywords = {
    image: ["圖", "圖片", "圖像", "照片", "image", "photo", "picture"],
    video: ["影片", "視頻", "video", "動畫", "animation"],
    music: ["音樂", "音訊", "音效", "背景音", "music", "audio", "sound", "soundtrack"],
    voice: ["配音", "語音", "聲音", "voice", "narration", "dubbing", "說話"],
    "3d": ["3d", "三維", "立體", "模型", "3d model"],
  };

  const detectedModalities: string[] = [];
  for (const [modality, keywords] of Object.entries(modalityKeywords)) {
    if (keywords.some(kw => msg.includes(kw))) {
      detectedModalities.push(modality);
    }
  }

  // Multi-modality signal: 2+ different modalities mentioned
  if (detectedModalities.length >= 2) {
    const agents: AgentRole[] = [];
    if (detectedModalities.includes("image") || detectedModalities.includes("3d")) {
      agents.push("image-specialist");
    }
    if (detectedModalities.includes("video")) {
      agents.push("video-specialist");
    }
    if (detectedModalities.includes("music")) {
      agents.push("music-specialist");
    }
    if (detectedModalities.includes("voice")) {
      agents.push("voice-specialist");
    }

    return {
      shouldCollaborate: true,
      confidence: 0.8,
      reason: `檢測到多模態需求：${detectedModalities.join("、")}`,
      suggestedAgents: ["director", ...agents],
    };
  }

  // ─── Heuristic 2: Explicit collaboration keywords ──────────────────
  const collaborationKeywords = [
    "協作",
    "合作",
    "一起",
    "然後",
    "再加上",
    "接著",
    "配合",
    "結合",
    "搭配",
    "組合",
    "整合",
    "collaborate",
    "together",
    "combine",
    "then add",
  ];

  if (collaborationKeywords.some(kw => msg.includes(kw)) && detectedModalities.length > 0) {
    return {
      shouldCollaborate: true,
      confidence: 0.7,
      reason: "檢測到明確的協作意圖關鍵字",
      suggestedAgents: ["director"],
    };
  }

  // ─── Heuristic 3: Multi-step workflow indicators ───────────────────
  const workflowIndicators = [
    "步驟",
    "流程",
    "工作流",
    "先.*再",
    "第一.*第二",
    "接著",
    "然後.*再",
    "step",
    "workflow",
    "process",
    "first.*then",
  ];

  const hasWorkflowIndicator = workflowIndicators.some(pattern => {
    try {
      return new RegExp(pattern, "i").test(msg);
    } catch {
      return msg.includes(pattern);
    }
  });

  if (hasWorkflowIndicator && detectedModalities.length > 0) {
    return {
      shouldCollaborate: true,
      confidence: 0.6,
      reason: "檢測到多步驟工作流程需求",
      suggestedAgents: ["director"],
    };
  }

  // ─── Heuristic 4: Complex creation tasks ───────────────────────────
  const complexCreationPatterns = [
    "製作.*影片.*配.*音樂",
    "生成.*動畫.*加.*配音",
    "創作.*短.*影片.*音效",
    "做.*影片.*背景音",
    "create.*video.*with.*music",
    "make.*animated.*with.*sound",
  ];

  if (complexCreationPatterns.some(pattern => {
    try {
      return new RegExp(pattern, "i").test(msg);
    } catch {
      return false;
    }
  })) {
    return {
      shouldCollaborate: true,
      confidence: 0.85,
      reason: "檢測到複雜的多模態創作任務",
      suggestedAgents: ["director", "video-specialist", "music-specialist"],
    };
  }

  // ─── Heuristic 5: Training + generation workflow ───────────────────
  if (msg.includes("訓練") && detectedModalities.length > 0) {
    return {
      shouldCollaborate: true,
      confidence: 0.75,
      reason: "檢測到訓練與生成結合的工作流程",
      suggestedAgents: ["director", "training-specialist"],
    };
  }

  // ─── Default: Single-agent execution ───────────────────────────────
  return {
    shouldCollaborate: false,
    confidence: 0.9,
    reason: "任務適合單一 agent 執行",
  };
}

/**
 * Lightweight check — used in hot paths where we want to skip expensive
 * collaboration checks for obviously simple tasks.
 */
export function isObviouslySingleAgentTask(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();

  // Very short messages (< 10 chars) are usually simple
  if (msg.length < 10) return true;

  // Single modality, no complexity indicators
  const simplePatterns = [
    /^生成.*圖$/,
    /^產生.*圖片$/,
    /^generate.*image$/,
    /^create.*picture$/,
    /^製作.*照片$/,
  ];

  return simplePatterns.some(pattern => pattern.test(msg));
}
