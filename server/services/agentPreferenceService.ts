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
      // Phase D fields. Each guarded against missing columns / nulls so
      // the loader keeps booting on an unmigrated DB during deploy.
      costBudget:
        row.costBudget && typeof row.costBudget === "object"
          ? row.costBudget
          : DEFAULT_AGENT_PREFERENCES.costBudget,
      perceptionEnabled:
        typeof row.perceptionEnabled === "boolean"
          ? row.perceptionEnabled
          : DEFAULT_AGENT_PREFERENCES.perceptionEnabled,
      perceptionStrictness:
        row.perceptionStrictness ?? DEFAULT_AGENT_PREFERENCES.perceptionStrictness,
      criticEnabled:
        typeof row.criticEnabled === "boolean"
          ? row.criticEnabled
          : DEFAULT_AGENT_PREFERENCES.criticEnabled,
      criticRefineBelow:
        typeof row.criticRefineBelow === "number"
          ? row.criticRefineBelow
          : DEFAULT_AGENT_PREFERENCES.criticRefineBelow,
      roleAutoSwitch:
        typeof row.roleAutoSwitch === "boolean"
          ? row.roleAutoSwitch
          : DEFAULT_AGENT_PREFERENCES.roleAutoSwitch,
      pacingOverride:
        row.pacingOverride ?? DEFAULT_AGENT_PREFERENCES.pacingOverride,
      onboardingCompletedAt: row.onboardingCompletedAt ?? null,
      // 15 精靈關係偏好。同樣 array-guard，沒欄位 / null 時 fall 到空陣列，
      // selectRoleForIntent 收到 [] 等於不靜音任何人，行為跟舊版一致。
      mutedSpirits: Array.isArray((row as { mutedSpirits?: unknown }).mutedSpirits)
        ? ((row as { mutedSpirits?: string[] }).mutedSpirits ?? [])
        : [],
      favoriteSpirits: Array.isArray((row as { favoriteSpirits?: unknown }).favoriteSpirits)
        ? ((row as { favoriteSpirits?: string[] }).favoriteSpirits ?? [])
        : [],
      // Phase 3: stay-on-page execution mode. Not all DB rows have this
      // column yet (the runtime migration in agentPreferencesRouter
      // adds it on first request); coerce missing / null to the
      // default so existing rows behave identically to today.
      stayOnPageMode:
        typeof (row as { stayOnPageMode?: unknown }).stayOnPageMode === "boolean"
          ? Boolean((row as { stayOnPageMode?: boolean }).stayOnPageMode)
          : DEFAULT_AGENT_PREFERENCES.stayOnPageMode,
      // 主動精靈通知設定 — JSON 欄位，預設空 map（每個事件 fallback 到
      // DEFAULT_PROACTIVE_TRIGGER_SETTINGS）。沒欄位 / 解析失敗時也回 {}，
      // 確保 selectRoleForIntent 等下游永遠拿得到型別正確的 map。
      proactiveTriggerSettings: (() => {
        const raw = (row as { proactiveTriggerSettings?: unknown }).proactiveTriggerSettings;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          return raw as AgentPreferences["proactiveTriggerSettings"];
        }
        return DEFAULT_AGENT_PREFERENCES.proactiveTriggerSettings;
      })(),
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
