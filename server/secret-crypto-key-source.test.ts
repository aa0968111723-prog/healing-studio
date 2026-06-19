/**
 * secret-crypto-key-source.test.ts — AIDV-59 follow-up（憑證加密金鑰來源相容性）
 *
 * 背景：AIDV-59 在 env.validated.selfRepairEnv() 集中對 JWT_SECRET 做 trim 正規化，
 * 並把未 trim 的原值保留於 JWT_SECRET_RAW。secretCrypto 在缺少 CREDENTIAL_ENCRYPTION_KEY
 * 時以 JWT_SECRET 作為加密金鑰 fallback；若正式環境的 JWT_SECRET 帶前後空白，部署後改用
 * 「trim 後值」派生的 AES 金鑰會與部署前（未 trim）不同 → 既有用 secretCrypto 加密的第三方
 * 憑證（如 Notion token）解不開。
 *
 * 本修補把回退鏈改為：CREDENTIAL_ENCRYPTION_KEY → JWT_SECRET_RAW → JWT_SECRET。
 * 本測試鎖住三件事：
 *   1. 帶空白時：用未 trim 原值（JWT_SECRET_RAW）派生金鑰 → 解得開部署前的密文。
 *   2. 回歸對照：若仍只用 trim 後的 JWT_SECRET，部署前密文會解不開（證明修補有必要）。
 *   3. 常態（無空白、無 RAW）：round-trip 正常，無行為變化。
 *   4. CREDENTIAL_ENCRYPTION_KEY 仍優先於 JWT_SECRET_RAW / JWT_SECRET。
 *
 * 注意：所有測試前後備份 / 還原相關 env，並以 __resetSecretCryptoKeyForTests() 清掉
 * 快取金鑰，避免 env 變更後仍沿用舊金鑰、或污染其他測試。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  __resetSecretCryptoKeyForTests,
} from "./_core/secretCrypto";

const STRONG_SECRET = "this-is-a-strong-cred-secret-0123456789"; // >=16 字元

let savedCredKey: string | undefined;
let savedJwt: string | undefined;
let savedJwtRaw: string | undefined;

beforeEach(() => {
  savedCredKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  savedJwt = process.env.JWT_SECRET;
  savedJwtRaw = process.env.JWT_SECRET_RAW;
  // 乾淨起點：三者皆清掉，避免被真實環境 / 其他測試污染。
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_SECRET_RAW;
  __resetSecretCryptoKeyForTests();
});

afterEach(() => {
  if (savedCredKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = savedCredKey;
  if (savedJwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedJwt;
  if (savedJwtRaw === undefined) delete process.env.JWT_SECRET_RAW;
  else process.env.JWT_SECRET_RAW = savedJwtRaw;
  __resetSecretCryptoKeyForTests();
});

describe("secretCrypto 金鑰來源相容性（AIDV-59 follow-up）", () => {
  it("帶空白的 JWT_SECRET：用未 trim 原值（JWT_SECRET_RAW）派生金鑰，能解開部署前加密的資料", () => {
    const RAW_WITH_WS = `  ${STRONG_SECRET}\n`; // 帶前後空白（複製貼上 / Railway 常見）

    // (1) 模擬「部署前」：當時 selfRepairEnv 尚未 trim，secretCrypto 直接以未 trim
    //     的 JWT_SECRET 派生金鑰並加密 Notion token（部署前沒有 JWT_SECRET_RAW）。
    process.env.JWT_SECRET = RAW_WITH_WS;
    delete process.env.JWT_SECRET_RAW;
    __resetSecretCryptoKeyForTests();
    const ciphertext = encryptSecret("notion-token-secret-value");

    // (2) 模擬「部署後」AIDV-59 + 本修補後的狀態：JWT_SECRET 已被 trim，原值留在
    //     JWT_SECRET_RAW。
    process.env.JWT_SECRET = STRONG_SECRET; // trim 後值
    process.env.JWT_SECRET_RAW = RAW_WITH_WS; // 未 trim 原值（fallback 用）
    __resetSecretCryptoKeyForTests();

    // (3) 修補後 getKey 優先採用 JWT_SECRET_RAW → 與部署前同一把 AES 金鑰 → 解得開。
    expect(decryptSecret(ciphertext)).toBe("notion-token-secret-value");
  });

  it("回歸對照：若僅以 trim 後的 JWT_SECRET 派生金鑰，部署前的密文會解不開（證明此修補確有必要）", () => {
    const RAW_WITH_WS = `  ${STRONG_SECRET}\n`;

    // 部署前以未 trim 原值加密。
    process.env.JWT_SECRET = RAW_WITH_WS;
    delete process.env.JWT_SECRET_RAW;
    __resetSecretCryptoKeyForTests();
    const ciphertext = encryptSecret("notion-token-secret-value");

    // 模擬「沒有 RAW fallback」的壞情況：只剩 trim 後值 → 派生不同金鑰 → GCM 驗證失敗。
    process.env.JWT_SECRET = STRONG_SECRET;
    delete process.env.JWT_SECRET_RAW;
    __resetSecretCryptoKeyForTests();
    expect(() => decryptSecret(ciphertext)).toThrow();
  });

  it("常態（JWT_SECRET 無空白、無 JWT_SECRET_RAW）：encrypt/decrypt round-trip 正常，無行為變化", () => {
    process.env.JWT_SECRET = STRONG_SECRET;
    delete process.env.JWT_SECRET_RAW;
    __resetSecretCryptoKeyForTests();
    const ciphertext = encryptSecret("hello-credential");
    expect(decryptSecret(ciphertext)).toBe("hello-credential");
  });

  it("CREDENTIAL_ENCRYPTION_KEY 仍優先於 JWT_SECRET_RAW / JWT_SECRET", () => {
    const DEDICATED = "dedicated-cred-key-0123456789abc"; // >=16 字元
    const RAW_WITH_WS = `  ${STRONG_SECRET}\n`;

    // 加密時三者都在 → 應採用 CREDENTIAL_ENCRYPTION_KEY。
    process.env.CREDENTIAL_ENCRYPTION_KEY = DEDICATED;
    process.env.JWT_SECRET = STRONG_SECRET;
    process.env.JWT_SECRET_RAW = RAW_WITH_WS;
    __resetSecretCryptoKeyForTests();
    const ciphertext = encryptSecret("under-dedicated-key");

    // 用同一把 dedicated key（移除 JWT_*）→ 仍解得開。
    delete process.env.JWT_SECRET;
    delete process.env.JWT_SECRET_RAW;
    __resetSecretCryptoKeyForTests();
    expect(decryptSecret(ciphertext)).toBe("under-dedicated-key");

    // 反證：改用 JWT_SECRET_RAW（移除 CREDENTIAL_ENCRYPTION_KEY）→ 不同金鑰 → 解不開，
    // 表示加密時用的確是 CREDENTIAL_ENCRYPTION_KEY 而非 RAW。
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.JWT_SECRET_RAW = RAW_WITH_WS;
    __resetSecretCryptoKeyForTests();
    expect(() => decryptSecret(ciphertext)).toThrow();
  });
});
