import { describe, it, expect, vi } from "vitest";
import { withToolRetry, withAuthRetry } from "./orbToolRetry";

// ─── withToolRetry ───────────────────────────────────────────────────────────

describe("withToolRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const result = await withToolRetry(fn, { maxRetries: 2 });
    expect(result.result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.retried).toBe(false);
  });

  it("retries on transient error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "timeout" })
      .mockResolvedValue({ ok: true });
    const result = await withToolRetry(fn, { maxRetries: 2, baseDelayMs: 0 });
    expect(result.result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.retried).toBe(true);
  });

  it("does not retry on permanent error (401)", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "401 Unauthorized" });
    const result = await withToolRetry(fn, { maxRetries: 3 });
    expect(result.attempts).toBe(1);
    expect(result.retried).toBe(false);
    expect(result.result.ok).toBe(false);
  });

  it("exhausts retries on repeated transient error", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "503 Service Unavailable" });
    const result = await withToolRetry(fn, { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 });
    expect(result.attempts).toBe(3);
    expect(result.retried).toBe(true);
  });
});

// ─── withAuthRetry ───────────────────────────────────────────────────────────

describe("withAuthRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const result = await withAuthRetry(fn, { maxRetries: 3 });
    expect(result.result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.retried).toBe(false);
  });

  it("retries on 401 and succeeds after recovery", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "401 Unauthorized" })
      .mockResolvedValueOnce({ ok: false, error: "401 Unauthorized" })
      .mockResolvedValue({ ok: true });
    const result = await withAuthRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result.result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.retried).toBe(true);
  });

  it("prefixes error with needs-key after exhausting retries", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "401 Unauthorized" });
    const result = await withAuthRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toMatch(/^needs-key:/);
    expect(result.attempts).toBe(4);
    expect(result.retried).toBe(true);
  });

  it("does not retry on non-auth errors (returns immediately)", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "not-found" });
    const result = await withAuthRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result.attempts).toBe(1);
    expect(result.retried).toBe(false);
    expect(result.result.error).toBe("not-found");
  });

  it("retries on 'unauthorized' string variant", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "unauthorized access" })
      .mockResolvedValue({ ok: true });
    const result = await withAuthRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result.result.ok).toBe(true);
    expect(result.retried).toBe(true);
  });

  it("invokes onRetry callback on each retry", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "401" })
      .mockResolvedValue({ ok: true });
    await withAuthRetry(fn, { maxRetries: 3, baseDelayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
