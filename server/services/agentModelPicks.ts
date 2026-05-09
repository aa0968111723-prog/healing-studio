/**
 * server/services/agentModelPicks.ts
 *
 * Shared persistence layer for "the user picked model X for modality Y".
 * Both 導演 AI 規劃流程 and 全站光球代理 read/write the same `agent_model_picks`
 * table so picks made anywhere on the site contribute to ONE preference
 * signal — answering the brief「跟全站光球代理共用資料庫，一起持續學習」.
 *
 * Best-effort: every helper logs and returns a safe default when the DB is
 * unavailable. Callers should NOT await `recordPick` (use `void`) so a
 * slow DB never blocks the user-facing dispatch.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  agentModelPicks,
  type AgentModelPick,
  type InsertAgentModelPick,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";

export const PICK_SOURCES = [
  "director_ai",
  "global_orb",
  "image_studio",
  "video_studio",
  "pro_studio",
  "studio",
  "history",
  "shared_space",
  "other",
] as const;

export type AgentModelPickSource = (typeof PICK_SOURCES)[number];

export interface RecordPickInput {
  userId: number;
  modality: string;
  modelId: string;
  source: AgentModelPickSource;
  /** True if the pick was acted on successfully (e.g. studio accepted the job). */
  accepted?: boolean;
  context?: Record<string, unknown>;
}

function normalizeModality(modality: string): string {
  // Some surfaces use camelCase ("imageGeneration") or aliases — clamp to the
  // canonical short form so the read-side groupBy actually groups.
  const m = modality.trim().toLowerCase();
  if (m.startsWith("image")) return "image";
  if (m.startsWith("video")) return "video";
  if (m === "music" || m.startsWith("audio")) return "audio";
  if (m.startsWith("voice") || m === "tts") return "voice";
  if (m === "sfx" || m.startsWith("sound")) return "sfx";
  if (m === "text" || m === "script" || m === "story") return "text";
  return m || "other";
}

/**
 * Record a single (modality, modelId) pick. Skipped silently when:
 *   - userId is missing / 0 (anonymous)
 *   - modelId is empty
 *   - DB is unavailable
 *
 * Returns the inserted row's id, or null on any skip / failure.
 */
export async function recordModelPick(
  input: RecordPickInput
): Promise<number | null> {
  if (!input.userId || input.userId <= 0) return null;
  if (!input.modelId || !input.modelId.trim()) return null;

  try {
    const db = await getDb();
    if (!db) return null;

    const row: InsertAgentModelPick = {
      userId: input.userId,
      modality: normalizeModality(input.modality),
      modelId: input.modelId.trim().slice(0, 128),
      source: input.source,
      accepted: input.accepted ?? null,
      context: input.context ?? null,
    };
    const result = await db.insert(agentModelPicks).values(row);
    return (result as unknown as { insertId?: number }).insertId ?? 1;
  } catch (err) {
    logger.warn("agent_model_pick_persist_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId: input.userId,
      modality: input.modality,
      modelId: input.modelId,
      source: input.source,
    });
    return null;
  }
}

export interface PreferredModelForModalityInput {
  userId: number;
  modality: string;
  /** Look-back window in days; default 30. */
  windowDays?: number;
  /** How many top candidates to return; default 1 (the leader). */
  topK?: number;
}

export interface PreferredModelEntry {
  modelId: string;
  pickCount: number;
  acceptedCount: number;
  /** ms-since-epoch of the most recent pick. */
  lastPickedAt: number;
}

/**
 * Return the user's most-picked models for a modality, ranked by
 * (acceptedCount desc, pickCount desc, recency desc). Used by Director AI's
 * model-defaults loader and by sendToStudio dispatchers that want to fill
 * `overrideEngine` automatically.
 *
 * Returns an empty array on DB failure — callers should fall back to their
 * own brain default.
 */
