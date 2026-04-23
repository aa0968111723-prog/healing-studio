import { describe, expect, it } from "vitest";
import { getPasswordHasher } from "./services/auth/passwordHasher";

describe("passwordHasher", () => {
  it("hashes and verifies password with fallback implementation", async () => {
    const hasher = await getPasswordHasher("scrypt");
    const hash = await hasher.hash("strong-pass-123");

    expect(hash).toContain("$");
    await expect(hasher.verify("strong-pass-123", hash)).resolves.toBe(true);
    await expect(hasher.verify("wrong", hash)).resolves.toBe(false);
  });
});
