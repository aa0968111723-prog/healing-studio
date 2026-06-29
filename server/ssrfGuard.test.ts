/**
 * ssrfGuard.test.ts — AIDV-262
 * Unit tests for assertSafeExternalUrl and isExactOriginAllowed.
 */

import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { assertSafeExternalUrl, assertSafeExternalUrlAsync, isExactOriginAllowed, SsrfBlockedError } from "./_core/ssrfGuard";

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

describe("assertSafeExternalUrlAsync — AIDV-638 DNS-rebinding", () => {
  const mockLookup = (addresses: LookupAddress[]) =>
    (_host: string) => Promise.resolve(addresses);

  it("DNS 解析到 IMDS 169.254.169.254 → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://evil.example.com/hook",
        false,
        mockLookup([{ address: "169.254.169.254", family: 4 }])
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 解析到私網 10.x → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://evil.example.com/hook",
        false,
        mockLookup([{ address: "10.0.0.1", family: 4 }])
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 解析到私網 192.168.x → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://rebind.example.com/",
        false,
        mockLookup([{ address: "192.168.1.1", family: 4 }])
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 解析到 IPv6 loopback ::1 → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://evil.example.com/hook",
        false,
        mockLookup([{ address: "::1", family: 6 }])
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 解析到 IPv4-mapped IPv6 私網地址 → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://evil.example.com/hook",
        false,
        mockLookup([{ address: "::ffff:169.254.169.254", family: 6 }])
      )
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 查詢失敗（NXDOMAIN 等）→ SsrfBlockedError（fail-closed）", async () => {
    const failLookup = (_host: string): Promise<LookupAddress[]> =>
      Promise.reject(new Error("ENOTFOUND"));
    await expect(
      assertSafeExternalUrlAsync("https://nxdomain.invalid/hook", false, failLookup)
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("DNS 解析到公網 IP → 通過", async () => {
    const parsed = await assertSafeExternalUrlAsync(
      "https://example.com/webhook",
      false,
      mockLookup([{ address: "93.184.216.34", family: 4 }])
    );
    expect(parsed.hostname).toBe("example.com");
  });

  it("IP-literal URL（10.0.0.1）→ sync 已擋，不呼叫 DNS", async () => {
    let dnsCalled = false;
    const spy = (_host: string): Promise<LookupAddress[]> => {
      dnsCalled = true;
      return Promise.resolve([]);
    };
    await expect(
      assertSafeExternalUrlAsync("https://10.0.0.1/", false, spy)
    ).rejects.toThrow(SsrfBlockedError);
    expect(dnsCalled).toBe(false);
  });

  it("多個 DNS 結果，其中一個是私網 → SsrfBlockedError", async () => {
    await expect(
      assertSafeExternalUrlAsync(
        "https://evil.example.com/hook",
        false,
        mockLookup([
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ])
      )
    ).rejects.toThrow(SsrfBlockedError);
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