export async function getPreferredModelsForModality(
  input: PreferredModelForModalityInput
): Promise<PreferredModelEntry[]> {
  if (!input.userId || input.userId <= 0) return [];
  const modality = normalizeModality(input.modality);
  const topK = Math.max(1, Math.min(input.topK ?? 1, 10));
  const windowDays = Math.max(1, Math.min(input.windowDays ?? 30, 365));

  try {
    const db = await getDb();
    if (!db) return [];

    const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs);

    const rows = (await db
      .select({
        modelId: agentModelPicks.modelId,
        pickCount: sql<number>`count(*)`.as("pickCount"),
        acceptedCount: sql<number>`sum(case when ${agentModelPicks.accepted} = true then 1 else 0 end)`.as(
          "acceptedCount"
        ),
        lastPickedAt: sql<Date>`max(${agentModelPicks.createdAt})`.as(
          "lastPickedAt"
        ),
      })
      .from(agentModelPicks)
      .where(
        and(
          eq(agentModelPicks.userId, input.userId),
          eq(agentModelPicks.modality, modality),
          sql`${agentModelPicks.createdAt} >= ${cutoff}`
        )
      )
      .groupBy(agentModelPicks.modelId)
      .orderBy(
        desc(sql`acceptedCount`),
        desc(sql`pickCount`),
        desc(sql`lastPickedAt`)
      )
      .limit(topK)) as Array<{
      modelId: string;
      pickCount: number | string;
      acceptedCount: number | string | null;
      lastPickedAt: Date | string;
    }>;

    return rows.map(r => ({
      modelId: r.modelId,
      pickCount: Number(r.pickCount) || 0,
      acceptedCount: Number(r.acceptedCount ?? 0) || 0,
      lastPickedAt:
        r.lastPickedAt instanceof Date
          ? r.lastPickedAt.getTime()
          : new Date(r.lastPickedAt).getTime(),
    }));
  } catch (err) {
    logger.warn("agent_model_pick_read_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId: input.userId,
      modality: input.modality,
    });
    return [];
  }
}

/** Convenience: just the top model id, or null if nothing learned yet. */
export async function getTopPreferredModel(
  userId: number,
  modality: string
): Promise<string | null> {
  const entries = await getPreferredModelsForModality({
    userId,
    modality,
    topK: 1,
  });
  return entries[0]?.modelId ?? null;
}

/**
 * Recent raw picks across modalities — used by the orb's preference distiller
 * so the global agent's recommendations include director-driven picks too.
 */
export async function getRecentPicks(
  userId: number,
  limit = 30
): Promise<AgentModelPick[]> {
  if (!userId || userId <= 0) return [];
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(agentModelPicks)
      .where(eq(agentModelPicks.userId, userId))
      .orderBy(desc(agentModelPicks.createdAt))
      .limit(Math.max(1, Math.min(limit, 200)));
    return rows;
  } catch (err) {
    logger.warn("agent_model_pick_recent_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId,
    });
    return [];
  }
}

/**
 * Mark the most recent pick `(userId, modality, modelId)` as
 * accepted=true|false. Called by the studio after a generation succeeds /
 * fails so the next `getPreferredModelsForModality` query weights the
 * `acceptedCount` column. Only updates ONE row (the latest matching pick)
 * to avoid retroactively flipping older entries.
 */
export async function updateLatestPickAcceptance(args: {
  userId: number;
  modality: string;
  modelId: string;
  accepted: boolean;
}): Promise<boolean> {
  if (!args.userId || !args.modelId.trim()) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const modality = normalizeModality(args.modality);
    const recent = await db
      .select({ id: agentModelPicks.id })
      .from(agentModelPicks)
      .where(
        and(
          eq(agentModelPicks.userId, args.userId),
          eq(agentModelPicks.modality, modality),
          eq(agentModelPicks.modelId, args.modelId.trim())
        )
      )
      .orderBy(desc(agentModelPicks.createdAt))
      .limit(1);
    const target = recent[0];
    if (!target) return false;
    await db
      .update(agentModelPicks)
      .set({ accepted: args.accepted })
      .where(eq(agentModelPicks.id, target.id));
    return true;
  } catch (err) {
    logger.warn("agent_model_pick_acceptance_update_failed", {
      err: err instanceof Error ? err.message : String(err),
      userId: args.userId,
      modality: args.modality,
      modelId: args.modelId,
    });
    return false;
  }
}
