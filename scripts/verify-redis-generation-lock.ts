/**
 * verify-redis-generation-lock.ts — AIDV-20 real-Redis behavioural verification
 *
 * Exercises the Redis-backed generation lock against a LIVE Redis (the
 * dev-environment/docker-compose `aidv-redis` service, redis://127.0.0.1:6379)
 * to prove the real `SET NX PX` + Lua `CAS-del` semantics — not the in-memory
 * emulation. No migration; nothing is committed to the app DB.
 *
 * Run (with the Docker redis up):
 *   docker compose -f dev-environment/docker-compose.yml up -d redis
 *   REDIS_URL=redis://127.0.0.1:6379 npx tsx scripts/verify-redis-generation-lock.ts
 *
 * Exits non-zero on the first failed assertion.
 */

// Keep env warnings quiet and ensure the lock is enabled before any import that
// reads serverEnv at module-eval time.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.ENABLE_GENERATION_LOCK = "true";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const { Redis } = await import("ioredis");
  const { getRedisClient, closeRedis } = await import("../server/_core/redisClient");
  const { RedisGenerationLockStore } = await import(
    "../server/_core/redisGenerationLockStore"
  );
  const { GenerationLockService, GENERATION_LOCKED } = await import(
    "../server/_core/generationLock"
  );

  const client = getRedisClient();
  if (!client) {
    console.error("REDIS_URL not configured — cannot run real verification.");
    process.exit(2);
  }
  // Wait until the client is actually connected so the first command isn't a
  // fail-open due to the offline queue being disabled mid-connect. (In prod the
  // lock just fails open during this brief connecting window — by design.)
  if (client.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Redis connect timeout (is aidv-redis up?)")), 5_000);
      client.once("ready", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  await client.ping();

  const prefix = "verify-test:";
  const store = new RedisGenerationLockStore(client, prefix);
  const uniq = `gen-lock:verify:${process.pid}`;

  console.log("\n── 1) Store-level: real SET NX PX ────────────────────────────");
  const tokenA = "tokenA";
  const tokenB = "tokenB";
  check("setNxPx on free key → true", (await store.setNxPx(uniq, tokenA, 60_000)) === true);
  check("setNxPx on held key → false (NX blocks)", (await store.setNxPx(uniq, tokenB, 60_000)) === false);
  // Inspect the actual Redis key directly (proves it really hit Redis, prefixed).
  const rawVal = await client.get(`${prefix}${uniq}`);
  check("raw Redis value == first token (prefixed key present)", rawVal === tokenA);
  const pttl = await client.pttl(`${prefix}${uniq}`);
  check("PX expiry set (0 < pttl <= 60000)", pttl > 0 && pttl <= 60_000);

  console.log("\n── 2) Store-level: Lua CAS-del ───────────────────────────────");
  check("casDel with WRONG token → false (cannot delete other's lock)", (await store.casDel(uniq, "wrong")) === false);
  check("key still present after failed CAS-del", (await client.exists(`${prefix}${uniq}`)) === 1);
  check("casDel with OWN token → true (deletes)", (await store.casDel(uniq, tokenA)) === true);
  check("key gone after CAS-del", (await client.exists(`${prefix}${uniq}`)) === 0);
  check("setNxPx free again after release → true", (await store.setNxPx(uniq, tokenA, 60_000)) === true);
  await store.casDel(uniq, tokenA); // cleanup

  console.log("\n── 3) Store-level: TTL auto-release ──────────────────────────");
  const ttlKey = `${uniq}:ttl`;
  check("setNxPx with 300ms TTL → true", (await store.setNxPx(ttlKey, "t", 300)) === true);
  check("immediately held → setNxPx false", (await store.setNxPx(ttlKey, "t2", 300)) === false);
  await sleep(400);
  check("after TTL expiry → setNxPx true (auto-released, no explicit release)", (await store.setNxPx(ttlKey, "t3", 60_000)) === true);
  await store.casDel(ttlKey, "t3"); // cleanup

  console.log("\n── 4) Service-level: acquire/blocked/release end-to-end ──────");
  const svc = new GenerationLockService(store);
  const svcKey = `${uniq}:svc`;
  const first = await svc.acquire(svcKey, 60_000);
  check("acquire → token (not GENERATION_LOCKED)", first !== GENERATION_LOCKED && typeof first === "string");
  check("second concurrent acquire → GENERATION_LOCKED", (await svc.acquire(svcKey, 60_000)) === GENERATION_LOCKED);
  check("release own lock → true", (await svc.release(svcKey, first as string)) === true);
  check("acquire after release → token again", (await svc.acquire(svcKey, 60_000)) !== GENERATION_LOCKED);
  await client.del(`${prefix}${svcKey}`); // cleanup
  svc.destroy();

  console.log("\n── 5) Fail-open: Redis unreachable → generation proceeds ─────");
  const deadClient = new Redis("redis://127.0.0.1:6390", {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
    retryStrategy: () => null, // don't keep retrying a known-dead port
    lazyConnect: false,
  });
  deadClient.on("error", () => {
    /* expected — swallow */
  });
  const deadStore = new RedisGenerationLockStore(deadClient, prefix);
  const deadSvc = new GenerationLockService(deadStore, { selfHealAttempts: 1, selfHealIntervalMs: 10 });
  const failOpenToken = await deadSvc.acquire(`${uniq}:dead`, 60_000);
  check("acquire against dead Redis → token (FAIL-OPEN, not blocked)", failOpenToken !== GENERATION_LOCKED && typeof failOpenToken === "string");
  check("fail-open counted in stats", deadSvc.getStats().failOpen === 1);
  await deadSvc._drainSelfHeals();
  deadSvc.destroy();
  deadClient.disconnect();

  await closeRedis();

  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("✅ All real-Redis generation-lock checks passed.\n");
}

main().catch(err => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
