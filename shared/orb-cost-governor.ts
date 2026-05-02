/**
 * shared/orb-cost-governor.ts
 *
 * Pre-flight cost estimate + budget gate for workflows. Lets the
 * orchestrator answer "is this workflow about to spend more than the user
 * is comfortable with?" BEFORE any tool fires. Real per-call pricing
 * lives in `videoModelCatalog` / `engineModelIds` / `falModelCapabilities`
 * and is highly model-specific — this module deliberately uses coarse
 * tier-based estimates so the planner can decide gating WITHOUT pulling
 * in those large catalogs (and without leaking pricing into the client).
 *
 * Two integration points:
 *   1. `estimateWorkflowCost(steps, table)` — pure: rough credits +
 *      duration + max-risk tier for an `AgentWorkflowStep[]`.
 *   2. `shouldRequireBudgetConfirm(estimate, budget)` — pure: returns
 *      `{ required, reason }`. The orchestrator can convert this into a
 *      step-by-step confirmation OR a single up-front confirmation card.
 *
 * Pure / sync / no I/O. Caller supplies the cost table; tests use a
 * deterministic table, production wires the prod table at startup.
 */
import type { AgentWorkflowStep } from "./agent-actions";
import { getGlobalAgentTool } from "./global-agent-tools";

export type CostRiskTier = "free" | "cheap" | "medium" | "expensive" | "premium";

export interface CostEntry {
  /** Estimated credits the call will spend. */
  credits: number;
  /** Estimated wall-clock duration in ms (used for "this will take ~5 min"). */
  durationMs: number;
  /** Coarse risk tier — drives confirmation thresholds. */
  tier: CostRiskTier;
}

/** Cost lookup. Caller passes a Map for production; tests can pass a small one. */
export type CostTable = Map<string, CostEntry>;

/** Per-tool defaults — intentionally conservative (slight over-estimate). */
export const DEFAULT_COST_TABLE: CostTable = new Map<string, CostEntry>([
  ["studio.generateImage", { credits: 8, durationMs: 12_000, tier: "cheap" }],
  ["studio.generateVideo", { credits: 60, durationMs: 90_000, tier: "expensive" }],
  ["studio.enhanceVideo", { credits: 20, durationMs: 60_000, tier: "medium" }],
  ["studio.generateAudio", { credits: 12, durationMs: 30_000, tier: "medium" }],
  ["studio.generateSfx", { credits: 6, durationMs: 12_000, tier: "cheap" }],
  ["studio.generateVoice", { credits: 6, durationMs: 8_000, tier: "cheap" }],
  ["studio.cloneVoice", { credits: 10, durationMs: 15_000, tier: "medium" }],
  ["studio.designVoice", { credits: 8, durationMs: 10_000, tier: "medium" }],
  ["studio.changeVoice", { credits: 8, durationMs: 12_000, tier: "medium" }],
  ["studio.transcribe", { credits: 2, durationMs: 12_000, tier: "cheap" }],
  ["studio.separateStems", { credits: 6, durationMs: 30_000, tier: "medium" }],
  ["studio.isolateAudio", { credits: 4, durationMs: 15_000, tier: "cheap" }],
  ["studio.mergeAudios", { credits: 2, durationMs: 8_000, tier: "cheap" }],
  ["studio.animateSpeaker", { credits: 80, durationMs: 120_000, tier: "premium" }],
  ["studio.trainLora", { credits: 200, durationMs: 1_200_000, tier: "premium" }],
  ["media.transcribe", { credits: 2, durationMs: 8_000, tier: "cheap" }],
  ["media.caption", { credits: 1, durationMs: 4_000, tier: "free" }],
  ["media.storyboard", { credits: 4, durationMs: 6_000, tier: "cheap" }],
  ["media.summarizePdf", { credits: 3, durationMs: 8_000, tier: "cheap" }],
  ["media.extractPrompt", { credits: 0, durationMs: 1_500, tier: "free" }],
  ["director.suggestPlan", { credits: 1, durationMs: 4_000, tier: "free" }],
]);

const UI_DISPATCH_BASE: CostEntry = {
  credits: 0,
  durationMs: 1_500,
  tier: "free",
};

const SUBMIT_DISPATCH: CostEntry = {
  credits: 5,
  durationMs: 15_000,
  tier: "cheap",
};

/** Numeric ranking so we can compute the max tier in a list. */
const TIER_RANK: Record<CostRiskTier, number> = {
  free: 0,
  cheap: 1,
  medium: 2,
  expensive: 3,
  premium: 4,
};

function maxTier(a: CostRiskTier, b: CostRiskTier): CostRiskTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export interface PerStepCost {
  stepIndex: number;
  stepLabel: string;
  toolName?: string;
  /** Whether this step counts as a tool call; UI dispatches use the base. */
  source: "tool" | "ui-submit" | "ui-other";
  cost: CostEntry;
}

export interface WorkflowCostEstimate {
  totalCredits: number;
  totalDurationMs: number;
  maxTier: CostRiskTier;
  breakdown: PerStepCost[];
  /** True when at least one step is a `submit` or a registered tool. */
  hasBillableStep: boolean;
}

/**
 * Build a cost estimate for a workflow. UI-only steps are charged at
 * their base (free for fillPrompt / setModel / …, ~5 credits for submit
 * since it kicks off async generation). Tool calls are looked up in the
 * provided cost table; unknown tools are charged at "medium" tier with a
 * conservative 10-credit / 30-second placeholder so the gate behaves
 * predictably even when the registry grows new tools faster than the
 * cost table.
 */
