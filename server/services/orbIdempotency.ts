import { hashIntentSignature } from "./providerRouter";

interface IdempotentRecord {
  key: string;
  taskId?: string;
  planId?: string;
  traceId?: string;
  createdAt: number;
}

interface RequestIdStoreRecord {
  status: "in-progress" | "completed";
  result?: unknown;
  expiresAt: number;
}

const store = new Map<string, IdempotentRecord>();
const requestIdStore = new Map<string, RequestIdStoreRecord>();

const LEGACY_TTL_MS = 90_000;
const REQUEST_ID_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

function prune() {
  const now = Date.now();
  for (const [k, v] of Array.from(store.entries())) {
    if (now - v.createdAt > LEGACY_TTL_MS) store.delete(k);
  }
}

/**
 * Removes expired requestId idempotency entries.
 */
export function cleanExpired(): void {
  const now = Date.now();
  requestIdStore.forEach((entry, requestId) => {
    if (entry.expiresAt <= now) {
      requestIdStore.delete(requestId);
    }
  });
}

setInterval(cleanExpired, CLEANUP_INTERVAL_MS).unref();

/**
 * Checks the requestId status and locks it when first seen.
 * Returns "new" when lock succeeds, "in-progress" while processing,
 * and "duplicate" after a completed request is found within TTL.
 */
export function checkAndLock(requestId: string): "new" | "duplicate" | "in-progress" {
  cleanExpired();

  const existing = requestIdStore.get(requestId);
  if (!existing) {
    requestIdStore.set(requestId, {
      status: "in-progress",
      expiresAt: Date.now() + REQUEST_ID_TTL_MS,
    });
    return "new";
  }

  return existing.status === "completed" ? "duplicate" : "in-progress";
}

/**
 * Stores the computed result for a completed requestId.
 */
export function storeResult(requestId: string, result: unknown): void {
  cleanExpired();
  requestIdStore.set(requestId, {
    status: "completed",
    result,
    expiresAt: Date.now() + REQUEST_ID_TTL_MS,
  });
}

/**
 * Drops the in-progress lock so a follow-up request with the same id can
 * run normally. Used by the orb chat handler's `finally` block when an
 * early-return path (attachment too large, quota limited, provider
 * unavailable, etc.) skipped `storeResult`. Without this release, retries
 * with the same `x-request-id` would get stuck on `{status: "in-progress"}`
 * for the full 60 s TTL even though no real work is happening server-side.
 */
export function releaseRequestLock(requestId: string): void {
  const existing = requestIdStore.get(requestId);
  if (existing && existing.status === "in-progress") {
    requestIdStore.delete(requestId);
  }
}

/**
 * Returns a cached result for a completed requestId, if present.
 */
export function getResult(requestId: string): unknown | undefined {
  cleanExpired();
  const entry = requestIdStore.get(requestId);
  if (!entry || entry.status !== "completed") return undefined;
  return entry.result;
}

export function buildOrbIdempotencyKey(input: {
  userId?: number;
  sessionId?: string;
  text: string;
  attachmentUrls?: string[];
}): string {
  return hashIntentSignature(input);
}

export function findDuplicateTask(key: string): IdempotentRecord | null {
  prune();
  return store.get(key) ?? null;
}

export function rememberTaskKey(
  key: string,
  value: Omit<IdempotentRecord, "key" | "createdAt">
) {
  prune();
  const record: IdempotentRecord = {
    key,
    createdAt: Date.now(),
    ...value,
  };
  store.set(key, record);
  return record;
}

export function __unsafe_resetOrbIdempotencyForTests() {
  store.clear();
  requestIdStore.clear();
}
