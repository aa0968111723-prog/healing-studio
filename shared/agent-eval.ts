import type { PlannerMultimodalPartSummary } from "../server/services/agentPlanner";
import type { AgentPlanV3Routing as AgentPlanRouting } from "./agent-plan-schema";

export interface AgentEvalCase {
  id: string;
  description: string;
  pageId: string;
  userMessage: string;
  attachments?: PlannerMultimodalPartSummary[];
  expectedPlanProperties: {
    minSteps?: number;
    maxSteps?: number;
    requiredActionTypes?: string[];
    forbiddenActionTypes?: string[];
    expectedRouting?: Partial<AgentPlanRouting>;
    shouldNotBeBlocked?: boolean;
    shouldBeBlocked?: boolean;
  };
  tags?: string[];
}

export interface AgentEvalResult {
  caseId: string;
  passed: boolean;
  score: number;
  violations: string[];
  rawPlan?: unknown;
  durationMs: number;
}

export interface AgentEvalReport {
  totalCases: number;
  passed: number;
  failed: number;
  averageScore: number;
  results: AgentEvalResult[];
  ranAt: string;
}
