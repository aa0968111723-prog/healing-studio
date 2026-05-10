/**
 * multiAgentDetector.ts — Heuristics for detecting when multi-agent
 * collaboration is beneficial vs single-agent execution.
 *
 * Used by orbTaskChainRunner to route complex tasks through the
 * AgentCollaborationOrchestrator instead of direct single-agent execution.
 */

import type { PageAgentSnapshot } from "../../shared/agent-actions";
import type { AgentRole } from "../../shared/orb-agent-roles";
import {
  MODALITY_KEYWORDS,
  detectModalitiesFromText,
  modalityToSpecialistAgentId,
  type ModalityId,
} from "../../shared/agent-modality-keywords";
import { selectRoleForIntent } from "../../shared/orb-agent-roles";

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

  // ─── Heuristic 0: Explicit「規劃 + 執行 一條龍」(plan-executor 接管) ──
  // 命中強訊號詞時直接推 plan-executor 為主角，並把可能的 specialist
  // 一起列入。這條比訓練更高優先 — 因為使用者明確說了「自動跑」就是要
  // 23 位精靈裡的步步出場，不是 director 規劃完就停。
  const planExecutorHints = [
    "從規劃到執行",
    "從規劃到完成",
    "一條龍",
    "整套跑完",
    "整個流程跑完",
    "自動執行",
    "自動跑完",
    "全自動",
    "從頭到尾跑完",
    "auto execute",
    "auto run",
    "end-to-end run",
    "from plan to ship",
    "execute the plan",
    "run the plan",
    "run the workflow",
  ];
  if (planExecutorHints.some(kw => msg.includes(kw))) {
    const downstream = detectModalitiesFromText(msg);
    const agents: AgentRole[] = ["director", "plan-executor"];
    for (const m of downstream) {
      agents.push(modalityToSpecialistAgentId(m) as AgentRole);
    }
    return {
      shouldCollaborate: true,
      confidence: 0.9,
      reason: "使用者明確要求規劃 + 多步驟自動執行 — 步步接管",
      suggestedAgents: Array.from(new Set(agents)),
    };
  }

  // ─── Heuristic 0b: 團隊總覽 / orchestration 訊號 → 總總出場 ─────
  if (
    msg.includes("總管") ||
    msg.includes("整體進度") ||
    msg.includes("誰在做什麼") ||
    msg.includes("agent overview") ||
    msg.includes("orchestrate") ||
    msg.includes("team status")
  ) {
    return {
      shouldCollaborate: true,
      confidence: 0.7,
      reason: "使用者要看團隊整體狀態 — 總總接手協調",
      suggestedAgents: ["chief-orchestrator", "director"],
    };
  }

  // ─── Heuristic 1: Training + generation workflow ───────────────────
  // Check this FIRST because it's highly specific
  if (msg.includes("訓練") || msg.includes("training")) {
    // 「訓練」下接任何 modality（圖／影／音／配音／3D）就視為 train+gen 流程。
    // detectModalitiesFromText 用 shared 關鍵字表，避免和 orb-agent-roles
    // 的 specialist router 失同步。
    const detected = detectModalitiesFromText(msg);
    if (detected.length > 0 || msg.includes("模型")) {
      return {
        shouldCollaborate: true,
        confidence: 0.75,
        reason: "檢測到訓練與生成結合的工作流程",
        suggestedAgents: ["director", "training-specialist"],
      };
    }
  }

  // ─── Heuristic 2: Complex creation tasks ───────────────────────────
  const complexCreationPatterns = [
    "製作.*影片.*配.*音樂",
    "製作.*影片.*加.*音",
    "生成.*動畫.*加.*配音",
    "創作.*短.*影片.*音效",
    "做.*影片.*背景音",
    "製作.*帶.*音樂.*影片",
    "製作帶.*音樂.*影片",
    "帶.*音樂.*影片",
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

  // 用 shared 關鍵字表 — 不要再重新宣告，避免和 orb-agent-roles 的 specialist
  // router 失同步（先前就因為這裡少了「畫」「繪製」而漏判 image 模態）。
  const detectedModalities: ModalityId[] = detectModalitiesFromText(msg);

  // ─── Heuristic 3: Explicit collaboration keywords ──────────────────
  // Check for EXPLICIT collaboration intent keywords (not just "then")
  const explicitCollaborationKeywords = [
    "協作",
    "合作",
    "一起",
    "再加上",
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

  if (explicitCollaborationKeywords.some(kw => msg.includes(kw)) && detectedModalities.length > 0) {
    return {
      shouldCollaborate: true,
      confidence: 0.7,
      reason: "檢測到明確的協作意圖關鍵字",
      suggestedAgents: ["director"],
    };
  }

  // ─── Heuristic 4: Multi-step workflow indicators ───────────────────
  const workflowIndicators = [
    "步驟",
    "流程",
    "工作流",
    "先.*再",
    "第一.*第二",
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

  // ─── Heuristic 5: Multiple modalities mentioned (with "然後"/"接著") ──
  // Check for multi-modality with sequential indicators
  const sequentialKeywords = ["然後", "接著", "then"];
  const hasSequential = sequentialKeywords.some(kw => msg.includes(kw));

  if (hasSequential && detectedModalities.length >= 2) {
    return {
      shouldCollaborate: true,
      confidence: 0.8,
      reason: `檢測到多模態需求：${detectedModalities.join("、")}`,
      suggestedAgents: buildSuggestedAgents(detectedModalities),
    };
  }

  // ─── Heuristic 6: Multiple modalities mentioned (general) ──────────
  // Check this LAST because it's the most general heuristic
  // Multi-modality signal: 2+ different modalities mentioned
  if (detectedModalities.length >= 2) {
    return {
      shouldCollaborate: true,
      confidence: 0.8,
      reason: `檢測到多模態需求：${detectedModalities.join("、")}`,
      suggestedAgents: buildSuggestedAgents(detectedModalities),
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
 * Map modalities to specialist agent ids, dedupe, prepend director.
 * Used by heuristics 5/6 to build the suggestedAgents list. Pulling
 * this into a helper removes ~25 lines of repetition that previously
 * fell out of sync (image+3d were both treated as image-specialist
 * in heuristic 5 but heuristic 1 used a parallel keyword set).
 */
function buildSuggestedAgents(modalities: ModalityId[]): AgentRole[] {
  const agents = new Set<AgentRole>(["director"]);
  for (const m of modalities) {
    agents.add(modalityToSpecialistAgentId(m) as AgentRole);
  }
  return [...agents];
}

/**
 * Lightweight check — used in hot paths where we want to skip expensive
 * collaboration checks for obviously simple tasks.
 */
export function isObviouslySingleAgentTask(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();

  // Exclude complex patterns first (negative patterns)
  const complexIndicators = [
    "然後",
    "再加上",
    "接著",
    "配合",
    "結合",
    "搭配",
    "組合",
    "整合",
    "first.*then",
    "with.*music",
    "帶.*音樂",
    "帶音樂",
    "加.*音",
    "加音",
    "做成.*影片",
  ];

  if (complexIndicators.some(pattern => {
    try {
      return new RegExp(pattern, "i").test(msg);
    } catch {
      return msg.includes(pattern);
    }
  })) {
    return false;
  }

  // Very short messages (< 10 chars) with no complexity are usually simple
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
