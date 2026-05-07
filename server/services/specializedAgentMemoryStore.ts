/**
 * server/services/specializedAgentMemoryStore.ts
 *
 * Read/write helpers for the `specialized_agent_interactions` and
 * `specialized_agent_memory` tables. These tables existed in schema since
 * migration 0025 but had **zero production writers** — the dead audit
 * caught it. This module is the activation layer:
 *
 *   - `recordSpecialistInteraction(...)` is called from the orb's
 *     `onAuditEvent` hook in routers.ts every time a specialist-owned
 *     tool runs, so the table actually fills with data.
 *
 *   - `getRecentSpecialistTools(userId, limit)` returns the tool names
 *     this user has recently invoked, used as `recentTools` input for
 *     `selectSkillForIntent` (the skill router uses it as a tiebreaker).
 *
 *   - `getSpecialistMemoryHints(userId)` returns short summaries of the
 *     user's specialist preferences, formatted for system-prompt
 *     injection (e.g., "你最近常用 image-specialist：14 次成功 / 1 次失敗").
 *
 * All read/write is best-effort — if the DB is unavailable the helpers
 * return empty results / null and log; they never throw, so a broken
 * database can't take down the orb chat router.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  specializedAgentInteractions,
  type InsertSpecializedAgentInteraction,
} from "../../drizzle/schema";
import { findSkillForTool } from "../../shared/agent-skills";
import { isSpecializedAgent } from "../../shared/orb-specialized-agents";
import { logger } from "../_core/logger";

export type SpecialistInteractionType =
  | "activated"
  | "tool_used"
  | "suggestion_accepted"
  | "suggestion_rejected"
  | "error";

export interface RecordSpecialistInteractionInput {
  userId: number;
  /** AgentRole id; only persisted when it's a known specialist. */
  agentId: string;
  interactionType: SpecialistInteractionType;
  toolName?: string;
  sessionId?: string;
  contextData?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Record a single specialist interaction. Skipped (returns null) when:
 *   - agentId isn't a known specialist (e.g. director, composer — those
 *     are generic skills, not specialists; we don't pollute the
 *     specialist-specific table with them).
 *   - DB is unavailable.
 *
 * Best-effort by design: callers shouldn't await this (use `void`) so a
 * slow/failing DB doesn't block the user-facing response.
 */
export async function recordSpecialistInteraction(
  input: RecordSpecialistInteractionInput
): Promise<number | null> {
  if (!isSpecializedAgent(input.agentId)) return null;

  try {
    const db = await getDb();
    if (!db) return null;
    const row: InsertSpecializedAgentInteraction = {
      userId: input.userId,
      agentId: input.agentId,
      sessionId: input.sessionId ?? null,
      interactionType: input.interactionType,
      toolName: input.toolName ?? null,
      contextData: input.contextData ?? null,
      userSatisfaction: null,
      durationMs: input.durationMs ?? null,
    };
    const result = await db.insert(specializedAgentInteractions).values(row);
    // MySQL returns ResultSetHeader-like; the insertId is implementation-
    // specific and not always exposed cleanly via Drizzle. Returning a
    // truthy marker is enough — the caller only needs to know success.
    return (result as unknown as { insertId?: number }).insertId ?? 1;
  } catch (err) {
    logger.warn("specialist_interaction_persist_failed", {
      err: err instanceof Error ? err.message : String(err),
      agentId: input.agentId,
      toolName: input.toolName,
    });
    return null;
  }
}

/**
 * Convenience wrapper — given a tool audit event from the orb's
 * `onAuditEvent` callback, look up which specialist owns the tool and
 * persist if there is one. Caller doesn't have to know about the
 * specialist mapping — this module owns it.
 */
export function recordToolAuditAsSpecialistInteraction(event: {
  userId: number;
  toolName: string;
  ok: boolean;
  startedAt: number;
  endedAt: number;
  taskId?: string;
  error?: string;
}): void {
  const skill = findSkillForTool(event.toolName);
  if (!skill || !isSpecializedAgent(skill.id)) return;
  void recordSpecialistInteraction({
    userId: event.userId,
    agentId: skill.id,
    interactionType: event.ok ? "tool_used" : "error",
    toolName: event.toolName,
    sessionId: event.taskId,
    contextData: event.error ? { error: event.error } : undefined,
    durationMs: Math.max(0, event.endedAt - event.startedAt),
  });
}

/**
 * Return the most recent N tool names this user has invoked across all
 * specialists. Used by `selectSkillForIntent` as a tiebreaker.
 */
export async function getRecentSpecialistTools(
  userId: number,
  limit = 5
): Promise<string[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        toolName: specializedAgentInteractions.toolName,
      })
      .from(specializedAgentInteractions)
      .where(
        and(
          eq(specializedAgentInteractions.userId, userId),
          eq(specializedAgentInteractions.interactionType, "tool_used")
        )
      )
      .orderBy(desc(specializedAgentInteractions.createdAt))
      .limit(Math.max(1, Math.min(limit, 50)));
    return rows
      .map(r => r.toolName)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  } catch (err) {
    logger.warn("specialist_recent_tools_read_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId,
    });
    return [];
  }
}

/**
 * Aggregate the user's recent specialist activity into a tiny prompt
 * hint block. Looks at the last 30 days; returns "" when there's
 * nothing meaningful to say (so the prompt template can drop the line
 * without an empty section).
 */
export async function getSpecialistMemoryHints(
  userId: number,
  limit = 60
): Promise<string> {
  try {
    const db = await getDb();
    if (!db) return "";
    const rows = await db
      .select({
        agentId: specializedAgentInteractions.agentId,
        interactionType: specializedAgentInteractions.interactionType,
        count: sql<number>`count(*)`.as("cnt"),
      })
      .from(specializedAgentInteractions)
      .where(eq(specializedAgentInteractions.userId, userId))
      .groupBy(
        specializedAgentInteractions.agentId,
        specializedAgentInteractions.interactionType
      )
      .limit(limit);

    if (rows.length === 0) return "";

    type AgentStats = { used: number; errors: number };
    const byAgent = new Map<string, AgentStats>();
    for (const row of rows) {
      const stats = byAgent.get(row.agentId) ?? { used: 0, errors: 0 };
      if (row.interactionType === "tool_used") stats.used += Number(row.count) || 0;
      else if (row.interactionType === "error") stats.errors += Number(row.count) || 0;
      byAgent.set(row.agentId, stats);
    }

    const sorted = [...byAgent.entries()]
      .map(([agentId, stats]) => ({ agentId, ...stats }))
      .filter(entry => entry.used + entry.errors > 0)
      .sort((a, b) => b.used + b.errors - (a.used + a.errors))
      .slice(0, 3);
    if (sorted.length === 0) return "";

    const lines = sorted.map(
      entry => `- ${entry.agentId}：${entry.used} 次成功使用` +
        (entry.errors > 0 ? `、${entry.errors} 次失敗（避免重蹈覆轍）` : "")
    );
    return ["【使用者專精助手習慣（近期）】", ...lines].join("\n");
  } catch (err) {
    logger.warn("specialist_memory_hints_read_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId,
    });
    return "";
  }
}
