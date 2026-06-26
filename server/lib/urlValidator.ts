/**
 * urlValidator.ts — AIDV-259 SSRF URL Allowlist
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
 */

const ALLOWED_HOSTS_RE =
  /^(?:[\w-]+\.)*(?:fal\.ai|fal\.run|storage\.googleapis\.com|r2\.dev|cloudfront\.net|amazonaws\.com|supabase\.co|supabase\.in|blob\.core\.windows\.net)$/i;

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

  // Domain allowlist check
  if (!ALLOWED_HOSTS_RE.test(host)) {
    throw new UrlNotAllowedError(`host not in allowlist: ${host}`);
  }

  return parsed;
}
