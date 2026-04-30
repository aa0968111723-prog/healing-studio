import { describe, it, expect } from "vitest";
import {
  buildOtpAuthUri,
  generateBase32Secret,
  generateTotp,
  verifyTotp,
} from "./services/auth/totpService";

describe("totpService", () => {
  it("generates 32-character base32 secrets by default", () => {
    const s = generateBase32Secret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBe(32);
  });

  it("verifies a freshly generated token", () => {
    const secret = generateBase32Secret();
    const token = generateTotp(secret);
    expect(verifyTotp(secret, token)).toBe(true);
  });

  it("accepts tokens within ±1 step (clock drift)", () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    const previousStep = now - 30_000;
    const nextStep = now + 30_000;
    const tokenAtNow = generateTotp(secret, now);
    expect(verifyTotp(secret, tokenAtNow, previousStep)).toBe(true);
    expect(verifyTotp(secret, tokenAtNow, nextStep)).toBe(true);
  });

  it("rejects tokens outside the tolerance window", () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    const tokenAtNow = generateTotp(secret, now);
    // ±2 steps = 60s away → should fail
    expect(verifyTotp(secret, tokenAtNow, now + 90_000)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    const secret = generateBase32Secret();
    expect(verifyTotp(secret, "")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
  });

  it("matches RFC 6238 reference vector for ASCII secret '12345678901234567890' at T=59", () => {
    // RFC 6238 Appendix B uses ASCII '12345678901234567890' as the secret.
    // Base32 encoding of those 20 bytes:
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    // T0=0, X=30s; T=59 → counter=1 → SHA1 expected token = "287082"
    const token = generateTotp(secret, 59 * 1000);
    expect(token).toBe("287082");
  });

  it("builds an otpauth URI with the expected params", () => {
    const uri = buildOtpAuthUri({
      secret: "JBSWY3DPEHPK3PXP",
      account: "alice@example.com",
    });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Healing+Studio");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
