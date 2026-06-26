/**
 * webhookDispatcher.test.ts — AIDV-269
 *
 * Unit tests for the creator-facing webhook dispatcher.
 * Uses DB mock (vi.mock) so no real DB connection needed.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── DB mock ──────────────────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: () => ({ from: () => ({ where: () => Promise.resolve(mockSelect()) }) }),
    insert: () => ({ values: (v: unknown) => Promise.resolve(mockInsert(v)) }),
  }),
}));

vi.mock("../../../drizzle/schema", () => ({
  webhookSubscriptions: { id: "id", userId: "userId", url: "url", secret: "secret", events: "events", active: "active" },
  webhookDeliveryHistory: { subscriptionId: "subscriptionId", event: "event", payload: "payload", statusCode: "statusCode", attempt: "attempt", succeeded: "succeeded", errorMessage: "errorMessage" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

import { dispatchWebhookEvent } from "../../services/webhookDispatcher";

describe("dispatchWebhookEvent (AIDV-269)", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockInsert.mockReset();
  });

  it("skips when no subscriptions match the event", async () => {
    mockSelect.mockResolvedValue([
      { id: 1, url: "https://example.com/hook", secret: "s", events: ["video.failed"], active: true },
    ]);
    const fetcher = vi.fn();
    await dispatchWebhookEvent(42, "video.completed", { jobId: 99 }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends signed POST to matching subscription", async () => {
    const secret = "testsecret123";
    mockSelect.mockResolvedValue([
      { id: 1, url: "https://example.com/hook", secret, events: ["video.completed"], active: true },
    ]);
    mockInsert.mockResolvedValue(undefined);

    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fetcher = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      capturedHeaders = opts.headers as Record<string, string>;
      capturedBody = opts.body as string;
      return Promise.resolve({ ok: true, status: 200 });
    });
    const noSleep = vi.fn().mockResolvedValue(undefined);

    await dispatchWebhookEvent(42, "video.completed", { jobId: 99 }, fetcher, noSleep);
    // Give fire-and-forget a tick to complete
    await new Promise(r => setTimeout(r, 10));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(capturedHeaders["X-AIDV-Event"]).toBe("video.completed");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");

    // Verify HMAC-SHA256 signature
    const parsed = JSON.parse(capturedBody);
    expect(parsed.event).toBe("video.completed");
    expect(parsed.jobId).toBe(99);
    const expected =
      "sha256=" + crypto.createHmac("sha256", secret).update(capturedBody).digest("hex");
    expect(capturedHeaders["X-AIDV-Signature"]).toBe(expected);
  });

  it("blocks SSRF-targeted URLs silently", async () => {
    mockSelect.mockResolvedValue([
      { id: 1, url: "http://localhost/hook", secret: "s", events: ["video.completed"], active: true },
    ]);
    const fetcher = vi.fn();
    await dispatchWebhookEvent(42, "video.completed", { jobId: 1 }, fetcher);
    await new Promise(r => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries on non-ok response and records delivery", async () => {
    mockSelect.mockResolvedValue([
      { id: 7, url: "https://example.com/hook", secret: "k", events: ["video.failed"], active: true },
    ]);
    mockInsert.mockResolvedValue(undefined);

    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const noSleep = vi.fn().mockResolvedValue(undefined);

    await dispatchWebhookEvent(1, "video.failed", { jobId: 5, error: "boom" }, fetcher, noSleep);
    await new Promise(r => setTimeout(r, 50));

    // 3 attempts (MAX_RETRIES)
    expect(fetcher).toHaveBeenCalledTimes(3);
    // recordDelivery was called once (final failure)
    expect(mockInsert).toHaveBeenCalledOnce();
    const recorded = mockInsert.mock.calls[0][0];
    expect(recorded.succeeded).toBe(false);
    expect(recorded.attempt).toBe(3);
    expect(recorded.statusCode).toBe(503);
  });
});
