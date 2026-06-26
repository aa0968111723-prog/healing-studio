/**
 * falJwks.ts — fal.ai Ed25519 JWKS 公鑰快取（AIDV-458）
 *
 * fal.ai 官方 webhook 用 Ed25519 + JWKS 驗章。本模組：
 *   1. 從 fal.ai JWKS endpoint 取得公鑰並快取 24h
 *   2. 提供 verifyFalEd25519() 驗章函式給 webhookFal.ts 使用
 *
 * 降級策略：JWKS endpoint 無法連線時回傳 null → 呼叫端退回 HMAC 驗章。
 */

import crypto from "crypto";
import { logger } from "../_core/logger";

const FAL_JWKS_URL =
  process.env.FAL_JWKS_URL ?? "https://gateway.fal.ai/.well-known/jwks.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface JwkEd25519 {
  kty: "OKP";
  crv?: string;
  use?: string;
  kid?: string;
  x: string;
}

let _cachedKeys: JwkEd25519[] | null = null;
let _cacheExpiresAt = 0;

async function loadJwksKeys(): Promise<JwkEd25519[] | null> {
  const now = Date.now();
  if (_cachedKeys !== null && now < _cacheExpiresAt) return _cachedKeys;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(FAL_JWKS_URL, { signal: controller.signal });
    } finally {
      clearTimeout(tid);
    }

    if (!resp.ok) {
      logger.warn("[FalJwks] JWKS endpoint returned non-OK", { status: resp.status, url: FAL_JWKS_URL });
      return null;
    }

    const json = (await resp.json()) as { keys?: unknown[] };
    const all = Array.isArray(json.keys) ? json.keys : [];
    const ed25519 = all.filter(
      (k): k is JwkEd25519 =>
        typeof k === "object" &&
        k !== null &&
        (k as Record<string, unknown>).kty === "OKP" &&
        typeof (k as Record<string, unknown>).x === "string"
    );

    _cachedKeys = ed25519;
    _cacheExpiresAt = now + CACHE_TTL_MS;
    logger.info("[FalJwks] JWKS loaded", { ed25519KeyCount: ed25519.length });
    return _cachedKeys;
  } catch (err) {
    logger.warn("[FalJwks] JWKS fetch failed — falling back to HMAC", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Verify an Ed25519 webhook signature against fal.ai's JWKS public keys.
 *
 * Returns:
 *   true  — signature verified (accept the request)
 *   false — signature invalid (reject with 401)
 *   null  — JWKS unavailable; caller should fall back to HMAC
 */
export async function verifyFalEd25519(
  rawBody: Buffer,
  signature: string
): Promise<true | false | null> {
  const keys = await loadJwksKeys();
  if (!keys || keys.length === 0) return null;

  let sigBuffer: Buffer;
  try {
    sigBuffer = Buffer.from(signature, "base64");
    if (sigBuffer.length === 0) return false;
  } catch {
    return false;
  }

  for (const jwk of keys) {
    try {
      const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
      const ok = crypto.verify(null, rawBody, publicKey, sigBuffer);
      if (ok) return true;
    } catch {
      // try next key
    }
  }

  return false;
}

/** For testing: forcibly clear the JWKS cache. */
export function _clearFalJwksCache(): void {
  _cachedKeys = null;
  _cacheExpiresAt = 0;
}
