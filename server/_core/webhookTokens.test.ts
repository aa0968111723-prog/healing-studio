/**
 * webhookTokens.test.ts — AIDV-158
 *
 * 驗證 per-job capability token 的真實 HMAC 簽/驗（含新增的 'fal' scope 與
 * server-origin nonce 簽署），以及 token 強制是否隨 JWT_SECRET 啟用。
 *
 * env.validated 是 import-time singleton，所以以 vi.mock 提供固定的 serverEnv
 * 而非改 process.env（後者改不到已解析好的 serverEnv）。
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./env.validated", () => ({
  serverEnv: { JWT_SECRET: "unit-test-secret-32-chars-long-xxxxx" },
}));

import {
  signWebhookToken,
  verifyWebhookToken,
  isWebhookTokenEnforced,
  signFalWebhookNonce,
} from "./webhookTokens";

describe("webhookTokens（JWT_SECRET 已設＝enforced）", () => {
  it("isWebhookTokenEnforced 在有密鑰時為 true", () => {
    expect(isWebhookTokenEnforced()).toBe(true);
  });

  it("fal scope：簽出的 token 能被同 id 驗過、錯 id / 錯 token 驗不過", () => {
    const token = signWebhookToken("fal", 42);
    expect(typeof token).toBe("string");
    expect(token).not.toBe("");
    expect(verifyWebhookToken("fal", 42, token)).toBe(true);
    // 數字與字串 id 等價（內部 String(id)）。
    expect(verifyWebhookToken("fal", "42", token)).toBe(true);
    // 錯 id → 驗不過（防止拿別人 job 的 token 重用）。
    expect(verifyWebhookToken("fal", 43, token)).toBe(false);
    // 錯 token → 驗不過。
    expect(verifyWebhookToken("fal", 42, "deadbeef")).toBe(false);
    // 缺 token → 驗不過。
    expect(verifyWebhookToken("fal", 42, null)).toBe(false);
  });

  it("scope 隔離：fal token 不能拿去當 suno / replicate 用", () => {
    const falToken = signWebhookToken("fal", 7);
    expect(verifyWebhookToken("suno", 7, falToken)).toBe(false);
    expect(verifyWebhookToken("replicate", 7, falToken)).toBe(false);
  });

  it("signFalWebhookNonce：產生可自驗的 (nonce, token)", () => {
    const signed = signFalWebhookNonce();
    expect(signed).not.toBeNull();
    const { nonce, token } = signed!;
    expect(nonce).toMatch(/^[0-9a-f]{24}$/); // randomBytes(12) → 24 hex chars
    // handler 端以 fal:n:<nonce> 為主體驗證。
    expect(verifyWebhookToken("fal", `n:${nonce}`, token)).toBe(true);
    expect(verifyWebhookToken("fal", `n:${nonce}`, "wrong")).toBe(false);
  });

  it("每次 nonce 不同（一次性）", () => {
    const a = signFalWebhookNonce();
    const b = signFalWebhookNonce();
    expect(a!.nonce).not.toBe(b!.nonce);
  });
});
