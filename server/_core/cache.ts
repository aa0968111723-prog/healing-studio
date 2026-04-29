/**
 * cache.ts — In-process LRU cache with TTL support
 *
 * Provides a Redis-compatible interface backed by an in-memory LRU store.
 * Designed for caching LLM responses, search results, and user preferences
 * without requiring an external Redis dependency.
 *
 * Architecture:
 *   - LRU eviction when maxSize is reached (oldest entries removed first)
 *   - Per-entry TTL with lazy expiry on read + periodic sweep
 *   - Namespace-prefixed keys to avoid collisions between cache domains
 *   - Zero external dependencies — pure Node.js
 *
 * Usage:
 *   import { cache } from "./_core/cache";
 *   await cache.set("llm:response:abc123", result, { ttl: 300 });
 *   const hit = await cache.get<InvokeResult>("llm:response:abc123");
 */

import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CacheSetOptions {
  /** Time-to-live in seconds. Defaults to DEFAULT_TTL. */
  ttl?: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix ms
  createdAt: number;
  lastAccessedAt: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Default TTL: 5 minutes */
const DEFAULT_TTL_SECONDS = 300;

/** Maximum number of entries before LRU eviction kicks in */
const DEFAULT_MAX_SIZE = 1_000;

/** How often to sweep expired entries (ms) */
const SWEEP_INTERVAL_MS = 60_000;

// ─── LRU Cache Implementation ──────────────────────────────────────────────

class LruCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.startSweep();
  }

  /**
   * Retrieve a cached value. Returns null on miss or expiry.
   * Moves the accessed entry to the end of the Map (LRU order).
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    // Refresh LRU position by re-inserting
    this.store.delete(key);
    entry.lastAccessedAt = Date.now();
    this.store.set(key, entry as CacheEntry<unknown>);

    this.hits++;
    return entry.value;
  }

  /**
   * Store a value with an optional TTL (seconds).
   * Evicts the least-recently-used entry if the store is full.
   */
  set<T>(key: string, value: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): void {
    // Evict LRU entry if at capacity (and key is new)
    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) {
        this.store.delete(lruKey);
        this.evictions++;
      }
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1_000,
      createdAt: now,
      lastAccessedAt: now,
    } as CacheEntry<unknown>);
  }

  /** Remove a specific key. Returns true if the key existed. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Remove all keys matching a prefix pattern. */
  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Check whether a non-expired entry exists for the key. */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /** Return current cache statistics. */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : Math.round((this.hits / total) * 10_000) / 100,
    };
  }

  /** Sweep expired entries to reclaim memory. */
  private sweep(): void {
    const now = Date.now();
    let swept = 0;
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        swept++;
      }
    }
    if (swept > 0) {
      logger.debug("[Cache] Swept expired entries", { swept, remaining: this.store.size });
    }
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Allow the process to exit even if the timer is active
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /** Stop the background sweep timer (call during graceful shutdown). */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.store.clear();
  }
}

// ─── Namespaced Cache Facade ───────────────────────────────────────────────

/**
 * High-level cache facade with domain-specific helpers.
 *
 * Namespaces:
 *   llm:      LLM response cache (TTL: 10 min)
 *   search:   Search result cache (TTL: 5 min)
 *   prefs:    User preference cache (TTL: 30 min)
 *   generic:  General-purpose (TTL: 5 min)
 */
class CacheService {
  private readonly lru: LruCache;

  // Default TTLs per namespace (seconds)
  private readonly TTL: Record<string, number> = {
    llm: 600,      // 10 minutes — LLM responses are expensive
    search: 300,   // 5 minutes  — search results change frequently
    prefs: 1_800,  // 30 minutes — user preferences are stable
    generic: 300,  // 5 minutes  — default
  };

  constructor(maxSize?: number) {
    this.lru = new LruCache(maxSize);
  }

  // ── Generic API ──────────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    return this.lru.get<T>(key);
  }

  async set<T>(key: string, value: T, opts?: CacheSetOptions): Promise<void> {
    const namespace = key.split(":")[0] ?? "generic";
    const ttl = opts?.ttl ?? this.TTL[namespace] ?? DEFAULT_TTL_SECONDS;
    this.lru.set(key, value, ttl);
  }

  async delete(key: string): Promise<boolean> {
    return this.lru.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    return this.lru.deleteByPrefix(prefix);
  }

  async has(key: string): Promise<boolean> {
    return this.lru.has(key);
  }

  async clear(): Promise<void> {
    this.lru.clear();
  }

  // ── LLM Response Cache ───────────────────────────────────────────────────

  /**
   * Build a deterministic cache key for an LLM request.
   * Hashes the model + messages + temperature to a short hex string.
   */
  buildLlmKey(params: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    temperature?: number;
    maxTokens?: number;
  }): string {
    const fingerprint = JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0,
      maxTokens: params.maxTokens ?? 0,
    });
    // Simple djb2 hash — fast, no crypto overhead
    let hash = 5381;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = ((hash << 5) + hash) ^ fingerprint.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return `llm:${hash.toString(16).padStart(8, "0")}`;
  }

  async getLlmResponse<T>(key: string): Promise<T | null> {
    const result = await this.get<T>(key);
    if (result !== null) {
      logger.debug("[Cache] LLM cache hit", { key });
    }
    return result;
  }

  async setLlmResponse<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, value, { ttl: ttlSeconds ?? this.TTL.llm });
    logger.debug("[Cache] LLM response cached", { key, ttl: ttlSeconds ?? this.TTL.llm });
  }

  // ── Search Result Cache ──────────────────────────────────────────────────

  buildSearchKey(query: string, provider: string): string {
    let hash = 5381;
    const input = `${provider}:${query.toLowerCase().trim()}`;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
      hash = hash >>> 0;
    }
    return `search:${provider}:${hash.toString(16).padStart(8, "0")}`;
  }

  async getSearchResult<T>(key: string): Promise<T | null> {
    return this.get<T>(key);
  }

  async setSearchResult<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, value, { ttl: ttlSeconds ?? this.TTL.search });
  }

  // ── User Preference Cache ────────────────────────────────────────────────

  buildPrefsKey(userId: number): string {
    return `prefs:user:${userId}`;
  }

  async getUserPrefs<T>(userId: number): Promise<T | null> {
    return this.get<T>(this.buildPrefsKey(userId));
  }

  async setUserPrefs<T>(userId: number, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(this.buildPrefsKey(userId), value, {
      ttl: ttlSeconds ?? this.TTL.prefs,
    });
  }

  async invalidateUserPrefs(userId: number): Promise<void> {
    await this.delete(this.buildPrefsKey(userId));
  }

  // ── Observability ────────────────────────────────────────────────────────

  getStats(): CacheStats {
    return this.lru.stats();
  }

  /** Graceful shutdown — stop background sweep timer. */
  destroy(): void {
    this.lru.destroy();
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const cache = new CacheService();

export { CacheService };
