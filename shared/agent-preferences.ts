export type AgentConfirmationPolicy =
  | "always_approve"
  | "confirm_high_risk"
  | "confirm_all"
  | "manual";

export type AgentVoiceName = "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede";

export type OrbWidgetCorner =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

export type CostBudgetTier =
  | "free"
  | "cheap"
  | "medium"
  | "expensive"
  | "premium";

export type AgentPacingOverride = "auto" | "patient" | "balanced" | "impatient";

export type PerceptionStrictness = "lenient" | "balanced" | "strict";

/**
 * Per-user cost budget. All fields optional — `undefined` means "don't gate
 * on this dimension". The orchestrator's `estimateAndConfirmBudget` hook
 * folds these into the gate decision via `shouldRequireBudgetConfirm`.
 */
export interface AgentCostBudget {
  /** Soft credit cap per workflow run; over → confirmation card. */
  perWorkflowCap?: number | null;
  /** Hard credit cap remaining for today/session; over → confirmation card. */
  remainingCredits?: number | null;
  /** Tier floor — workflows ≥ this tier always confirm regardless of credits. */
  confirmAtTierOrAbove?: CostBudgetTier | null;
  /** Pure informational mode — never gate even when caps are set. */
  alwaysAllow?: boolean | null;
}

export interface AgentPreferences {
  userId: number;
  // ── Confirmation / safety ─────────────────────────────────────
  confirmationPolicy: AgentConfirmationPolicy;
  allowedRiskLevels: string[];
  autoApproveTools: string[];
  blockedTools: string[];
  maxAutoStepsPerTask: number;
  notifyOnCompletion: boolean;
  notifyOnError: boolean;
  // ── Voice (光球助手語音) ──────────────────────────────────────
  voiceEnabled: boolean;
  preferredVoiceName: AgentVoiceName;
  voiceAutoActivate: boolean;
  // ── Per-user overrides for env-flag features ──────────────────
  /** null = follow VITE_ENABLE_ORB_AGENT env flag; true/false = override. */
  orbAgentEnabled: boolean | null;
  /** null = follow VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS env flag. */
  workflowsEnabled: boolean | null;
  /** Page IDs the user has disabled agent dispatch for. */
  disabledPageAgents: string[];
  /**
   * Fine-grained allowlist: 2-D map of pageId → array of action types the
   * user has explicitly disabled on that page. Empty / missing pageId =
   * follow disabledPageAgents (all-or-nothing).
   *
   * Example: `{ "image-studio": ["submit", "applyPreset"] }` lets the orb
   * fillPrompt and navigate but blocks destructive submit / preset apply.
   */
  disabledActionsByPage: Record<string, string[]>;
  // ── Orb assistant UI prefs ────────────────────────────────────
  orbWidgetCorner: OrbWidgetCorner;
  orbWelcomeMessage: string | null;
  orbShortcutEnabled: boolean;
  orbProactiveSuggestions: boolean;

  // ── Phase D: deep agent settings ───────────────────────────────────────
  /**
   * Cost governor budget. Empty/null = no gating.
   * Wired into `executeGlobalWorkflow` via `ctx.estimateAndConfirmBudget`.
   */
  costBudget: AgentCostBudget | null;
  /**
   * Toggle the perception loop. When true the page agent layer captures a
   * post-step snapshot, runs `evaluateStepOutcome`, and surfaces verdicts
   * (proceed / retry / replan / abort) back to the orchestrator.
   */
  perceptionEnabled: boolean;
  /**
   * Strictness controls how aggressively the perception loop calls "no
   * effect": lenient = skip warnings, balanced = treat warnings as replan
   * trigger (default), strict = treat any unchanged snapshot as failure.
   */
  perceptionStrictness: PerceptionStrictness;
  /**
   * Toggle the planner self-critique pass. When true the chat router
   * passes `enableCritique: true` to `runSchemaFirstAgentPlannerWithCritique`.
   * Defaults to false — refine spends one extra LLM round trip.
   */
  criticEnabled: boolean;
  /** Refine threshold (0..100). Plans scoring < this run the refine pass. */
  criticRefineBelow: number;
  /**
   * When true, the chat router consults `selectRoleForIntent` and folds the
   * resulting role's prompt slice into the system prompt. Defaults true.
   */
  roleAutoSwitch: boolean;
  /**
   * Override the auto-detected pacing tier. "auto" = use the distilled
   * profile's pacing inference; the other values force a fixed tier.
   */
  pacingOverride: AgentPacingOverride;
  /**
   * Has the user finished the first-time orb onboarding? Used by
   * `OrbOnboardingDialog` to decide whether to show the cold-start tutorial.
   */
  onboardingCompletedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_AGENT_PREFERENCES: Omit<AgentPreferences, "userId"> = {
  confirmationPolicy: "confirm_high_risk",
  allowedRiskLevels: ["low", "medium"],
  autoApproveTools: [],
  blockedTools: [],
  maxAutoStepsPerTask: 5,
  notifyOnCompletion: true,
  notifyOnError: true,
  voiceEnabled: false,
  preferredVoiceName: "Puck",
  voiceAutoActivate: false,
  orbAgentEnabled: null,
  workflowsEnabled: null,
  disabledPageAgents: [],
  disabledActionsByPage: {},
  orbWidgetCorner: "bottom-right",
  orbWelcomeMessage: null,
  orbShortcutEnabled: true,
  orbProactiveSuggestions: true,
  // Phase D defaults — chosen so a fresh row matches today's runtime
  // behaviour: no budget gating, perception ON (with the balanced tier
  // we already use), critic OFF (it adds latency + tokens; opt-in only),
  // role auto-switch ON, pacing AUTO, onboarding pending.
  costBudget: null,
  perceptionEnabled: true,
  perceptionStrictness: "balanced",
  criticEnabled: false,
  criticRefineBelow: 75,
  roleAutoSwitch: true,
  pacingOverride: "auto",
  onboardingCompletedAt: null,
};
