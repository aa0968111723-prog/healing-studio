/**
 * secretCrypto — 對稱加密小工具，用於後端保存外部來源憑證（如 Notion API token）。
 * ────────────────────────────────────────────────────────────────────────────
 * AES-256-GCM；金鑰以 scrypt 從以下來源導出（優先序）：
 *   1. CREDENTIAL_ENCRYPTION_KEY_<keyId>（指定版本金鑰）
 *   2. CREDENTIAL_ENCRYPTION_KEY（主要/預設金鑰，對應 keyId "k1"）
 *   3. JWT_SECRET_RAW（AIDV-59 follow-up：帶空白時用未 trim 原值）
 *   4. JWT_SECRET（最後回退）
 *
 * 輸出格式：
 *   v2:<keyId>:<ivB64>:<tagB64>:<cipherB64>  ← 新格式（AIDV-68 key versioning）
 *   v1:<ivB64>:<tagB64>:<cipherB64>           ← 舊格式（向下相容，解密用 k1 金鑰）
 *
 * 金鑰版本化（AIDV-68）：
 *   - 加密時：以 CREDENTIAL_ENCRYPTION_KEY_ACTIVE（預設 "k1"）指定金鑰 ID
 *   - 舊 v1 密文：解密時自動對應 k1 金鑰（向下相容，零停機輪替）
 *   - 金鑰輪替步驟：
 *       1. Railway 設 CREDENTIAL_ENCRYPTION_KEY_k2=<新金鑰>
 *       2. Railway 設 CREDENTIAL_ENCRYPTION_KEY_ACTIVE=k2
 *       3. 部署後新資料用 k2，舊 k1 資料仍可正常解密
 *
 * 安全用途：credential 一律只在後端加密保存（data_source_connections
 * .encryptedCredentialRef），不進前端 / log / prompt。
 */

import crypto from "crypto";

const SCRYPT_SALT = "healing-studio-cred-v1";
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM 建議 96-bit

/** keyId → derived AES key cache */
const keyCache = new Map<string, Buffer>();

function resolveKeyMaterial(keyId: string): string {
  if (keyId !== "k1") {
    // named key: CREDENTIAL_ENCRYPTION_KEY_<keyId>
    const named = process.env[`CREDENTIAL_ENCRYPTION_KEY_${keyId}`] ?? "";
    if (named.length >= 16) return named;
    throw new Error(
      `secretCrypto: key "${keyId}" 需要 CREDENTIAL_ENCRYPTION_KEY_${keyId}（>=16 字元）`
    );
  }
  // k1: CREDENTIAL_ENCRYPTION_KEY → JWT_SECRET_RAW → JWT_SECRET
  return (
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    process.env.JWT_SECRET_RAW ||
    process.env.JWT_SECRET ||
    ""
  );
}

function getKeyById(keyId: string): Buffer {
  const cached = keyCache.get(keyId);
  if (cached) return cached;

  const secret = resolveKeyMaterial(keyId);
  if (secret.length < 16) {
    throw new Error(
      "secretCrypto: 需要 CREDENTIAL_ENCRYPTION_KEY 或 JWT_SECRET（>=16 字元）才能加密憑證"
    );
  }

  const key = crypto.scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  keyCache.set(keyId, key);
  return key;
}

/** 加密明文憑證，回傳可存 DB 的字串（v2:<keyId>:<iv>:<tag>:<cipher>）。 */
export function encryptSecret(plaintext: string): string {
  const keyId = process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE ?? "k1";
  const key = getKeyById(keyId);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v2:${keyId}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** 解密由 encryptSecret 產生的字串。格式錯誤或被竄改會 throw。 */
export function decryptSecret(ref: string): string {
  const parts = ref.split(":");

  // Legacy v1 format: v1:ivB64:tagB64:cipherB64
  if (parts[0] === "v1" && parts.length === 4) {
    const [, ivB64, tagB64, cipherB64] = parts;
    const key = getKeyById("k1");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // v2 format: v2:keyId:ivB64:tagB64:cipherB64
  if (parts[0] === "v2" && parts.length === 5) {
    const [, keyId, ivB64, tagB64, cipherB64] = parts;
    const key = getKeyById(keyId);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  throw new Error("secretCrypto: 無法辨識的憑證格式");
}

/** 測試用：清掉快取金鑰（換 env 後重新導出）。 */
export function __resetSecretCryptoKeyForTests(): void {
  keyCache.clear();
}
