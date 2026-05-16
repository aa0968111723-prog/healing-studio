/**
 * server/services/orbUserMemory.ts
 *
 * MEMORY TIER: B — Session / conversation memory (per-user summary string).
 * 寫到 `users.orbMemorySummary` 欄位的一句話摘要,LLM 啟動上下文用。
 * 詳見 `server/services/memory/MEMORY_TIERS.md`。
 */

import { eq } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";

export async function getOrbMemorySummary(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: users.id, orbMemorySummary: users.orbMemorySummary })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.orbMemorySummary ?? null;
}

export async function upsertOrbMemory(userId: number, summary: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const trimmed = summary.trim();
  if (!trimmed) return;

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]?.id) return;

  await db
    .update(users)
    .set({ orbMemorySummary: trimmed })
    .where(eq(users.id, userId));
}
