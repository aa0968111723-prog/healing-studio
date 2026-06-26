/**
 * urlValidator.ts — AIDV-259/206 SSRF URL Allowlist
 *
 * Provides `assertSafeUrl()` for any server-side code that must validate
 * a user-supplied or externally-sourced URL before use.
 *
 * Protection layers:
 *   1. HTTPS-only (blocks plain http, data:, javascript:, etc.)
 *   2. Allowlist: only known external content domains are permitted
 *   3. Private/loopback/metadata IP literal blocking (belt-and-suspenders)
 *
 * DNS rebinding is mitigated by the domain allowlist — attacker-controlled
 * domains cannot pass the regex regardless of what they resolve to.
 * Redirect following is already set to `redirect: 'error'` at the fetch
 * call site in internalMedia.ts so post-validation redirects cannot bypass.
 *
 * AIDV-206: Exports `safeMediaUrl` / `safeMediaUrlOptional` Zod schemas for
 * use in tRPC router inputs that accept external media URLs. Gated by
 * ENABLE_URL_ALLOWLIST env (default ON); set to "0" to fall back to
 * IP-only blocking (ALLOWED_MEDIA_DOMAINS still applies when ON).
 */

import { z } from "zod";
import { isSafeExternalUrl } from "../utils/validateSafeUrl";

// Base static allowlist — fal.media added (AIDV-206: fal.ai returns image
// results under this domain, not fal.ai or fal.run).
const STATIC_ALLOWED_HOSTS_RE =
  /^(?:[\w-]+\.)*(?:fal\.ai|fal\.run|fal\.media|storage\.googleapis\.com|r2\.dev|cloudfront\.net|amazonaws\.com|supabase\.co|supabase\.in|blob\.core\.windows\.net)$/i;

// Env-based extension: comma-separated extra domains (no wildcards needed —
// the check uses endsWith, so "example.com" covers "cdn.example.com").
const EXTRA_DOMAINS: string[] = (process.env.ALLOWED_MEDIA_DOMAINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAllowedHost(host: string): boolean {
  if (STATIC_ALLOWED_HOSTS_RE.test(host)) return true;
  return EXTRA_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const BLOCKED_IPV6 = new Set(["::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0"]);

export class UrlNotAllowedError extends Error {
  constructor(reason: string) {
    super(`url-not-allowed: ${reason}`);
    this.name = "UrlNotAllowedError";
  }
}

/**
 * Throws UrlNotAllowedError if the URL is not safe to use as an external
 * content reference. Returns the parsed URL on success.
 *
 * Pass `allowInsecureHosts=true` only in tests (allows localhost + http).
 */
export function assertSafeUrl(rawUrl: string, allowInsecureHosts = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlNotAllowedError("invalid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UrlNotAllowedError(`blocked protocol: ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !allowInsecureHosts) {
    throw new UrlNotAllowedError("plain http not allowed");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new UrlNotAllowedError("missing host");

  // Loopback / localhost
  if ((host === "localhost" || host === "ip6-localhost") && !allowInsecureHosts) {
    throw new UrlNotAllowedError("loopback host not allowed");
  }

  // IPv6 blocked ranges
  if (BLOCKED_IPV6.has(host) && !allowInsecureHosts) {
    throw new UrlNotAllowedError(`blocked IPv6: ${host}`);
  }
  if (
    /^fe80:/i.test(host) ||
    /^fc[0-9a-f]{2}:/i.test(host) ||
    /^fd[0-9a-f]{2}:/i.test(host)
  ) {
    throw new UrlNotAllowedError(`blocked IPv6 range: ${host}`);
  }

  // IPv4-mapped IPv6 → unwrap and re-check
  const v4Mapped = host.match(/^::ffff:([0-9a-f.:]+)$/i)?.[1];
  if (v4Mapped) {
    return assertSafeUrl(
      `${parsed.protocol}//${v4Mapped}${parsed.pathname}`,
      allowInsecureHosts
    );
  }

  // IPv4 literal private ranges
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    for (const pattern of PRIVATE_IPV4_PATTERNS) {
      if (pattern.test(host)) {
        if (allowInsecureHosts && host.startsWith("127.")) continue;
        throw new UrlNotAllowedError(`private IP: ${host}`);
      }
    }
    // In test mode, allow bare public IPs (e.g. mock server).
    // In production, bare IPs are not in the allowlist.
    if (!allowInsecureHosts) {
      throw new UrlNotAllowedError(`bare IP address not in allowlist: ${host}`);
    }
    return parsed;
  }

  // In test/dev mode (allowInsecureHosts), skip the domain allowlist so
  // tests can point at localhost / mock servers without allowlist entries.
  if (allowInsecureHosts) {
    return parsed;
  }

  // Domain allowlist check (STATIC_ALLOWED_HOSTS_RE + env-based extras)
  if (!isAllowedHost(host)) {
    throw new UrlNotAllowedError(`host not in allowlist: ${host}`);
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas (AIDV-206) — use these in tRPC router inputs instead of
// plain z.string().url() wherever external media URLs are accepted.
//
// ENABLE_URL_ALLOWLIST=0  → IP-only block (no domain allowlist, fallback mode)
// ENABLE_URL_ALLOWLIST=1  → full allowlist (default; recommended for prod)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when the URL passes the configured security check. */
export function isMediaUrlSafe(url: string): boolean {
  if (process.env.ENABLE_URL_ALLOWLIST === "0") {
    // Fallback: private-IP block only, no domain allowlist.
    return isSafeExternalUrl(url);
  }
  try {
    assertSafeUrl(url);
    return true;
  } catch {
    return false;
  }
}

/** Zod schema for a required external media URL (https + allowlist). */
export const safeMediaUrl = z
  .string()
  .url()
  .refine(isMediaUrlSafe, {
    message: "URL 必須使用 https 且必須是允許的媒體 CDN 網域",
  });

/** Zod schema for an optional external media URL. */
export const safeMediaUrlOptional = safeMediaUrl.optional();
