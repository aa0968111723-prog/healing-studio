export type AgentConfirmationPolicy =
  | "always_approve"
  | "confirm_high_risk"
  | "confirm_all"
  | "manual";

export interface AgentPreferences {
  userId: number;
  confirmationPolicy: AgentConfirmationPolicy;
  allowedRiskLevels: string[];
  autoApproveTools: string[];
  blockedTools: string[];
  maxAutoStepsPerTask: number;
  notifyOnCompletion: boolean;
  notifyOnError: boolean;
  voiceEnabled?: boolean;
  preferredVoiceName?: "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede";
  voiceAutoActivate?: boolean;
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
};
