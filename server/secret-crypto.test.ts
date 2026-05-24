/**
 * secret-crypto.test.ts — 憑證對稱加密 round-trip 與竄改偵測。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  __resetSecretCryptoKeyForTests,
} from "./_core/secretCrypto";

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-please-rotate";
  __resetSecretCryptoKeyForTests();
});

describe("secretCrypto", () => {
  it("round-trips a secret", () => {
    const plain = "secret_notion_token_abc123";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("rejects a tampered ciphertext", () => {
    const enc = encryptSecret("dont-touch");
    const parts = enc.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("evil").toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects an unrecognized format", () => {
    expect(() => decryptSecret("not-a-valid-ref")).toThrow();
  });
});
