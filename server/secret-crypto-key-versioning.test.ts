/**
 * secret-crypto-key-versioning.test.ts — AIDV-68 key versioning
 *
 * 驗證三件事：
 *   1. 新格式 v2:<keyId>:... 能正確 encrypt/decrypt。
 *   2. 舊 v1:... 格式向下相容（現存資料不失效）。
 *   3. CREDENTIAL_ENCRYPTION_KEY_ACTIVE 切換後，新密文用新金鑰，舊密文仍可解。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  __resetSecretCryptoKeyForTests,
} from "./_core/secretCrypto";

const KEY_K1 = "key-k1-for-testing-aidv68-xxxxx";
const KEY_K2 = "key-k2-for-rotation-aidv68-xxxxx";

let savedCredKey: string | undefined;
let savedActive: string | undefined;
let savedK2: string | undefined;

beforeEach(() => {
  savedCredKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  savedActive = process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE;
  savedK2 = process.env.CREDENTIAL_ENCRYPTION_KEY_k2;
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_K1;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_k2;
  __resetSecretCryptoKeyForTests();
});

afterEach(() => {
  if (savedCredKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = savedCredKey;
  if (savedActive === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE;
  else process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE = savedActive;
  if (savedK2 === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY_k2;
  else process.env.CREDENTIAL_ENCRYPTION_KEY_k2 = savedK2;
  __resetSecretCryptoKeyForTests();
});

describe("secretCrypto key versioning (AIDV-68)", () => {
  it("預設 active=k1：輸出 v2:k1: 格式，round-trip 正常", () => {
    const enc = encryptSecret("notion-token-abc");
    expect(enc.startsWith("v2:k1:")).toBe(true);
    expect(decryptSecret(enc)).toBe("notion-token-abc");
  });

  it("切換 ACTIVE=k2：新密文用 k2 格式，舊 k1 密文仍可解", () => {
    // 用 k1 加密一筆舊資料
    const oldCipher = encryptSecret("old-data-under-k1");
    expect(oldCipher.startsWith("v2:k1:")).toBe(true);

    // 輪替：啟用 k2
    process.env.CREDENTIAL_ENCRYPTION_KEY_k2 = KEY_K2;
    process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE = "k2";
    __resetSecretCryptoKeyForTests();

    // 新資料用 k2
    const newCipher = encryptSecret("new-data-under-k2");
    expect(newCipher.startsWith("v2:k2:")).toBe(true);
    expect(decryptSecret(newCipher)).toBe("new-data-under-k2");

    // 舊 k1 資料仍可解（需要 k1 金鑰在 env）
    expect(decryptSecret(oldCipher)).toBe("old-data-under-k1");
  });

  it("向下相容：v1 legacy 格式仍可解密", () => {
    // 手工構造一個 v1 密文（與舊程式碼相同邏輯）
    // 直接呼叫 decryptSecret 解析 v1: 格式
    // 先用舊方式造一個（利用 KEY_K1 = CREDENTIAL_ENCRYPTION_KEY）：
    // v1 密文由舊版 encryptSecret 生成；我們直接測試 decryptSecret 接受 v1 格式
    const crypto = require("crypto");
    const key = crypto.scryptSync(KEY_K1, "healing-studio-cred-v1", 32);
    const iv = Buffer.from("AAAAAAAAAAAAAAAA", "base64"); // 固定 IV for test
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update("legacy-data", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const v1Ref = `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;

    expect(decryptSecret(v1Ref)).toBe("legacy-data");
  });

  it("無法辨識的格式 throw", () => {
    expect(() => decryptSecret("garbage")).toThrow();
    expect(() => decryptSecret("v3:x:y:z:w")).toThrow();
  });

  it("k2 金鑰不存在時 throw 有意義訊息", () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY_k2;
    process.env.CREDENTIAL_ENCRYPTION_KEY_ACTIVE = "k2";
    __resetSecretCryptoKeyForTests();
    expect(() => encryptSecret("data")).toThrow(/key "k2"/);
  });
});