export function estimateWorkflowCost(
  steps: AgentWorkflowStep[],
  table: CostTable = DEFAULT_COST_TABLE
): WorkflowCostEstimate {
  const breakdown: PerStepCost[] = [];
  let totalCredits = 0;
  let totalDurationMs = 0;
  let max: CostRiskTier = "free";
  let hasBillable = false;

  steps.forEach((step, index) => {
    let cost: CostEntry;
    let source: PerStepCost["source"];
    if (step.toolName) {
      const known = getGlobalAgentTool(step.toolName);
      const looked = table.get(step.toolName);
      cost = looked ?? {
        credits: 10,
        durationMs: 30_000,
        // Unknown but registered tools assume medium risk; truly unknown
        // tools (not in registry) assume expensive — they're more
        // suspicious and gating should err on the side of confirming.
        tier: known ? "medium" : "expensive",
      };
      source = "tool";
      hasBillable = true;
    } else if (step.actionType === "submit") {
      cost = SUBMIT_DISPATCH;
      source = "ui-submit";
      hasBillable = true;
    } else {
      cost = UI_DISPATCH_BASE;
      source = "ui-other";
    }
    breakdown.push({
      stepIndex: index,
      stepLabel: step.label,
      toolName: step.toolName,
      source,
      cost,
    });
    totalCredits += cost.credits;
    totalDurationMs += cost.durationMs;
    max = maxTier(max, cost.tier);
  });

  return {
    totalCredits,
    totalDurationMs,
    maxTier: max,
    breakdown,
    hasBillableStep: hasBillable,
  };
}

export interface UserBudget {
  /**
   * Remaining credits in this session / day. The governor is unaware of
   * the unit (credits vs. dollars vs. tokens) — you pass numbers, it
   * compares numbers. Caller's job to keep the unit consistent.
   */
  remainingCredits?: number;
  /** Per-workflow ceiling. Above this → require confirmation. */
  perWorkflowCap?: number;
  /**
   * When set, any workflow whose `maxTier` is `>=` this requires
   * confirmation regardless of credit math. Lets cautious users ask for
   * "always confirm anything expensive even if I have credits".
   */
  confirmAtTierOrAbove?: CostRiskTier;
  /** Estimate is informational only; never gate. */
  alwaysAllow?: boolean;
}

export interface BudgetGateDecision {
  /** True when the orchestrator should pause for user confirmation. */
  required: boolean;
  /** Human-readable explanation for the confirmation card. */
  reason: string;
  /** The estimate that drove the decision (echoed for telemetry). */
  estimate: WorkflowCostEstimate;
}

/**
 * Decide whether the orchestrator must pause before running this workflow.
 * Three conditions trip the gate:
 *   - Tier-floor: the workflow's `maxTier` >= `confirmAtTierOrAbove`.
 *   - Cap: total credits exceed `perWorkflowCap`.
 *   - Insufficient: total credits exceed `remainingCredits`.
 *
 * `alwaysAllow=true` short-circuits to no-confirm (informational mode).
 * No budget at all = pass through (caller chose not to gate).
 */
export function shouldRequireBudgetConfirm(
  estimate: WorkflowCostEstimate,
  budget?: UserBudget
): BudgetGateDecision {
  if (!budget || budget.alwaysAllow) {
    return { required: false, reason: "no budget configured / always allow", estimate };
  }
  if (!estimate.hasBillableStep) {
    return {
      required: false,
      reason: "workflow has no billable step (UI navigation only)",
      estimate,
    };
  }
  if (typeof budget.remainingCredits === "number" && estimate.totalCredits > budget.remainingCredits) {
    return {
      required: true,
      reason: `工作流估算 ${estimate.totalCredits} 點，超過剩餘 ${budget.remainingCredits} 點`,
      estimate,
    };
  }
  if (typeof budget.perWorkflowCap === "number" && estimate.totalCredits > budget.perWorkflowCap) {
    return {
      required: true,
      reason: `工作流估算 ${estimate.totalCredits} 點，超過單次上限 ${budget.perWorkflowCap} 點`,
      estimate,
    };
  }
  if (
    budget.confirmAtTierOrAbove &&
    TIER_RANK[estimate.maxTier] >= TIER_RANK[budget.confirmAtTierOrAbove]
  ) {
    return {
      required: true,
      reason: `工作流最高風險為「${estimate.maxTier}」，使用者要求 ${budget.confirmAtTierOrAbove} 以上必確認`,
      estimate,
    };
  }
  return { required: false, reason: "within budget", estimate };
}

const TIER_LABELS: Record<CostRiskTier, string> = {
  free: "免費",
  cheap: "便宜",
  medium: "中等",
  expensive: "昂貴",
  premium: "高階",
};

/** Human-readable summary for the confirmation card. */
export function formatCostEstimateForUser(estimate: WorkflowCostEstimate): string {
  const minutes = Math.round((estimate.totalDurationMs / 60_000) * 10) / 10;
  const lines: string[] = [];
  lines.push(
    `預估費用 ${estimate.totalCredits} 點 · 約 ${minutes} 分鐘 · 最高風險：${TIER_LABELS[estimate.maxTier]}`
  );
  for (const row of estimate.breakdown.slice(0, 6)) {
    const tag = row.toolName ?? row.source;
    lines.push(
      `- ${row.stepIndex + 1}. ${row.stepLabel}（${tag}）：${row.cost.credits} 點`
    );
  }
  if (estimate.breakdown.length > 6) {
    lines.push(`…（共 ${estimate.breakdown.length} 步）`);
  }
  return lines.join("\n");
}
