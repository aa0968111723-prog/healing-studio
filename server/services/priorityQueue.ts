/**
 * priorityQueue.ts — AIDV-331 Priority Queue
 *
 * Redis Sorted Set–backed priority queue for orchestration runs.
 * Fail-open: when Redis is unavailable, operations are no-ops and
 * callers should fall back to DB-order (createdAt ASC) processing.
 *
 * Score = Date.now() + priority_offset so ZPOPMIN yields the highest
 * priority item first:
 *   urgent    → offset -86_400_000 (1 day earlier score → pops first)
 *   normal    → offset 0
 *   background → offset +86_400_000 (1 day later score → pops last)
 */

import { getRedisClient } from "../_core/redisClient";
import { logger } from "../_core/logger";

const QUEUE_KEY = "orchestration:priority_queue";

const PRIORITY_OFFSET: Record<string, number> = {
  urgent: -86_400_000,
  normal: 0,
  background: 86_400_000,
};

export async function enqueuePriorityJob(
  jobId: string,
  priority: "urgent" | "normal" | "background"
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const score = Date.now() + (PRIORITY_OFFSET[priority] ?? 0);
  try {
    await redis.zadd(QUEUE_KEY, score, jobId);
  } catch (err) {
    logger.warn("priority_queue_enqueue_failed", { jobId, priority, err });
  }
}

export async function dequeuePriorityJob(): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const result = await redis.zpopmin(QUEUE_KEY, 1);
    return result.length > 0 ? (result[0] as string) : null;
  } catch (err) {
    logger.warn("priority_queue_dequeue_failed", { err });
    return null;
  }
}

export async function getPriorityQueueDepth(): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return -1;
  try {
    return await redis.zcard(QUEUE_KEY);
  } catch {
    return -1;
  }
}
