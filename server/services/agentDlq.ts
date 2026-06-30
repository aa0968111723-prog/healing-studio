/**
 * agentDlq.ts — AIDV-346 驗證門失敗 DLQ 持久化
 *
 * Persists ValidationState to agent_dlq after routeValidationFailure().
 * Callers pass the full ValidationState; this service owns the DB writes.
 */

import { and, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { agentDlq } from "../../drizzle/schema";
import { getDb } from "../db";
import type { ValidationState } from "../_core/validationGateRouter";

export interface DlqInsertResult {
  id: number;
  action: "retry" | "decision" | "escalate";
  correlationId: string;
}

/**
 * Persist a validation gate failure to the DLQ table.
 * Returns the new row id and the routing action so callers can log/notify.
 * Returns null if the DB is unavailable.
 *
 * AIDV-926: correlationId 若未傳入則自動產生（randomUUID），讓呼叫端把它
 * 印進自己的 log，跟這筆 DLQ row 串起來追蹤。
 */
export async function insertDlqEntry(
  state: ValidationState,
  failureReason?: string,
  agentId?: string,
  payload?: Record<string, unknown>,
  correlationId?: string
): Promise<DlqInsertResult | null> {
  const db = await getDb();
  if (!db) return null;

  const resolvedCorrelationId = correlationId ?? randomUUID();

  const [result] = await db
    .insert(agentDlq)
    .values({
      issueKey: state.issueKey,
      agentId: agentId ?? null,
      userId: state.userId,
      failureType: state.failureType,
      routingAction: state.action,
      failureReason: failureReason ?? null,
      payload: payload ?? null,
      retryCount: state.retryCount,
      correlationId: resolvedCorrelationId,
    })
    .$returningId();

  return { id: result.id as number, action: state.action, correlationId: resolvedCorrelationId };
}

/**
 * Mark a DLQ entry as resolved (human review complete or automatic resolution).
 */
export async function resolveDlqEntry(
  dlqId: number,
  resolvedBy: string,
  resolutionNote?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(agentDlq)
    .set({
      resolvedAt: new Date(),
      resolvedBy,
      resolutionNote: resolutionNote ?? null,
    })
    .where(eq(agentDlq.id, dlqId));
}

export interface PollDlqResult {
  retried: number;
  escalated: number;
  decisions: number;
}

/**
 * Return counts of unresolved DLQ entries by routing action.
 * Intended for monitoring/alerting; does NOT mutate state.
 */
export async function pollDlq(): Promise<PollDlqResult> {
  const db = await getDb();
  if (!db) return { retried: 0, escalated: 0, decisions: 0 };

  const rows = await db
    .select({ routingAction: agentDlq.routingAction })
    .from(agentDlq)
    .where(and(isNull(agentDlq.resolvedAt)));

  let retried = 0;
  let escalated = 0;
  let decisions = 0;

  for (const { routingAction } of rows) {
    if (routingAction === "retry") retried++;
    else if (routingAction === "escalate") escalated++;
    else decisions++;
  }

  return { retried, escalated, decisions };
}
