// @vitest-environment node
/**
 * AIDV-280: videoOutputRoute.test.ts
 *
 * 驗收：
 *   ✅ Valid HMAC + unexpired + owned job → 302 redirect to video_url
 *   ✅ Expired token → 403
 *   ✅ HMAC mismatch → 403
 *   ✅ userId mismatch between token and session → 403
 *   ✅ Job not found → 403
 *   ✅ Job owned by different user → 403
 *   ✅ Missing query params → 403
 *   ✅ No resultJson video_url → 403
 *   ✅ Falls back to resultJson.video.url → 302
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const JWT_SECRET = "test-secret-key-aidv-280";

vi.mock("../_core/env.validated", () => ({
  serverEnv: { JWT_SECRET },
}));

const mockGetJob = vi.fn();
vi.mock("../db", () => ({
  getBackgroundJobByRequestId: (...args: any[]) => mockGetJob(...args),
}));

vi.mock("../middleware/verifyToken", () => ({
  verifyToken: vi.fn(),
}));

function makeToken(requestId: string, userId: number, expiresAt: number): string {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`v1:${requestId}:${userId}:${expiresAt}`)
    .digest("base64url");
}

function mockRes() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.redirect = (code: number, url: string) => { res.statusCode = code; res.headers.location = url; return res; };
  return res;
}

function mockReq(userId: number, query: Record<string, string>): any {
  return { user: { id: userId }, query };
}

// Extract the route handler from videoOutputRouter
async function getHandler() {
  const mod = await import("./videoOutputRoute");
  const router = mod.videoOutputRouter as any;
  // Express router stores stack; find our handler (skip verifyToken middleware)
  const layer = router.stack?.find((l: any) => l.route?.path === "/api/video-output");
  const handlers = layer?.route?.stack ?? [];
  // Last handler is the async route body
  return handlers[handlers.length - 1]?.handle as (req: any, res: any) => Promise<void>;
}

describe("videoOutputRoute handler", () => {
  const REQUEST_ID = "fal-req-abc123";
  const USER_ID = 42;
  const VIDEO_URL = "https://fal.media/files/video.mp4";
  let expiresAt: number;
  let handler: Awaited<ReturnType<typeof getHandler>>;

  beforeEach(async () => {
    expiresAt = Math.floor(Date.now() / 1000) + 3600;
    mockGetJob.mockReset();
    handler = await getHandler();
  });

  it("redirects 302 to video_url on valid signed request", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);
    mockGetJob.mockResolvedValueOnce({ userId: USER_ID, resultJson: { video_url: VIDEO_URL } });

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(VIDEO_URL);
  });

  it("returns 403 when token is expired", async () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const mac = makeToken(REQUEST_ID, USER_ID, past);

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(past), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when HMAC is wrong", async () => {
    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: "wrong" });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when url userId differs from session userId", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);

    // Session user is 999 but token was issued for 42
    const req = mockReq(999, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when job is not found", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);
    mockGetJob.mockResolvedValueOnce(undefined);

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when job belongs to different user", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);
    mockGetJob.mockResolvedValueOnce({ userId: 9999, resultJson: { video_url: VIDEO_URL } });

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when query params are missing", async () => {
    const req = mockReq(USER_ID, { r: REQUEST_ID });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when resultJson has no video url", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);
    mockGetJob.mockResolvedValueOnce({ userId: USER_ID, resultJson: { other: "data" } });

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it("falls back to resultJson.video.url when video_url absent", async () => {
    const mac = makeToken(REQUEST_ID, USER_ID, expiresAt);
    mockGetJob.mockResolvedValueOnce({ userId: USER_ID, resultJson: { video: { url: VIDEO_URL } } });

    const req = mockReq(USER_ID, { r: REQUEST_ID, u: String(USER_ID), e: String(expiresAt), t: mac });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(VIDEO_URL);
  });
});
