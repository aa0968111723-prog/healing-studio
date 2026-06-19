/**
 * secretCrypto — 對稱加密小工具，用於後端保存外部來源憑證（如 Notion API token）。
 * ────────────────────────────────────────────────────────────────────────────
 * AES-256-GCM；金鑰以 scrypt 從 CREDENTIAL_ENCRYPTION_KEY 導出，未設定時回退到
 * JWT_SECRET。回退時優先採用「未 trim 的原始值」JWT_SECRET_RAW（AIDV-59 follow-up）：
 * selfRepairEnv 只在偵測到前後空白時才設定 JWT_SECRET_RAW，否則它不存在 ⇒ 一般情況
 * 等同直接用 JWT_SECRET（無行為變化）；當密鑰帶空白時則用原值派生金鑰，與部署前一致，
 * 保住既有用 secretCrypto 加密的第三方憑證（如 Notion token）仍可解開。
 * 輸出格式：`v1:<ivB64>:<tagB64>:<cipherB64>`。
 *
 * 安全用途：credential 一律只在後端加密保存（data_source_connections
 * .encryptedCredentialRef），不進前端 / log / prompt。
 */

import crypto from "crypto";

const VERSION = "v1";
const SCRYPT_SALT = "healing-studio-cred-v1";
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM 建議 96-bit

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  // AIDV-59 follow-up：回退鏈優先用未 trim 的 JWT_SECRET_RAW，再退到 trim 後的
  // JWT_SECRET。JWT_SECRET_RAW 只在 selfRepairEnv 偵測到空白時才存在，故常態 =
  // JWT_SECRET（無行為變化）；密鑰帶空白時用原值 → 與部署前派生同一把 AES 金鑰，
  // 既有加密憑證不會因正規化（trim）而解不開。
  const secret =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    process.env.JWT_SECRET_RAW ||
    process.env.JWT_SECRET ||
    "";
  if (secret.length < 16) {
    throw new Error(
      "secretCrypto: 需要 CREDENTIAL_ENCRYPTION_KEY 或 JWT_SECRET（>=16 字元）才能加密憑證"
    );
  }
  cachedKey = crypto.scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  return cachedKey;
}

/** 加密明文憑證，回傳可存 DB 的字串。 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** 解密由 encryptSecret 產生的字串。格式錯誤或被竄改會 throw。 */
export function decryptSecret(ref: string): string {
  const parts = ref.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("secretCrypto: 無法辨識的憑證格式");
  }
  const [, ivB64, tagB64, cipherB64] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(cipherB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** 測試用：清掉快取金鑰（換 env 後重新導出）。 */
export function __resetSecretCryptoKeyForTests(): void {
  cachedKey = null;
}
