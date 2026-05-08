/**
 * webhookTokens.ts — Per-job capability tokens for webhook URLs.
 *
 * Replicate and Suno webhooks identify the job via a numeric query param
 * (`?modelId=` / `?jobId=`). Without anything else, an attacker who guesses
 * a numeric id can POST to `/api/webhook/replicate?modelId=42` and:
 *   - Mark a victim's LoRA training as `ready` with attacker-controlled
 *     weights URL → user later loads malicious model artefacts.
 *   - Mark a Suno job as `completed` with a fake audio URL.
 *
 * Replicate has standard-webhooks signing and Suno (apibox.erweima.ai) has
 * no documented signing scheme at all, so we layer a server-side capability
 * token on top: when we submit the job we sign `<scope>:<id>` with the
 * server's JWT_SECRET and append it as `?token=<hex>`. The webhook handler
 * recomputes the expected token and `timingSafeEqual`s before applying any
 * mutation. Stealing the token now requires the server's own secret.
 *
 * The token is OPTIONAL during boot when no secret is configured (dev mode)
 * — the verifier falls back to "skip" so local self-tests still work — but
 * production deployments always have JWT_SECRET set so it always engages.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env.validated";

const SCOPE_REPLICATE = "replicate";
const SCOPE_SUNO = "suno";

function getSecret(): string | null {
  const secret = serverEnv.JWT_SECRET;
  if (!secret || secret.length < 8) return null;
  return secret;
}

function computeToken(scope: string, id: string | number): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${scope}:${String(id)}`).digest("hex");
}

/**
 * Returns the verification token to append to a webhook URL, or null when
 * no JWT_SECRET is configured (token verification will be skipped on the
 * receive side too, keeping local dev seamless).
 */
export function signWebhookToken(scope: "replicate" | "suno", id: string | number): string | null {
  return computeToken(scope, id);
}

/**
 * Verify a token matches the expected HMAC for `scope:id`.
 *
 * Returns true when:
 *   - No JWT_SECRET is configured (dev mode; webhook still works locally).
 *   - The provided token's bytes timing-safe-equal the expected token.
 *
 * Returns false when a secret is configured but the token is missing or
 * doesn't match — the webhook handler must drop the payload in that case.
 */
export function verifyWebhookToken(
  scope: "replicate" | "suno",
  id: string | number,
  token: string | undefined | null
): boolean {
  const expected = computeToken(scope, id);
  if (expected === null) return true; // dev mode: no secret → skip
  if (!token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export const WEBHOOK_SCOPES = {
  replicate: SCOPE_REPLICATE,
  suno: SCOPE_SUNO,
} as const;
