// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { importWithRetry, isChunkLoadError } from "@/lib/lazyWithRetry";

function makeChunkError(): Error {
  const err = new Error("Failed to fetch dynamically imported module: /assets/js/x.js");
  err.name = "ChunkLoadError";
  return err;
}

describe("isChunkLoadError", () => {
  it("matches ChunkLoadError name", () => {
    const err = new Error("anything");
    err.name = "ChunkLoadError";
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("matches dynamic import failure message", () => {
    expect(isChunkLoadError(makeChunkError())).toBe(true);
  });

  it("matches stale module script message", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(
      true
    );
  });

  it("does not match unrelated errors", () => {
    expect(isChunkLoadError(new Error("syntax error"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("importWithRetry", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns the module on first successful import", async () => {
    const mod = { default: () => null };
    const factory = vi.fn(async () => mod);
    const result = await importWithRetry(factory, { retryDelayMs: 0 });
    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries once on chunk-load error and returns the second result", async () => {
    const mod = { default: () => null };
    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeChunkError())
      .mockResolvedValueOnce(mod);

    const result = await importWithRetry(factory, { retryDelayMs: 0 });
    expect(result).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-chunk errors", async () => {
    const oddError = new Error("syntax error");
    const factory = vi.fn().mockRejectedValueOnce(oddError);

    await expect(
      importWithRetry(factory, { retryDelayMs: 0 })
    ).rejects.toThrow("syntax error");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("forces a reload after two consecutive chunk failures", async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeChunkError())
      .mockRejectedValueOnce(makeChunkError());

    const onStaleReload = vi.fn();
    // The reload path returns a never-resolving promise to halt rendering;
    // race it against a short timeout so the test still completes.
    const result = await Promise.race([
      importWithRetry(factory, { retryDelayMs: 0, onStaleReload }),
      new Promise(resolve => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(result).toBe("timeout");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(onStaleReload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("hs-chunk-reload-attempt")).not.toBeNull();
  });

  it("does not reload again within the cooldown window", async () => {
    sessionStorage.setItem("hs-chunk-reload-attempt", String(Date.now()));

    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeChunkError())
      .mockRejectedValueOnce(makeChunkError());

    const onStaleReload = vi.fn();
    await expect(
      importWithRetry(factory, { retryDelayMs: 0, onStaleReload })
    ).rejects.toThrow();

    expect(onStaleReload).not.toHaveBeenCalled();
  });
});
