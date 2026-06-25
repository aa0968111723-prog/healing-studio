/**
 * refresh-token-rotation.test.ts — AIDV-230 驗收契約
 *
 * 驗收條件：
 *   1. 登出後使用舊 token → isRefreshTokenActive 返回 false → 請求被拒（401）
 *   2. 使用 refresh token 換 access token 後，舊 token 立即失效（旋轉）
 *   3. revokeAllUserRefreshTokens 作廢該使用者所有 active tokens
 *
 * 純邏輯測試：不呼叫真實 DB，不啟動 Express。
 * 測試 refresh token rotation service 的核心狀態機。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ── 模擬 DB 層（in-memory）─────────────────────────────────────────────────

type TokenRecord = {
  tokenHash: string;
  userId: number;
  status: "active" | "revoked";
  expiresAt: Date;
};

function makeInMemoryTokenStore() {
  const store = new Map<string, TokenRecord>();

  return {
    store,

    async insertRefreshToken(data: {
      tokenHash: string;
      userId: number;
      expiresAt: Date;
    }): Promise<void> {
      store.set(data.tokenHash, {
        tokenHash: data.tokenHash,
        userId: data.userId,
        status: "active",
        expiresAt: data.expiresAt,
      });
    },

    async revokeRefreshToken(tokenHash: string): Promise<void> {
      const rec = store.get(tokenHash);
      if (rec) rec.status = "revoked";
    },

    async revokeAllUserRefreshTokens(userId: number): Promise<void> {
      for (const rec of store.values()) {
        if (rec.userId === userId && rec.status === "active") {
          rec.status = "revoked";
        }
      }
    },

    async isRefreshTokenActive(tokenHash: string): Promise<boolean> {
      const rec = store.get(tokenHash);
      if (!rec) return false;
      if (rec.status !== "active") return false;
      if (rec.expiresAt < new Date()) return false;
      return true;
    },
  };
}

// ── 模擬 hashSessionToken ───────────────────────────────────────────────────

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── 模擬 rotation service（複製自 localAuth refresh endpoint 邏輯）──────────

type RotationResult =
  | { success: true; newToken: string }
  | { success: false; error: string; status: 401 | 403 };

let _rotationCounter = 0;

async function rotateToken(
  oldToken: string,
  userId: number,
  deps: ReturnType<typeof makeInMemoryTokenStore>
): Promise<RotationResult> {
  const oldHash = hashSessionToken(oldToken);
  const active = await deps.isRefreshTokenActive(oldHash);
  if (!active) {
    return { success: false, error: "Token has been revoked", status: 401 };
  }

  // Issue new token (simulated — counter ensures uniqueness across rapid calls)
  const newToken = `new-token-for-${userId}-${++_rotationCounter}`;
  const newHash = hashSessionToken(newToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await Promise.all([
    deps.revokeRefreshToken(oldHash),
    deps.insertRefreshToken({ tokenHash: newHash, userId, expiresAt }),
  ]);

  return { success: true, newToken };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AIDV-230: server-side revocation — revokeRefreshToken", () => {
  it("active token is initially active", async () => {
    const db = makeInMemoryTokenStore();
    const token = "session-jwt-abc123";
    const hash = hashSessionToken(token);
    await db.insertRefreshToken({
      tokenHash: hash,
      userId: 1,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(await db.isRefreshTokenActive(hash)).toBe(true);
  });

  it("revoked token is no longer active", async () => {
    const db = makeInMemoryTokenStore();
    const token = "session-jwt-abc123";
    const hash = hashSessionToken(token);
    await db.insertRefreshToken({
      tokenHash: hash,
      userId: 1,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await db.revokeRefreshToken(hash);
    expect(await db.isRefreshTokenActive(hash)).toBe(false);
  });

  it("unknown token hash returns false (not active)", async () => {
    const db = makeInMemoryTokenStore();
    const unknownHash = hashSessionToken("never-inserted");
    expect(await db.isRefreshTokenActive(unknownHash)).toBe(false);
  });

  it("expired token returns false even if status=active", async () => {
    const db = makeInMemoryTokenStore();
    const token = "expired-token";
    const hash = hashSessionToken(token);
    // Insert with expiry in the past
    await db.insertRefreshToken({
      tokenHash: hash,
      userId: 2,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await db.isRefreshTokenActive(hash)).toBe(false);
  });
});

describe("AIDV-230: server-side revocation — revokeAllUserRefreshTokens (logout)", () => {
  it("logout revokes all active tokens for that user", async () => {
    const db = makeInMemoryTokenStore();
    const userId = 42;
    const expiresAt = new Date(Date.now() + 86400_000);

    const hash1 = hashSessionToken("token-session-1");
    const hash2 = hashSessionToken("token-session-2");
    await db.insertRefreshToken({ tokenHash: hash1, userId, expiresAt });
    await db.insertRefreshToken({ tokenHash: hash2, userId, expiresAt });

    await db.revokeAllUserRefreshTokens(userId);

    expect(await db.isRefreshTokenActive(hash1)).toBe(false);
    expect(await db.isRefreshTokenActive(hash2)).toBe(false);
  });

  it("revoking user A tokens does not affect user B tokens", async () => {
    const db = makeInMemoryTokenStore();
    const expiresAt = new Date(Date.now() + 86400_000);

    const hashA = hashSessionToken("token-userA");
    const hashB = hashSessionToken("token-userB");
    await db.insertRefreshToken({ tokenHash: hashA, userId: 1, expiresAt });
    await db.insertRefreshToken({ tokenHash: hashB, userId: 2, expiresAt });

    await db.revokeAllUserRefreshTokens(1);

    expect(await db.isRefreshTokenActive(hashA)).toBe(false);
    expect(await db.isRefreshTokenActive(hashB)).toBe(true);
  });
});

describe("AIDV-230: token rotation — POST /api/auth/refresh semantics", () => {
  it("rotation returns new token and old token becomes inactive", async () => {
    const db = makeInMemoryTokenStore();
    const userId = 5;
    const oldToken = "old-session-token";
    const oldHash = hashSessionToken(oldToken);
    await db.insertRefreshToken({
      tokenHash: oldHash,
      userId,
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const result = await rotateToken(oldToken, userId, db);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Old token must be revoked
    expect(await db.isRefreshTokenActive(oldHash)).toBe(false);

    // New token must be active
    const newHash = hashSessionToken(result.newToken);
    expect(await db.isRefreshTokenActive(newHash)).toBe(true);
  });

  it("re-using an already-rotated token is rejected (replay attack)", async () => {
    const db = makeInMemoryTokenStore();
    const userId = 6;
    const oldToken = "once-valid-token";
    const oldHash = hashSessionToken(oldToken);
    await db.insertRefreshToken({
      tokenHash: oldHash,
      userId,
      expiresAt: new Date(Date.now() + 86400_000),
    });

    // First rotation — succeeds
    await rotateToken(oldToken, userId, db);

    // Replay the old token — must be rejected
    const replayResult = await rotateToken(oldToken, userId, db);
    expect(replayResult.success).toBe(false);
    if (!replayResult.success) {
      expect(replayResult.status).toBe(401);
    }
  });

  it("using a revoked token (post-logout) is rejected with 401", async () => {
    const db = makeInMemoryTokenStore();
    const userId = 7;
    const token = "logout-then-replay";
    const hash = hashSessionToken(token);
    await db.insertRefreshToken({
      tokenHash: hash,
      userId,
      expiresAt: new Date(Date.now() + 86400_000),
    });

    // Simulate logout — revoke all user tokens
    await db.revokeAllUserRefreshTokens(userId);

    // Attempt to use the token after logout
    const result = await rotateToken(token, userId, db);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(401);
    }
  });

  it("each rotation produces a distinct new token", async () => {
    const db = makeInMemoryTokenStore();
    const userId = 8;
    const expiresAt = new Date(Date.now() + 86400_000);

    const tokenA = "original-token";
    await db.insertRefreshToken({ tokenHash: hashSessionToken(tokenA), userId, expiresAt });

    const result1 = await rotateToken(tokenA, userId, db);
    expect(result1.success).toBe(true);
    if (!result1.success) return;

    // Insert result1.newToken into DB as would happen in real flow
    await db.insertRefreshToken({
      tokenHash: hashSessionToken(result1.newToken),
      userId,
      expiresAt,
    });

    const result2 = await rotateToken(result1.newToken, userId, db);
    expect(result2.success).toBe(true);
    if (!result2.success) return;

    expect(result1.newToken).not.toBe(result2.newToken);
  });
});

describe("AIDV-230: hashSessionToken — deterministic and distinct", () => {
  it("same input always produces same hash", () => {
    const token = "fixed-jwt-string";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("different tokens produce different hashes", () => {
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });

  it("hash is a 64-char hex string (SHA-256)", () => {
    const h = hashSessionToken("any-token");
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });
});
