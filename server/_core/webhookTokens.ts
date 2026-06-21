/**
 * webhookTokens.ts — Per-job capability tokens for webhook URLs.
 *
 * Replicate, Suno and fal webhooks identify the job via a numeric query param
 * (`?modelId=` / `?jobId=`). Without anything else, an attacker who guesses
 * a numeric id can POST to `/api/webhook/replicate?modelId=42` and:
 *   - Mark a victim's LoRA training as `ready` with attacker-controlled
 *     weights URL → user later loads malicious model artefacts.
 *   - Mark a Suno job as `completed` with a fake audio URL.
 *   - Mark a fal image/video job as `completed` with an attacker-hosted URL.
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
 *
 * fal nuance: some fal flows (imageStudio / proStudio, plus VideoStudio's
 * fire-and-forget entry) construct the webhook URL BEFORE a backgroundJob (and
 * its numeric jobId) exists — the job is created later and matched back by the
 * fal `request_id`. There is no jobId to bind to at sign time, so those callers
 * instead mint a one-off random nonce and sign `fal:n:<nonce>` (see
 * {@link signFalWebhookNonce}). That still proves the callback URL was minted by
 * a holder of JWT_SECRET (i.e. our own server), which is what stops a forged
 * POST — the attacker cannot produce a valid `(nonce, token)` pair.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { serverEnv } from "./env.validated";

export type WebhookScope = "replicate" | "suno" | "fal";

const SCOPE_REPLICATE = "replicate";
const SCOPE_SUNO = "suno";
const SCOPE_FAL = "fal";

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
 * Whether capability-token verification actually engages — i.e. a usable
 * JWT_SECRET is configured. When this is false (dev / no secret) the verifier
 * skips, so a webhook handler must treat "no signed binding present" as
 * acceptable; when it is true (production) a missing/invalid token must be
 * rejected.
 */
export function isWebhookTokenEnforced(): boolean {
  return getSecret() !== null;
}

/**
 * Returns the verification token to append to a webhook URL, or null when
 * no JWT_SECRET is configured (token verification will be skipped on the
 * receive side too, keeping local dev seamless).
 */
export function signWebhookToken(scope: WebhookScope, id: string | number): string | null {
  return computeToken(scope, id);
}

/**
 * Mint a one-off server-origin token for fal callers that don't yet have a
 * numeric jobId at URL-construction time (imageStudio / proStudio / VideoStudio
 * fire-and-forget). Returns `{ nonce, token }` to embed as
 * `?fnonce=<nonce>&token=<token>`, or null in dev (no JWT_SECRET) so the caller
 * builds a tokenless URL that the receive side still accepts.
 *
 * The handler recomputes `HMAC(JWT_SECRET, "fal:n:<nonce>")` and compares — the
 * pair is self-verifying (no server-side storage needed) and unforgeable
 * without the secret.
 */
export function signFalWebhookNonce(): { nonce: string; token: string } | null {
  if (getSecret() === null) return null;
  const nonce = randomBytes(12).toString("hex");
  const token = computeToken(SCOPE_FAL, `n:${nonce}`);
  if (!token) return null;
  return { nonce, token };
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
  scope: WebhookScope,
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
  fal: SCOPE_FAL,
} as const;
