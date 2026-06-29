/**
 * modelEnrichmentRedis.ts — Redis persistence helpers for model enrichment data
 *
 * Implements write-through + warm-up pattern:
 *   - On server start, load all persisted enrichments from Redis into the in-memory Map
 *   - On each enrichment write, also persist to Redis (fire-and-forget, fail-open)
 *   - On store clear (admin reset / test), also clear Redis keys
 *
 * All functions are fail-open: when Redis is unavailable (REDIS_URL unset or
 * connection lost), they return empty results or silently swallow errors — the
 * in-memory Map stays authoritative and the server continues to function normally.
 */

import { getRedisClient } from "../_core/redisClient";
import { logger } from "../_core/logger";

const KEY_PREFIX = "model_enrichment:";

function enrichmentKey(modelId: string): string {
  return `${KEY_PREFIX}${modelId}`;
}

/**
 * Persist a single enrichment record to Redis.
 * No TTL — enrichments are refreshed by the research cron; we want them to
 * survive across redeploys until the next cron run overwrites them.
 */
export async function saveEnrichmentToRedis(record: { modelId: string }): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(enrichmentKey(record.modelId), JSON.stringify(record));
  } catch {
    // fail open — in-memory Map is still up to date
  }
}

/**
 * Load all persisted enrichment records from Redis.
 * Used once on module init to warm up the in-memory Map.
 * Returns an empty array when Redis is unavailable or holds no enrichment keys.
 */
export async function loadAllEnrichmentsFromRedis<T extends { modelId: string }>(): Promise<T[]> {
  const redis = getRedisClient();
  if (!redis) return [];
  try {
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    const results: T[] = [];
    for (const v of values) {
      if (!v) continue;
      try {
        results.push(JSON.parse(v) as T);
      } catch {
        // skip malformed entries
      }
    }
    return results;
  } catch (err) {
    logger.warn("[modelEnrichmentRedis] failed to load from Redis", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Delete all enrichment keys from Redis.
 * Called when the in-memory store is cleared (admin reset / test cleanup).
 */
export async function clearAllEnrichmentsFromRedis(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // fail open
  }
}
