/**
 * ssrfGuard.test.ts — AIDV-262
 * Unit tests for assertSafeExternalUrl and isExactOriginAllowed.
 */

import { describe, expect, it } from "vitest";
import { assertSafeExternalUrl, isExactOriginAllowed, SsrfBlockedError } from "./_core/ssrfGuard";

describe("assertSafeExternalUrl — AIDV-262", () => {
  it("公網 https URL 通過", () => {
    expect(() => assertSafeExternalUrl("https://example.com/image.png")).not.toThrow();
  });

  it("私網 IPv4 10.x → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://10.0.0.1/secret"))
      .toThrow(SsrfBlockedError);
  });

  it("私網 IPv4 192.168.x → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://192.168.1.1/secret"))
      .toThrow(SsrfBlockedError);
  });

  it("AWS IMDS 169.254.169.254 → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://169.254.169.254/latest/meta-data/"))
      .toThrow(SsrfBlockedError);
  });

  it("GCP metadata.google.internal → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("http://metadata.google.internal/"))
      .toThrow(SsrfBlockedError);
  });

  it("IPv4-mapped-IPv6 ::ffff:10.0.0.1 → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://[::ffff:a00:1]/"))
      .toThrow(SsrfBlockedError);
  });

  it("IPv6 loopback ::1 → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://[::1]/"))
      .toThrow(SsrfBlockedError);
  });

  it("私網 172.16.x → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("https://172.16.0.5/"))
      .toThrow(SsrfBlockedError);
  });

  it("http:// 在 allowInsecureHosts=false 時 → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("http://example.com/", false))
      .toThrow(SsrfBlockedError);
  });

  it("http:// 在 allowInsecureHosts=true 時通過", () => {
    expect(() => assertSafeExternalUrl("http://example.com/", true)).not.toThrow();
  });

  it("無效 URL → SsrfBlockedError", () => {
    expect(() => assertSafeExternalUrl("not-a-url")).toThrow(SsrfBlockedError);
  });

  it("file:// → SsrfBlockedError（非 http/https）", () => {
    expect(() => assertSafeExternalUrl("file:///etc/passwd")).toThrow(SsrfBlockedError);
  });
});

describe("isExactOriginAllowed — AIDV-262", () => {
  const allowed = ["https://pub-xxx.r2.dev", "https://forge.example.com"];

  it("完全一致的 origin → true", () => {
    expect(isExactOriginAllowed("https://pub-xxx.r2.dev/object/key", allowed)).toBe(true);
  });

  it("前綴相似但不同 origin → false（防前綴繞過）", () => {
    // 攻擊者：https://pub-xxx.r2.dev.attacker.com
    expect(
      isExactOriginAllowed("https://pub-xxx.r2.dev.attacker.com/key", allowed)
    ).toBe(false);
  });

  it("第二個 allowed prefix 一致 → true", () => {
    expect(isExactOriginAllowed("https://forge.example.com/api/resource", allowed)).toBe(true);
  });

  it("外部 URL 完全不在 allowlist → false", () => {
    expect(isExactOriginAllowed("https://evil.com/hack", allowed)).toBe(false);
  });

  it("空 allowedPrefixes → false", () => {
    expect(isExactOriginAllowed("https://pub-xxx.r2.dev/key", [])).toBe(false);
  });

  it("undefined 允許前綴被忽略", () => {
    expect(isExactOriginAllowed("https://pub-xxx.r2.dev/key", [undefined, "https://pub-xxx.r2.dev"])).toBe(true);
  });
});
