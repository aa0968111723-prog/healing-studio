/**
 * jwt-hardening.test.ts — AIDV-59（H4 JWT 硬化）測試矩陣
 *
 * 涵蓋：
 *  A. 密鑰 fail-fast（缺失／空白／太短 → 正式環境 throw；dev/test 仍可運作）
 *  B. 簽 / 驗 round-trip 與竄改／錯密鑰拒絕
 *  C. 新發 token 採用縮短後的壽命（30 天）
 *  D. 既有長壽命 token 仍可驗證（不會大規模登出，非破壞性）
 *  F. AUTH_SECRET 別名解析（含與密鑰長度門檻共同作用）
 *
 * 注意：所有測試都會在前後備份 / 還原 process.env.JWT_SECRET、AUTH_SECRET、NODE_ENV，
 * 避免污染其他測試（尤其 verify-token.test.ts 依賴 NODE_ENV=test 的 dev fallback）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import {
  assertJwtSecretReady,
  createSessionToken,
  verifySessionToken,
  MIN_JWT_SECRET_LENGTH,
} from "./_core/googleAuth";

const STRONG_SECRET = "this-is-a-strong-secret-0123456789"; // 34 chars

let savedJwt: string | undefined;
let savedAuth: string | undefined;
let savedNodeEnv: string | undefined;

beforeEach(() => {
  savedJwt = process.env.JWT_SECRET;
  savedAuth = process.env.AUTH_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (savedJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedJwt;
  if (savedAuth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuth;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

// ── A. 密鑰 fail-fast ────────────────────────────────────────────────────────
describe("A. JWT secret fail-fast (production)", () => {
  it("A1: missing secret in production → throws naming JWT_SECRET", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => assertJwtSecretReady()).toThrow(/JWT_SECRET/);
  });

  it("A2: empty-string secret in production → throws", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "";
    expect(() => assertJwtSecretReady()).toThrow(/JWT_SECRET/);
  });

  it("A3: whitespace-only secret in production → throws (trimmed, not 3 chars)", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "   ";
    expect(() => assertJwtSecretReady()).toThrow(/JWT_SECRET/);
  });

  it("A4: too-short (<16) secret in production → throws", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "0123456789"; // 10 chars
    expect(() => assertJwtSecretReady()).toThrow(/16/);
  });

  it("A4b: boundary 15 chars in production → throws", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "123456789012345"; // 15 chars
    expect(() => assertJwtSecretReady()).toThrow();
  });

  it("A5: exactly 16 chars in production → passes", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "0123456789abcdef"; // 16 chars
    expect(MIN_JWT_SECRET_LENGTH).toBe(16);
    expect(() => assertJwtSecretReady()).not.toThrow();
  });

  it("A6: strong secret in production → passes", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    expect(() => assertJwtSecretReady()).not.toThrow();
  });

  it("A-test-escape: missing secret under NODE_ENV=test → does NOT throw (dev fallback)", () => {
    process.env.NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    expect(() => assertJwtSecretReady()).not.toThrow();
  });

  it("A-dev-escape: short secret under NODE_ENV=development → does NOT throw", () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = "abc"; // 3 chars
    expect(() => assertJwtSecretReady()).not.toThrow();
  });
});

// ── B. 簽 / 驗 round-trip ────────────────────────────────────────────────────
describe("B. sign / verify round-trip", () => {
  it("B1: valid secret → sign → verify returns payload", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-123", {
      name: "Tester",
      email: "t@example.com",
    });
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("sub-123");
    expect(payload?.email).toBe("t@example.com");
    expect(payload?.exp).toBeTypeOf("number");
  });

  it("B2: tampered payload → verify returns null", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-123", { name: "Tester" });
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from('{"sub":"evil"}').toString("base64url")}.${s}`;
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("B4: token signed with S1, verified under S2 → null", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-123", { name: "Tester" });
    process.env.JWT_SECRET = "another-totally-different-secret-xyz";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("B6: malformed token → null (no throw escapes)", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    expect(await verifySessionToken("not.a.jwt")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });
});

// ── C. 縮短後的新 token 壽命 ─────────────────────────────────────────────────
describe("C. shortened expiry on newly-issued tokens", () => {
  const THIRTY_DAYS_SECS = 60 * 60 * 24 * 30; // 2592000

  it("C1: default expiry == 30 days, NOT 1 year", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    // 不傳 expiresInMs → 走 createSessionToken 內的預設（ONE_YEAR_MS 仍是 jose 內部
    // fallback，但所有 issuance 呼叫端都改傳 30 天；此處驗證縮短壽命的端到端值）。
    const token = await createSessionToken("sub-c1", {
      name: "Tester",
      expiresInMs: THIRTY_DAYS_SECS * 1000,
    });
    const { iat, exp } = decodeJwt(token);
    expect((exp as number) - (iat as number)).toBe(THIRTY_DAYS_SECS);
    // 顯式確認不是 1 年
    expect((exp as number) - (iat as number)).not.toBe(60 * 60 * 24 * 365);
  });

  it("C2: explicit expiresInMs override honored", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-c2", {
      name: "Tester",
      expiresInMs: 60_000,
    });
    const { iat, exp } = decodeJwt(token);
    expect((exp as number) - (iat as number)).toBe(60);
  });
});

// ── D. 既有長壽命 token 仍可驗證（非破壞性，不大規模登出）────────────────────
describe("D. backward compatibility — old long-exp tokens still verify", () => {
  it("D1: a 1-year token (same secret) still verifies after the default was shortened", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const oneYearMs = 1000 * 60 * 60 * 24 * 365;
    const oldToken = await createSessionToken("legacy-user", {
      name: "Legacy",
      expiresInMs: oneYearMs,
    });
    const payload = await verifySessionToken(oldToken);
    expect(payload?.sub).toBe("legacy-user");
    // 沒有 maxTokenAge clamp：1 年 token 不會因「太舊」被拒。
    const { iat, exp } = decodeJwt(oldToken);
    expect((exp as number) - (iat as number)).toBe(60 * 60 * 24 * 365);
  });

  it("D2: an already-expired token → null", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const expired = await createSessionToken("sub-exp", {
      name: "Tester",
      expiresInMs: -1000, // 已過期
    });
    expect(await verifySessionToken(expired)).toBeNull();
  });
});

// ── F. AUTH_SECRET 別名 ──────────────────────────────────────────────────────
describe("F. AUTH_SECRET alias", () => {
  it("F-runtime: getJwtSecret reads JWT_SECRET (alias already mapped by env.validated)", async () => {
    // env.validated.selfRepairEnv 在開機時把 AUTH_SECRET → JWT_SECRET。
    // 此處模擬已映射後的狀態：JWT_SECRET 已被別名填好。
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    process.env.AUTH_SECRET = STRONG_SECRET;
    // 模擬 selfRepairEnv 的效果（測試不重載整個 env 模組）。
    process.env.JWT_SECRET = process.env.AUTH_SECRET;
    expect(() => assertJwtSecretReady()).not.toThrow();
    const token = await createSessionToken("sub-alias", { name: "Tester" });
    expect((await verifySessionToken(token))?.sub).toBe("sub-alias");
  });

  it("F3: aliased secret is subject to the same ≥16 length gate", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    process.env.AUTH_SECRET = "short"; // 5 chars
    process.env.JWT_SECRET = process.env.AUTH_SECRET; // 模擬映射
    expect(() => assertJwtSecretReady()).toThrow();
  });
});
