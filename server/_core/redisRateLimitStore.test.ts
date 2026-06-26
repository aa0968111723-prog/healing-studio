// @vitest-environment node
/**
 * AIDV-335: redisRateLimitStore.test.ts
 *
 * 驗收：
 *   ✅ increment → Lua script called with correct key/windowMs; returns totalHits + resetTime
 *   ✅ second increment → totalHits incremented; TTL carried through
 *   ✅ Redis error on increment → fail-open (totalHits=0, no throw)
 *   ✅ resetKey → DEL called with prefixed key
 *   ✅ decrement → DECR called (skips when count is 0)
 *   ✅ get → parses hits + pttl into ClientRateLimitInfo; undefined when key missing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisRateLimitStore } from "./redisRateLimitStore";

function makeClient() {
  return {
    eval: vi.fn(),
    get: vi.fn(),
    pttl: vi.fn(),
    decr: vi.fn(),
    del: vi.fn(),
  };
}

describe("RedisRateLimitStore", () => {
  let client: ReturnType<typeof makeClient>;
  let store: RedisRateLimitStore;
  const PREFIX = "hs:rl:auth:";
  const WINDOW_MS = 60_000;

  beforeEach(() => {
    client = makeClient();
    store = new RedisRateLimitStore(client as any, PREFIX);
    store.init({ windowMs: WINDOW_MS } as any);
  });

  describe("increment", () => {
    it("calls Lua eval with prefixed key + windowMs and returns parsed result", async () => {
      const pttl = 55_000;
      client.eval.mockResolvedValueOnce([1, pttl]);

      const result = await store.increment("ip:1.2.3.4");

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("INCR"),
        1,
        `${PREFIX}ip:1.2.3.4`,
        String(WINDOW_MS),
      );
      expect(result.totalHits).toBe(1);
      expect(result.resetTime).toBeInstanceOf(Date);
    });

    it("totalHits increases on second call", async () => {
      client.eval
        .mockResolvedValueOnce([1, 60_000])
        .mockResolvedValueOnce([2, 55_000]);

      await store.increment("ip:1.2.3.4");
      const second = await store.increment("ip:1.2.3.4");

      expect(second.totalHits).toBe(2);
    });

    it("fails open when Redis throws", async () => {
      client.eval.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await store.increment("ip:bad");

      expect(result.totalHits).toBe(0);
      expect(result.resetTime).toBeUndefined();
    });
  });

  describe("resetKey", () => {
    it("DELs the prefixed key", async () => {
      client.del.mockResolvedValueOnce(1);

      await store.resetKey("ip:1.2.3.4");

      expect(client.del).toHaveBeenCalledWith(`${PREFIX}ip:1.2.3.4`);
    });

    it("swallows Redis errors", async () => {
      client.del.mockRejectedValueOnce(new Error("timeout"));
      await expect(store.resetKey("ip:1.2.3.4")).resolves.toBeUndefined();
    });
  });

  describe("decrement", () => {
    it("calls DECR when current count > 0", async () => {
      client.get.mockResolvedValueOnce("3");
      client.decr.mockResolvedValueOnce(2);

      await store.decrement("ip:1.2.3.4");

      expect(client.decr).toHaveBeenCalledWith(`${PREFIX}ip:1.2.3.4`);
    });

    it("skips DECR when current count is 0", async () => {
      client.get.mockResolvedValueOnce("0");

      await store.decrement("ip:1.2.3.4");

      expect(client.decr).not.toHaveBeenCalled();
    });

    it("swallows Redis errors", async () => {
      client.get.mockRejectedValueOnce(new Error("timeout"));
      await expect(store.decrement("ip:1.2.3.4")).resolves.toBeUndefined();
    });
  });

  describe("get", () => {
    it("returns ClientRateLimitInfo when key exists", async () => {
      client.get.mockResolvedValueOnce("7");
      client.pttl.mockResolvedValueOnce(30_000);

      const info = await store.get("ip:1.2.3.4");

      expect(info?.totalHits).toBe(7);
      expect(info?.resetTime).toBeInstanceOf(Date);
    });

    it("returns undefined when key does not exist", async () => {
      client.get.mockResolvedValueOnce(null);
      client.pttl.mockResolvedValueOnce(-2);

      const info = await store.get("ip:missing");

      expect(info).toBeUndefined();
    });

    it("returns undefined on Redis error", async () => {
      client.get.mockRejectedValueOnce(new Error("timeout"));
      client.pttl.mockRejectedValueOnce(new Error("timeout"));

      const info = await store.get("ip:1.2.3.4");

      expect(info).toBeUndefined();
    });
  });
});
