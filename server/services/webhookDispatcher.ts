/**
 * webhookDispatcher.ts — AIDV-269
 *
 * Dispatches creator-facing webhook events (video.completed, video.failed) to
 * registered subscriber URLs. Each delivery is:
 *  - HMAC-SHA256 signed (X-AIDV-Signature header)
 *  - SSRF-guarded (assertSafeExternalUrl blocks private/loopback targets)
 *  - Retried with exponential backoff (up to MAX_RETRIES attempts)
 *  - Recorded in webhook_delivery_history for the last 50 entries shown in UI
 */

import crypto from "crypto";
import { assertSafeExternalUrl, SsrfBlockedError } from "../_core/ssrfGuard";
import { getDb } from "../db";
import { webhookSubscriptions, webhookDeliveryHistory } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

const MAX_RETRIES = 3;
const DELIVERY_TIMEOUT_MS = 10_000;

function buildSignature(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function recordDelivery(
  subscriptionId: number,
  event: string,
  payload: Record<string, unknown>,
  statusCode: number | null,
  attempt: number,
  succeeded: boolean,
  errorMessage: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(webhookDeliveryHistory).values({
      subscriptionId,
      event,
      payload,
      statusCode,
      attempt,
      succeeded,
      errorMessage: errorMessage ? errorMessage.slice(0, 512) : null,
    });
  } catch {
    // Best-effort; never throw from audit logging
  }
}

async function deliverWithRetry(
  subscriptionId: number,
  url: string,
  secret: string,
  event: string,
  eventPayload: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  sleepFn: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))
): Promise<void> {
  const body = JSON.stringify({
    event,
    ...eventPayload,
    timestamp: new Date().toISOString(),
  });
  const signature = buildSignature(secret, body);

  let lastStatus: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      await sleepFn(Math.pow(2, attempt - 1) * 1000);
    }
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AIDV-Signature": signature,
          "X-AIDV-Event": event,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        redirect: "error",
      });
      lastStatus = res.status;
      if (res.ok) {
        await recordDelivery(subscriptionId, event, eventPayload, lastStatus, attempt, true, null);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  await recordDelivery(subscriptionId, event, eventPayload, lastStatus, MAX_RETRIES, false, lastError);
}

/**
 * Dispatch a creator-facing webhook event to all active subscriptions for a user.
 * Fire-and-forget: errors are swallowed and recorded in delivery history.
 * SSRF-blocked URLs are silently skipped.
 */
export async function dispatchWebhookEvent(
  userId: number,
  event: string,
  payload: Record<string, unknown>,
  fetchFn?: typeof fetch,
  sleepFn?: (ms: number) => Promise<void>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  let subscriptions: Array<{ id: number; url: string; secret: string; events: string[] }>;
  try {
    subscriptions = (await db
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        secret: webhookSubscriptions.secret,
        events: webhookSubscriptions.events,
      })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.userId, userId),
          eq(webhookSubscriptions.active, true)
        )
      )) as Array<{ id: number; url: string; secret: string; events: string[] }>;
  } catch {
    return;
  }

  for (const sub of subscriptions) {
    if (!Array.isArray(sub.events) || !sub.events.includes(event)) continue;

    try {
      assertSafeExternalUrl(sub.url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) continue;
      continue;
    }

    void deliverWithRetry(sub.id, sub.url, sub.secret, event, payload, fetchFn, sleepFn);
  }
}
