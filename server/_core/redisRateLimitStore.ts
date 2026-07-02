/**
 * redisRateLimitStore.ts — Redis-backed express-rate-limit Store (AIDV-335)
 *
 * Wraps the shared ioredis client to give express-rate-limit a durable
 * counter store that survives process restarts. Wired in rateLimiter.ts
 * when REDIS_URL is configured; callers fall back to the default
 * MemoryStore when it is not.
 *
 * Fail-open: every Redis error is swallowed and the request is allowed
 * (totalHits=1，見 #1269——計為視窗首擊而非 0，避免 legitimate-first-hit 語意混淆).
 * A Redis blip therefore degrades enforcement to best-effort
 * rather than blocking all traffic.
 *
 * Key format: `<prefix>rl:<tier>:<clientKey>` (e.g. "healing-studio:rl:auth:ip:1.2.3.4")
 */

import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import type { RedisClient } from "./redisClient";
import { logger } from "./logger";

/**
 * Atomic increment + set-expiry-on-first-hit Lua script.
 *
 * Returns [totalHits, pttlMs] where:
 *   - totalHits is the new counter value after increment
 *   - pttlMs is the remaining milliseconds until the key expires
 *     (-1 means no expiry set, which should not happen in normal operation)
 *
 * Using NX on PEXPIRE ensures only the *first* hit in a window sets the
 * expiry; subsequent hits within the window leave the TTL unchanged so the
 * window slides correctly.
 */
const INCREMENT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {current, pttl}
`;

export class RedisRateLimitStore implements Store {
  private readonly client: RedisClient;
  /** Public as required by the Store interface (used by express-rate-limit's double-count check). */
  readonly prefix: string;
  private windowMs = 60_000;

  constructor(client: RedisClient, prefix: string) {
    this.client = client;
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const res = (await this.client.eval(
        INCREMENT_LUA,
        1,
        this.key(key),
        String(this.windowMs),
      )) as [number, number];
      const totalHits = res[0];
      const pttl = res[1];
      const resetTime = pttl > 0 ? new Date(Date.now() + pttl) : undefined;
      return { totalHits, resetTime };
    } catch (err) {
      logger.warn("[RedisRateLimitStore] increment failed, failing open", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
      return { totalHits: 1, resetTime: undefined };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const k = this.key(key);
      const current = await this.client.get(k);
      if (current !== null && parseInt(current, 10) > 0) {
        await this.client.decr(k);
      }
    } catch {
      /* fail-open: decrement is cosmetic, not security-critical */
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.client.del(this.key(key));
    } catch {
      /* fail-open */
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const k = this.key(key);
      const [hits, pttl] = await Promise.all([
        this.client.get(k),
        this.client.pttl(k),
      ]);
      if (hits === null) return undefined;
      const totalHits = parseInt(hits, 10);
      const resetTime = pttl > 0 ? new Date(Date.now() + pttl) : undefined;
      return { totalHits, resetTime };
    } catch {
      return undefined;
    }
  }
}
