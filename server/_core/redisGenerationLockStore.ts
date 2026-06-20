/**
 * redisGenerationLockStore.ts — Redis-backed GenerationLockStore
 *
 * Implements the `GenerationLockStore` seam from generationLock.ts over the
 * shared ioredis client. The two primitives map 1:1 onto Redis:
 *
 *   setNxPx → `SET key token NX PX ttl`   (atomic acquire-if-free with expiry)
 *   casDel  → Lua `if get(key)==token then del(key) end`  (compare-and-delete)
 *
 * This is what makes the dedup lock **cross-instance**: with REDIS_URL set, two
 * identical submits that land on different Railway replicas contend on the same
 * Redis key, so only one acquires. Without it the lock is per-process (see the
 * doc block in generationLock.ts).
 *
 * Fail-open is preserved by the layer above: `GenerationLockService` wraps every
 * store op in a short timeout + try/catch and proceeds (fail-open) on any
 * rejection. This store therefore just lets errors propagate — it must NOT
 * swallow them into a "lock held" result, or a Redis blip could wedge a user.
 *
 * Key namespacing: keys are prefixed with `REDIS_KEY_PREFIX` (default
 * "healing-studio:") so the lock shares the project's Redis namespace and can
 * coexist with future cache / rate-limiter keys on the same instance. The prefix
 * is applied identically to the SET key and the Lua KEYS[1], so acquire and
 * release always target the same physical key.
 */

import type { GenerationLockStore } from "./generationLock";
import { generationLock } from "./generationLock";
import { getRedisClient, closeRedis, type RedisClient } from "./redisClient";
import { logger } from "./logger";
import { serverEnv } from "./env.validated";

/**
 * Compare-and-delete in one atomic round-trip. Returns 1 if the key existed and
 * its value matched the token (and was deleted), 0 otherwise. This guarantees we
 * never delete a lock that a *later* legitimate attempt acquired after our TTL
 * lapsed (the value would no longer be our token).
 */
const CAS_DEL_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class RedisGenerationLockStore implements GenerationLockStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;

  constructor(client: RedisClient, keyPrefix: string) {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  private k(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** `SET key token NX PX ttl` → true if taken, false if already held. */
  async setNxPx(key: string, token: string, ttlMs: number): Promise<boolean> {
    // ioredis: set(key, value, "PX", ttlMs, "NX") → "OK" on success, null on NX miss.
    const res = await this.client.set(this.k(key), token, "PX", ttlMs, "NX");
    return res === "OK";
  }

  /** Lua compare-and-delete → true if a matching entry was removed. */
  async casDel(key: string, token: string): Promise<boolean> {
    const res = await this.client.eval(CAS_DEL_LUA, 1, this.k(key), token);
    return res === 1;
  }
}

/**
 * Wire the generation lock onto Redis when REDIS_URL is configured. Idempotent
 * and safe to call at boot before the HTTP server accepts requests.
 *
 *   - REDIS_URL unset → returns false, lock keeps its in-memory backend
 *     (correct single-instance / demo behaviour, zero change).
 *   - REDIS_URL set   → swaps in the Redis-backed store. Call sites are
 *     unchanged — they use the `generationLock` singleton, whose store we swap.
 *
 * Never throws: any failure here leaves the in-memory store in place (fail-open
 * at the infrastructure level too), so a Redis problem can't block boot.
 */
export function initGenerationLockBackend(): boolean {
  try {
    const client = getRedisClient();
    if (!client) return false;
    generationLock.setStore(
      new RedisGenerationLockStore(client, serverEnv.REDIS_KEY_PREFIX)
    );
    logger.info(
      "[GenerationLock] Redis-backed store active — cross-instance dedup enabled"
    );
    return true;
  } catch (err) {
    logger.warn(
      "[GenerationLock] failed to wire Redis backend, keeping in-memory store",
      { err: err instanceof Error ? err.message : String(err) }
    );
    return false;
  }
}

/** Tear down the lock backend on shutdown: stop self-heal/sweep timers + close Redis. */
export async function closeGenerationLockBackend(): Promise<void> {
  try {
    generationLock.destroy();
  } catch {
    /* best-effort */
  }
  await closeRedis();
}
