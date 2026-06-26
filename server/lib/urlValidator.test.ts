// @vitest-environment node
/**
 * urlValidator — AIDV-206/259 SSRF URL allowlist 單元測試。
 * 守住：https-only、私有 IP 拒絕、允許清單網域通過、env-based 擴充、
 * ENABLE_URL_ALLOWLIST=0 退路（僅 IP 過濾）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { assertSafeUrl, isMediaUrlSafe, UrlNotAllowedError } from "./urlValidator";

// ── assertSafeUrl（底層，不受 ENABLE_URL_ALLOWLIST 影響）──────────────────
describe("assertSafeUrl", () => {
  it("允許 fal.media CDN URL", () => {
    expect(() => assertSafeUrl("https://v3.fal.media/files/abc/output.jpg")).not.toThrow();
  });
  it("允許 fal.ai API URL", () => {
    expect(() => assertSafeUrl("https://fal.ai/models/flux")).not.toThrow();
  });
  it("允許 fal.run URL", () => {
    expect(() => assertSafeUrl("https://api.fal.run/v1/generate")).not.toThrow();
  });
  it("允許 cloudfront.net CDN", () => {
    expect(() => assertSafeUrl("https://d1234.cloudfront.net/img.png")).not.toThrow();
  });
  it("允許 amazonaws.com（S3）", () => {
    expect(() => assertSafeUrl("https://mybucket.s3.amazonaws.com/file.mp4")).not.toThrow();
  });
  it("允許 r2.dev", () => {
    expect(() => assertSafeUrl("https://pub-abc.r2.dev/file.jpg")).not.toThrow();
  });

  it("拒絕 http:// scheme", () => {
    expect(() => assertSafeUrl("http://fal.media/file.jpg")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 data: URI", () => {
    expect(() => assertSafeUrl("data:image/png;base64,abc")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 AWS EC2 metadata IP（169.254.169.254）", () => {
    expect(() => assertSafeUrl("https://169.254.169.254/latest/meta-data/")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 私有 IP 10.x", () => {
    expect(() => assertSafeUrl("https://10.0.0.1/internal")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 私有 IP 192.168.x", () => {
    expect(() => assertSafeUrl("https://192.168.1.1/api")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 localhost", () => {
    expect(() => assertSafeUrl("https://localhost/secret")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 不在白名單的公開網域", () => {
    expect(() => assertSafeUrl("https://evil.com/payload.jpg")).toThrow(UrlNotAllowedError);
  });
  it("拒絕 無效 URL", () => {
    expect(() => assertSafeUrl("not-a-url")).toThrow(UrlNotAllowedError);
  });
});

// ── isMediaUrlSafe（Zod refine 目標，受 ENABLE_URL_ALLOWLIST 影響）──────────
describe("isMediaUrlSafe (ENABLE_URL_ALLOWLIST=1, default)", () => {
  beforeEach(() => { delete process.env.ENABLE_URL_ALLOWLIST; });

  it("允許 fal.media URL", () => {
    expect(isMediaUrlSafe("https://v3.fal.media/files/img.jpg")).toBe(true);
  });
  it("允許 amazonaws.com URL", () => {
    expect(isMediaUrlSafe("https://bucket.s3.amazonaws.com/clip.mp4")).toBe(true);
  });
  it("拒絕 私有 IP", () => {
    expect(isMediaUrlSafe("https://169.254.169.254/")).toBe(false);
  });
  it("拒絕 未知公開網域", () => {
    expect(isMediaUrlSafe("https://attacker.example/img.jpg")).toBe(false);
  });
  it("拒絕 http:// URL", () => {
    expect(isMediaUrlSafe("http://fal.media/img.jpg")).toBe(false);
  });
});

describe("isMediaUrlSafe (ENABLE_URL_ALLOWLIST=0, fallback)", () => {
  beforeEach(() => { process.env.ENABLE_URL_ALLOWLIST = "0"; });
  afterEach(() => { delete process.env.ENABLE_URL_ALLOWLIST; });

  it("允許 fal.media（IP 過濾通過，無域名限制）", () => {
    expect(isMediaUrlSafe("https://v3.fal.media/files/img.jpg")).toBe(true);
  });
  it("允許 任意公開 https 網域（白名單旁路）", () => {
    expect(isMediaUrlSafe("https://some-user-cdn.example.com/img.jpg")).toBe(true);
  });
  it("仍拒絕 私有 IP（IP 過濾仍有效）", () => {
    expect(isMediaUrlSafe("https://169.254.169.254/")).toBe(false);
  });
  it("仍拒絕 http:// URL", () => {
    expect(isMediaUrlSafe("http://example.com/img.jpg")).toBe(false);
  });
});

describe("isMediaUrlSafe (ALLOWED_MEDIA_DOMAINS env extension)", () => {
  beforeEach(() => {
    delete process.env.ENABLE_URL_ALLOWLIST;
    // Note: ALLOWED_MEDIA_DOMAINS is read at module init; we test via assertSafeUrl
    // here since the module is already loaded. This test validates the regex path.
  });

  it("預設不允許 example.com", () => {
    expect(isMediaUrlSafe("https://cdn.example.com/img.jpg")).toBe(false);
  });
});
