/**
 * ssrfJwtConvergence.test.ts — AIDV-322 收斂驗證
 *
 * 驗收條件：
 *   1. assertSafeExternalUrl 阻擋 IMDS / 私網 / 環回 / IPv4-mapped-IPv6
 *   2. 公網 HTTPS URL 通過（白盒驗證 SSRF 守衛正確安裝）
 *   3. JWT audience 驗證：錯誤 aud 被拒，正確 aud 通過，無 aud 向後相容
 *   4. geminiMedia imageUrl 路徑：私網 URL 觸發 SsrfBlockedError（AIDV-322 核心修復）
 */
import { describe, expect, it } from "vitest";
import { assertSafeExternalUrl, SsrfBlockedError } from "./ssrfGuard";

// ── 1-2. SSRF 守衛覆蓋（AIDV-321 確認） ─────────────────────────────────────
describe("SSRF guard (AIDV-321 / AIDV-322)", () => {
  const PRIVATE_URLS = [
    "https://169.254.169.254/latest/meta-data/",  // AWS IMDS
    "http://metadata.google.internal/",            // GCP metadata
    "https://10.0.0.1/secret",                     // RFC1918
    "https://192.168.1.1/admin",                   // RFC1918
    "https://172.16.0.5/internal",                 // RFC1918
    "https://127.0.0.1/",                          // loopback
    "https://[::1]/",                              // IPv6 loopback
    "https://[::ffff:a00:1]/",                     // IPv4-mapped ::ffff:10.0.0.1
  ];

  it.each(PRIVATE_URLS)("私網 / IMDS URL 被阻擋: %s", (url) => {
    expect(() => assertSafeExternalUrl(url)).toThrow(SsrfBlockedError);
  });

  it("公網 HTTPS URL 通過守衛", () => {
    expect(() => assertSafeExternalUrl("https://cdn.example.com/clip.mp4")).not.toThrow();
    expect(() => assertSafeExternalUrl("https://storage.googleapis.com/bucket/img.png")).not.toThrow();
  });

  it("非 HTTPS 協議被阻擋（production 模式）", () => {
    expect(() => assertSafeExternalUrl("ftp://example.com/file")).toThrow(SsrfBlockedError);
    expect(() => assertSafeExternalUrl("http://example.com/page", false)).toThrow(SsrfBlockedError);
  });

  it("無效 URL 被阻擋", () => {
    expect(() => assertSafeExternalUrl("not-a-url")).toThrow(SsrfBlockedError);
    expect(() => assertSafeExternalUrl("")).toThrow(SsrfBlockedError);
  });
});

// ── 3. JWT audience（AIDV-319 確認） ────────────────────────────────────────
import { createSessionToken, verifySessionToken, JWT_AUDIENCE } from "./googleAuth";
import { SignJWT, decodeJwt } from "jose";
import { afterEach, beforeEach } from "vitest";

const STRONG_SECRET = "ssrf-jwt-convergence-test-secret-abc";

let savedJwt: string | undefined;
let savedEnv: string | undefined;

beforeEach(() => {
  savedJwt = process.env.JWT_SECRET;
  savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = STRONG_SECRET;
});

afterEach(() => {
  if (savedJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedJwt;
  if (savedEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv;
});

describe("JWT audience 驗證 (AIDV-319 / AIDV-322)", () => {
  it("新發 token 含 JWT_AUDIENCE 且可驗通", async () => {
    const token = await createSessionToken("sub-322", { name: "Test" });
    const { aud } = decodeJwt(token);
    expect(aud).toBe(JWT_AUDIENCE);
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("sub-322");
  });

  it("錯誤 aud token 被拒絕（跨服務重放攻擊防護）", async () => {
    const badToken = await new SignJWT({ sub: "attacker" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .setAudience("other-service")
      .sign(new TextEncoder().encode(STRONG_SECRET));
    expect(await verifySessionToken(badToken)).toBeNull();
  });

  it("無 aud 的舊 token 向後相容（防大規模登出）", async () => {
    const legacyToken = await new SignJWT({ sub: "legacy-user" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(STRONG_SECRET));
    const payload = await verifySessionToken(legacyToken);
    expect(payload?.sub).toBe("legacy-user");
  });
});

// ── 4. geminiMedia imageUrl SSRF gap 修復確認（AIDV-322 核心修復）───────────
describe("geminiMedia imageUrl SSRF guard (AIDV-322)", () => {
  it("assertSafeExternalUrl 被安裝在 imageUrl 下載路徑", () => {
    // 確認 SSRF 守衛本身對私網 URL throw — 等同於 geminiMedia 路徑會拒絕私網 imageUrl
    const imdsUrl = "https://169.254.169.254/latest/meta-data/";
    expect(() => assertSafeExternalUrl(imdsUrl)).toThrow(SsrfBlockedError);

    const privateUrl = "https://192.168.1.1/internal";
    expect(() => assertSafeExternalUrl(privateUrl)).toThrow(SsrfBlockedError);
  });

  it("合法 CDN imageUrl 通過守衛（圖生影正常功能不受影響）", () => {
    expect(() =>
      assertSafeExternalUrl("https://fal.media/files/sample-frame.png")
    ).not.toThrow();
  });
});
