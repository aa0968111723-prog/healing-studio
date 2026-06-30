// @vitest-environment node
/**
 * AIDV-923: redisCreatorQuotaStore.test.ts
 *
 * 驗收：
 *   ✅ acquire under max → Lua eval called with correct key/max/ttl; returns new count
 *   ✅ acquire at/over max → Lua returns -1; store maps to null (rejected)
 *   ✅ release → Lua eval called with correct key
 *   ✅ getCount → parses Redis GET result; 0 when key missing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisCreatorQuotaStore } from "./redisCreatorQuotaStore";

function makeClient() {
  return {
    eval: vi.fn(),
    get: vi.fn(),
  };
}

describe("RedisCreatorQuotaStore", () => {
  let client: ReturnType<typeof makeClient>;
  let store: RedisCreatorQuotaStore;
  const PREFIX = "hs:";

  beforeEach(() => {
    client = makeClient();
    store = new RedisCreatorQuotaStore(client as any, PREFIX);
  });

  describe("acquire", () => {
    it("calls ACQUIRE Lua with prefixed key + max + ttl and returns the new count", async () => {
      client.eval.mockResolvedValueOnce(1);

      const result = await store.acquire(42, 3, 600_000);

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("INCR"),
        1,
        `${PREFIX}creator-quota:42`,
        "3",
        "600000"
      );
      expect(result).toBe(1);
    });

    it("returns null when the creator is already at the limit", async () => {
      client.eval.mockResolvedValueOnce(-1);

      const result = await store.acquire(42, 3, 600_000);

      expect(result).toBeNull();
    });

    it("propagates Redis errors (caller fails open)", async () => {
      client.eval.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(store.acquire(42, 3, 600_000)).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("release", () => {
    it("calls RELEASE Lua with the prefixed key", async () => {
      client.eval.mockResolvedValueOnce(0);

      await store.release(42);

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("DECR"),
        1,
        `${PREFIX}creator-quota:42`
      );
    });
  });

  describe("getCount", () => {
    it("parses the stored count", async () => {
      client.get.mockResolvedValueOnce("2");

      const count = await store.getCount(42);

      expect(client.get).toHaveBeenCalledWith(`${PREFIX}creator-quota:42`);
      expect(count).toBe(2);
    });

    it("returns 0 when the key does not exist", async () => {
      client.get.mockResolvedValueOnce(null);

      const count = await store.getCount(42);

      expect(count).toBe(0);
    });
  });
});
