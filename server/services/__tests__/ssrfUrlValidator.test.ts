/**
 * ssrfUrlValidator.test.ts — AIDV-259 SSRF allowlist coverage
 *
 * Tests `assertSafeUrl` from server/lib/urlValidator.ts against all
 * major attack vectors: private IPs, loopback, IMDS, bad protocols,
 * non-allowlist hosts, and IPv6 variations.
 */
import { describe, it, expect } from "vitest";
import { assertSafeUrl, UrlNotAllowedError } from "../../lib/urlValidator";

function blocks(url: string) {
  expect(() => assertSafeUrl(url)).toThrow(UrlNotAllowedError);
}

function passes(url: string) {
  expect(() => assertSafeUrl(url)).not.toThrow();
}

describe("assertSafeUrl — allowed hosts", () => {
  it("passes fal.ai CDN URLs", () => {
    passes("https://fal.ai/cdn/image.png");
    passes("https://v3.fal.run/result/abc");
    passes("https://cdn.fal.ai/video.mp4");
  });

  it("passes storage.googleapis.com", () => {
    passes("https://storage.googleapis.com/bucket/file.mp4");
  });

  it("passes R2 / CloudFront CDN", () => {
    passes("https://pub-abc123.r2.dev/file.jpg");
    passes("https://d1abc.cloudfront.net/image.png");
  });

  it("passes S3 origins", () => {
    passes("https://my-bucket.s3.us-east-1.amazonaws.com/file.mp4");
    passes("https://s3.amazonaws.com/bucket/file");
  });
});

describe("assertSafeUrl — private IPv4", () => {
  it("blocks 10.x.x.x", () => {
    blocks("https://10.0.0.1/secret");
    blocks("https://10.255.255.255/secret");
  });

  it("blocks 172.16-31.x.x", () => {
    blocks("https://172.16.0.1/secret");
    blocks("https://172.31.255.255/secret");
  });

  it("blocks 192.168.x.x", () => {
    blocks("https://192.168.1.1/secret");
  });

  it("blocks 127.x.x.x (entire /8 not just .1)", () => {
    blocks("https://127.0.0.1/secret");
    blocks("https://127.0.0.2/secret");
    blocks("https://127.1.2.3/secret");
  });

  it("blocks 169.254.x.x (IMDS / link-local)", () => {
    blocks("https://169.254.169.254/latest/meta-data/");
    blocks("https://169.254.0.1/");
  });

  it("blocks 0.x.x.x", () => {
    blocks("https://0.0.0.0/secret");
  });

  it("blocks CGNAT 100.64-127.x.x", () => {
    blocks("https://100.64.0.1/secret");
    blocks("https://100.127.255.255/secret");
  });
});

describe("assertSafeUrl — IPv6 loopback and ULA", () => {
  it("blocks ::1 loopback", () => {
    blocks("https://[::1]/secret");
  });

  it("blocks fc/fd ULA ranges", () => {
    blocks("https://[fc00::1]/secret");
    blocks("https://[fd12:3456::1]/secret");
  });

  it("blocks fe80:: link-local", () => {
    blocks("https://[fe80::1]/secret");
  });

  it("blocks IPv4-mapped IPv6 pointing to private IP", () => {
    blocks("https://[::ffff:10.0.0.1]/secret");
    blocks("https://[::ffff:192.168.0.1]/secret");
    blocks("https://[::ffff:127.0.0.1]/secret");
  });
});

describe("assertSafeUrl — protocol enforcement", () => {
  it("blocks plain http", () => {
    blocks("http://fal.ai/image.png");
  });

  it("blocks data: URI", () => {
    blocks("data:text/html,<script>alert(1)</script>");
  });

  it("blocks javascript: URI", () => {
    blocks("javascript:alert(1)");
  });

  it("blocks ftp:", () => {
    blocks("ftp://fal.ai/file");
  });
});

describe("assertSafeUrl — allowlist enforcement", () => {
  it("blocks non-allowlist external domain", () => {
    blocks("https://evil.com/payload");
    blocks("https://attacker.example.com/ssrf");
    blocks("https://google.com/secret");
  });

  it("blocks nip.io tricks (resolves to private IP but wrong host format)", () => {
    // e.g. 10.0.0.1.nip.io would pass IP check but fails allowlist
    blocks("https://10.0.0.1.nip.io/secret");
  });

  it("blocks subdomain that looks like allowlist host but isn't", () => {
    blocks("https://evil.fal.ai.attacker.com/secret");
    blocks("https://notfal.ai/secret");
  });
});

describe("assertSafeUrl — bare IP not in allowlist", () => {
  it("blocks bare public IP (not in allowlist)", () => {
    blocks("https://8.8.8.8/secret");
    blocks("https://1.1.1.1/secret");
  });
});

describe("assertSafeUrl — invalid inputs", () => {
  it("blocks empty string", () => {
    blocks("");
  });

  it("blocks malformed URL", () => {
    blocks("not-a-url");
    blocks("//no-scheme");
  });
});

describe("assertSafeUrl — allowInsecureHosts (test mode)", () => {
  it("allows localhost in test mode", () => {
    expect(() => assertSafeUrl("http://localhost:3000/test", true)).not.toThrow();
  });

  it("allows 127.0.0.1 in test mode", () => {
    expect(() => assertSafeUrl("http://127.0.0.1:3000/test", true)).not.toThrow();
  });
});
