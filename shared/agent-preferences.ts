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
};
