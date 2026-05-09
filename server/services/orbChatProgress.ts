/**
 * orbChatProgress — per-request in-memory progress event ring buffer.
 *
 * The orb chat handler buffers its entire response (~20 s on a multi-step
 * planner call) and the user sees nothing until the reply lands. To make
 * the wait legible we publish milestone events here from the route
 * handler and let the client poll them via `ai.chatProgress`.
 *
 * Design:
 *   - Keyed by `requestId` (the same `x-request-id` / `requestId` field the
 *     idempotency lock uses).
 *   - In-process Map only — events evaporate after `TTL_MS` so a long
 *     server uptime doesn't leak memory. The chat handler always cleans up
 *     in its `finally` block.
 *   - Each event has a monotonic `seq` so the client can pull "events
 *     since cursor X" without re-rendering the whole timeline on every
 *     poll.
 */

const TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;
const MAX_EVENTS_PER_REQUEST = 64;

export type OrbChatProgressStage =
  | "received"
  | "sanitizing"
  | "guarding_attachments"
  | "extracting_pdf"
  | "selecting_provider"
  | "researching_web"
  | "planning"
  | "calling_specialist"
  | "materializing_task"
  | "finalizing"
  | "error";

export interface OrbChatProgressEvent {
  seq: number;
  at: number;
  stage: OrbChatProgressStage;
  /** Short user-facing label, e.g. "規劃步驟中...", "召喚圖像精靈". */
  label: string;
  /** Optional structured details (provider id, specialist role, etc.). */
  detail?: Record<string, unknown>;
}

interface ProgressBucket {
  events: OrbChatProgressEvent[];
  expiresAt: number;
  nextSeq: number;
}

const buckets = new Map<string, ProgressBucket>();

function pruneExpired(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}

setInterval(() => pruneExpired(), CLEANUP_INTERVAL_MS).unref();

function getOrCreateBucket(requestId: string): ProgressBucket {
  const existing = buckets.get(requestId);
  const now = Date.now();
  if (existing && existing.expiresAt > now) return existing;
  const fresh: ProgressBucket = {
    events: [],
    expiresAt: now + TTL_MS,
    nextSeq: 1,
  };
  buckets.set(requestId, fresh);
  return fresh;
}

/**
 * Record a progress milestone for the given request. No-op when
 * `requestId` is falsy (the chat handler accepts requests without an
 * idempotency key — we just don't surface progress for those).
 */
export function emitOrbChatProgress(
  requestId: string | undefined | null,
  stage: OrbChatProgressStage,
  label: string,
  detail?: Record<string, unknown>
): void {
  if (!requestId) return;
  const bucket = getOrCreateBucket(requestId);
  if (bucket.events.length >= MAX_EVENTS_PER_REQUEST) {
    // Drop the oldest event so a runaway loop can't blow the per-request cap.
    bucket.events.shift();
  }
  bucket.events.push({
    seq: bucket.nextSeq++,
    at: Date.now(),
    stage,
    label,
    detail,
  });
  bucket.expiresAt = Date.now() + TTL_MS;
}

/** Read events with `seq > sinceSeq`. Returns an empty array if unknown. */
export function readOrbChatProgress(
  requestId: string,
  sinceSeq = 0
): OrbChatProgressEvent[] {
  pruneExpired();
  const bucket = buckets.get(requestId);
  if (!bucket) return [];
  if (sinceSeq <= 0) return [...bucket.events];
  return bucket.events.filter(event => event.seq > sinceSeq);
}

/**
 * Drop the bucket once the request is fully complete. The chat handler
 * calls this in its `finally`; clients should have already pulled the
 * final event before this fires.
 */
export function clearOrbChatProgress(requestId: string | undefined | null): void {
  if (!requestId) return;
  buckets.delete(requestId);
}

export function __unsafe_resetOrbChatProgressForTests(): void {
  buckets.clear();
}
