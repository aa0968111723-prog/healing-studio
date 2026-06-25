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
import { decodeJwt, SignJWT } from "jose";
import {
  assertJwtSecretReady,
  createSessionToken,
  verifySessionToken,
  MIN_JWT_SECRET_LENGTH,
  JWT_AUDIENCE,
} from "./_core/googleAuth";

const STRONG_SECRET = "this-is-a-strong-secret-0123456789"; // 34 chars

let savedJwt: string | undefined;
let savedAuth: string | undefined;
let savedNodeEnv: string | undefined;
let savedJwtRaw: string | undefined;

beforeEach(() => {
  savedJwt = process.env.JWT_SECRET;
  savedAuth = process.env.AUTH_SECRET;
  savedNodeEnv = process.env.NODE_ENV;
  savedJwtRaw = process.env.JWT_SECRET_RAW;
});

afterEach(() => {
  if (savedJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedJwt;
  if (savedAuth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedAuth;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedJwtRaw === undefined) delete process.env.JWT_SECRET_RAW;
  else process.env.JWT_SECRET_RAW = savedJwtRaw;
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

  it("C1: default expiry == 30 days, NOT 1 year (真正測 createSessionToken 內建預設)", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    // AIDV-59：不傳 expiresInMs → 必須命中 createSessionToken 自身的預設值（已改為
    // THIRTY_DAYS_MS）。此測試真正鎖住簽章邊界的安全短壽命，而非測「自己傳的值」。
    const token = await createSessionToken("sub-c1", { name: "Tester" });
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

  // AIDV-59：密鑰正規化（trim）前後不一致的相容路徑 —— 舊版（main）以「未 trim 原值」簽，
  // 新版以「trim 後值」驗。selfRepairEnv 把原值留在 JWT_SECRET_RAW，驗證失敗時 fallback 原值。
  it("D3: 舊 token 以未 trim 密鑰簽、以 trim 後密鑰驗 → 不應因正規化而失效", async () => {
    process.env.NODE_ENV = "production";
    const RAW_WITH_WS = `${STRONG_SECRET}\n`; // 帶尾端換行（複製貼上常見）
    // (1) 模擬「舊版」：用未 trim 的原值簽一個 token（jose 直接簽，繞過新版簽章路徑）。
    const legacyToken = await new SignJWT({ sub: "ws-legacy", name: "WS" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("365d")
      .sign(new TextEncoder().encode(RAW_WITH_WS));
    // (2) 模擬 selfRepairEnv 集中正規化後的狀態：JWT_SECRET 已 trim，原值留在 JWT_SECRET_RAW。
    process.env.JWT_SECRET = STRONG_SECRET; // trim 後值
    process.env.JWT_SECRET_RAW = RAW_WITH_WS; // 未 trim 原值（fallback 用）
    // (3) 新版以 trim 後值驗失敗 → fallback 用 RAW → 仍通過，既有 session 不失效。
    const payload = await verifySessionToken(legacyToken);
    expect(payload?.sub).toBe("ws-legacy");
  });

  it("D4: 無 JWT_SECRET_RAW（常態：密鑰本就無空白）時，錯密鑰簽的 token 仍被拒", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    delete process.env.JWT_SECRET_RAW;
    const foreign = await new SignJWT({ sub: "evil", name: "X" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("365d")
      .sign(new TextEncoder().encode("a-completely-unrelated-secret-key-00"));
    expect(await verifySessionToken(foreign)).toBeNull();
  });
});

// ── E. AIDV-319：JWT audience（aud）驗證 ────────────────────────────────────
describe("E. JWT audience (aud) verification — AIDV-319", () => {
  it("E1: 新發 token 帶 aud = JWT_AUDIENCE", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-e1", { name: "Tester" });
    const { aud } = decodeJwt(token);
    expect(aud).toBe(JWT_AUDIENCE);
  });

  it("E2: 含正確 aud 的新 token 可通過驗證", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const token = await createSessionToken("sub-e2", { name: "Tester" });
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("sub-e2");
  });

  it("E3: 不含 aud 的舊 token 仍可驗證（過渡相容，防大規模登出）", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    // 模擬 AIDV-319 上線前簽發的舊 token（無 aud 欄位）
    const legacyToken = await new SignJWT({ sub: "sub-legacy", name: "Legacy" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(STRONG_SECRET));
    const payload = await verifySessionToken(legacyToken);
    expect(payload?.sub).toBe("sub-legacy");
  });

  it("E4: 含錯誤 aud 的 token 被拒絕（非本站 token）", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const badAudToken = await new SignJWT({ sub: "sub-bad-aud", name: "Attacker" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .setAudience("other-service")
      .sign(new TextEncoder().encode(STRONG_SECRET));
    expect(await verifySessionToken(badAudToken)).toBeNull();
  });

  it("E5: 不同密鑰簽的 token（即便含正確 aud）被拒絕", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_SECRET;
    const foreignToken = await new SignJWT({ sub: "sub-foreign", name: "Attacker" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .setAudience(JWT_AUDIENCE)
      .sign(new TextEncoder().encode("a-completely-different-secret-for-other-svc"));
    expect(await verifySessionToken(foreignToken)).toBeNull();
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
