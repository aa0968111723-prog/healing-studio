/**
 * agentPreferenceService — server-side loader for AgentPreferences.
 * ────────────────────────────────────────────────────────────────────────────
 * The orchestrator (`executeCurrentStepTools`) honours `agentPreferences` when
 * it is passed in, but historically every chat-driven runtime call site
 * forgot to pass it — so the `/agent` settings panel was effectively
 * cosmetic. This module gives the runtime a single, defensive loader so
 * user settings actually take effect during real task execution.
 *
 * Defensive: if the DB is unreachable or the row is missing we return
 * `DEFAULT_AGENT_PREFERENCES` shaped for the userId, never throw.
 */

import { eq } from "drizzle-orm";
import { agentPreferences as agentPreferencesTable } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentPreferences,
} from "../../shared/agent-preferences";

export async function loadAgentPreferencesForUser(
  userId: number
): Promise<AgentPreferences> {
  const fallback: AgentPreferences = { userId, ...DEFAULT_AGENT_PREFERENCES };
  if (!Number.isFinite(userId) || userId <= 0) return fallback;

  try {
    const db = await getDb();
    if (!db) return fallback;
    const rows = await db
      .select()
      .from(agentPreferencesTable)
      .where(eq(agentPreferencesTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return fallback;

    return {
      userId: row.userId,
      confirmationPolicy: row.confirmationPolicy,
      allowedRiskLevels: Array.isArray(row.allowedRiskLevels)
        ? row.allowedRiskLevels
        : DEFAULT_AGENT_PREFERENCES.allowedRiskLevels,
      autoApproveTools: Array.isArray(row.autoApproveTools)
        ? row.autoApproveTools
        : DEFAULT_AGENT_PREFERENCES.autoApproveTools,
      blockedTools: Array.isArray(row.blockedTools)
        ? row.blockedTools
        : DEFAULT_AGENT_PREFERENCES.blockedTools,
      maxAutoStepsPerTask: row.maxAutoStepsPerTask,
      notifyOnCompletion: row.notifyOnCompletion,
      notifyOnError: row.notifyOnError,
      voiceEnabled: row.voiceEnabled,
      preferredVoiceName: row.preferredVoiceName,
      voiceAutoActivate: row.voiceAutoActivate,
      orbAgentEnabled: row.orbAgentEnabled,
      workflowsEnabled: row.workflowsEnabled,
      disabledPageAgents: Array.isArray(row.disabledPageAgents)
        ? row.disabledPageAgents
        : [],
      disabledActionsByPage:
        row.disabledActionsByPage && typeof row.disabledActionsByPage === "object"
          ? (row.disabledActionsByPage as Record<string, string[]>)
          : {},
      orbWidgetCorner: row.orbWidgetCorner,
      orbWelcomeMessage: row.orbWelcomeMessage,
      orbShortcutEnabled: row.orbShortcutEnabled,
      orbProactiveSuggestions: row.orbProactiveSuggestions,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };
  } catch (error) {
    console.warn(
      "[agentPreferenceService] Failed to load preferences, using defaults:",
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}
