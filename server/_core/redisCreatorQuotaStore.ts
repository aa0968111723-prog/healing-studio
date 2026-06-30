/**
 * redisCreatorQuotaStore.ts — Redis-backed CreatorQuotaStore (AIDV-923)
 *
 * Implements the `CreatorQuotaStore` seam from agentCreatorQuota.ts over the
 * shared ioredis client. This is what makes per-creator concurrency quota
 * **cross-instance**: with REDIS_URL set, two task starts for the same user
 * landing on different Railway replicas contend on the same Redis key, so the
 * `maxConcurrent` ceiling is enforced across the whole fleet instead of once
 * per process.
 *
 * Key: `<prefix>creator-quota:<userId>` holding the active slot count (an
 * integer). Every successful acquire refreshes the key's TTL to `ttlMs` so a
 * crashed holder that never calls release() can't wedge the user's quota
 * forever — the slot count self-expires (see agentCreatorQuota.ts SLOT_TTL_MS
 * doc for why this favours availability over strict accounting).
 *
 * Fail-open is enforced by the layer above (CreatorQuotaService): every store
 * op is wrapped in a short timeout + try/catch and treated as "allow" on
 * failure. This store therefore just lets errors propagate.
 */

import type { CreatorQuotaStore } from "./agentCreatorQuota";
import { creatorQuota } from "./agentCreatorQuota";
import { getRedisClient, closeRedis, type RedisClient } from "./redisClient";
import { logger } from "./logger";
import { serverEnv } from "./env.validated";

/**
 * Atomic "increment iff below max" + refresh-TTL Lua script.
 * Returns the new count on success, or -1 if the creator is already at/over
 * `max` (acquire rejected — caller maps -1 → null).
 */
const ACQUIRE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local max = tonumber(ARGV[1])
if current >= max then
  return -1
end
local next = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return next
`;

/**
 * Atomic "decrement floored at 0" Lua script. Deletes the key once it would
 * hit 0 (keeps the keyspace clean instead of leaving `0` entries around).
 */
const RELEASE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
return redis.call('DECR', KEYS[1])
`;

export class RedisCreatorQuotaStore implements CreatorQuotaStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;

  constructor(client: RedisClient, keyPrefix: string) {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  private key(userId: number): string {
    return `${this.keyPrefix}creator-quota:${userId}`;
  }

  async acquire(userId: number, maxConcurrent: number, ttlMs: number): Promise<number | null> {
    const res = (await this.client.eval(
      ACQUIRE_LUA,
      1,
      this.key(userId),
      String(maxConcurrent),
      String(ttlMs)
    )) as number;
    return res === -1 ? null : res;
  }

  async release(userId: number): Promise<void> {
    await this.client.eval(RELEASE_LUA, 1, this.key(userId));
  }

  async getCount(userId: number): Promise<number> {
    const raw = await this.client.get(this.key(userId));
    return raw === null ? 0 : parseInt(raw, 10);
  }
}

/**
 * Wire the creator quota onto Redis when REDIS_URL is configured. Idempotent
 * and safe to call at boot before the HTTP server accepts requests.
 *
 *   - REDIS_URL unset → returns false, quota keeps its in-memory backend
 *     (correct single-instance / demo behaviour, zero change).
 *   - REDIS_URL set   → swaps in the Redis-backed store. Call sites are
 *     unchanged — they use the `creatorQuota` singleton, whose store we swap.
 *
 * Never throws: any failure here leaves the in-memory store in place (fail-open
 * at the infrastructure level too), so a Redis problem can't block boot.
 */
export function initCreatorQuotaBackend(): boolean {
  try {
    const client = getRedisClient();
    if (!client) return false;
    creatorQuota.setStore(new RedisCreatorQuotaStore(client, serverEnv.REDIS_KEY_PREFIX));
    logger.info(
      "[CreatorQuota] Redis-backed store active — cross-instance quota enabled"
    );
    return true;
  } catch (err) {
    logger.warn(
      "[CreatorQuota] failed to wire Redis backend, keeping in-memory store",
      { err: err instanceof Error ? err.message : String(err) }
    );
    return false;
  }
}

/**
 * Tear down the quota backend on shutdown. Shares the underlying Redis client
 * with the generation lock — closeRedis() is idempotent, so it's safe to call
 * from both close paths regardless of shutdown order.
 */
export async function closeCreatorQuotaBackend(): Promise<void> {
  await closeRedis();
}
