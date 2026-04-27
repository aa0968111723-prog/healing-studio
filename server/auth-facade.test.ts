/**
 * auth-facade.test.ts — Unit tests for AuthFacade
 *
 * Focuses on correctness of the userId returned from registerWithPassword
 * and the lastSignedIn update triggered by loginWithPassword.
 */

import { describe, expect, it, vi } from "vitest";

// Mock verifyPassword so login tests don't require a real scrypt hash
vi.mock("./services/auth/passwordHasher", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/auth/passwordHasher")>();
  return {
    ...real,
    verifyPassword: vi.fn().mockResolvedValue(true),
  };
});

import { AuthFacade } from "./services/auth/AuthFacade";
import { verifyPassword } from "./services/auth/passwordHasher";

// ── Minimal mock repo ──────────────────────────────────────────────────────

function makeRepo(overrides: Partial<ReturnType<typeof baseRepo>> = {}) {
  return { ...baseRepo(), ...overrides };
}

function baseRepo() {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    createLocalUser: vi.fn().mockResolvedValue(7), // DB insertId = 7
    setLocalPasswordByUserId: vi.fn().mockResolvedValue(undefined),
    updateLastSignedIn: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    updateUserName: vi.fn().mockResolvedValue(undefined),
  };
}

const mockHasherFactory = vi.fn().mockResolvedValue({
  hash: vi.fn().mockResolvedValue("hashed-password"),
  verify: vi.fn().mockResolvedValue(true),
  algorithm: "scrypt" as const,
});

const mockTokenIssuer = vi.fn().mockResolvedValue("jwt-token");

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AuthFacade.registerWithPassword", () => {
  it("returns the real insertId for a brand-new user", async () => {
    const repo = makeRepo();
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    const result = await facade.registerWithPassword({
      email: "new@example.com",
      password: "StrongP@ss1",
    });

    expect(result.userId).toBe(7); // insertId from createLocalUser
    expect(repo.createLocalUser).toHaveBeenCalledOnce();
  });

  it("returns the existing user's id when linking password to OAuth account", async () => {
    const existingUser = {
      id: 42,
      openId: "google-abc",
      name: "Existing User",
      email: "existing@example.com",
      role: "user" as const,
      loginMethod: "google",
      passwordHash: null, // no local password yet
      remainingGenerations: 100,
    };
    const repo = makeRepo({
      findByEmail: vi.fn().mockResolvedValue(existingUser),
    });
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    const result = await facade.registerWithPassword({
      email: "existing@example.com",
      password: "StrongP@ss1",
    });

    expect(result.userId).toBe(42);
    expect(repo.setLocalPasswordByUserId).toHaveBeenCalledOnce();
    expect(repo.createLocalUser).not.toHaveBeenCalled();
  });

  it("throws EMAIL_ALREADY_REGISTERED when user already has a password", async () => {
    const repo = makeRepo({
      findByEmail: vi.fn().mockResolvedValue({
        id: 10,
        passwordHash: "already-hashed",
      }),
    });
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    await expect(
      facade.registerWithPassword({ email: "dup@example.com", password: "StrongP@ss1" })
    ).rejects.toThrow("EMAIL_ALREADY_REGISTERED");
  });
});

describe("AuthFacade.loginWithPassword", () => {
  it("calls updateLastSignedIn after a successful login", async () => {
    const user = {
      id: 5,
      openId: "local:user@example.com",
      name: "Test",
      email: "user@example.com",
      role: "user" as const,
      loginMethod: "local",
      passwordHash: "scrypt$aabbcc$ddee",
      remainingGenerations: 50,
    };
    const repo = makeRepo({
      findByEmail: vi.fn().mockResolvedValue(user),
    });
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    await facade.loginWithPassword({ email: "user@example.com", password: "StrongP@ss1" });

    // updateLastSignedIn is fire-and-forget; give the microtask queue a tick
    await Promise.resolve();
    expect(repo.updateLastSignedIn).toHaveBeenCalledWith(5);
  });

  it("throws INVALID_CREDENTIALS when user not found", async () => {
    const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(null) });
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    await expect(
      facade.loginWithPassword({ email: "ghost@example.com", password: "AnyPass1!" })
    ).rejects.toThrow("INVALID_CREDENTIALS");
  });

  it("throws INVALID_CREDENTIALS when password is wrong", async () => {
    const user = {
      id: 3,
      openId: "local:u@example.com",
      name: null,
      email: "u@example.com",
      role: "user" as const,
      loginMethod: "local",
      passwordHash: "scrypt$aabbcc$ddee",
      remainingGenerations: 50,
    };
    // Make verifyPassword return false for this test
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);
    const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(user) });
    const facade = new AuthFacade({
      repo: repo as any,
      hasherFactory: mockHasherFactory,
      tokenIssuer: mockTokenIssuer,
    });

    await expect(
      facade.loginWithPassword({ email: "u@example.com", password: "WrongPass1!" })
    ).rejects.toThrow("INVALID_CREDENTIALS");
    expect(repo.updateLastSignedIn).not.toHaveBeenCalled();
  });
});
