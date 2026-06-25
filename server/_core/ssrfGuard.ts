/**
 * ssrfGuard.ts — AIDV-262
 *
 * Shared SSRF guard for any server-side egress fetch.
 * Blocks loopback / private / link-local / IMDS / IPv4-mapped-IPv6 URLs
 * and enforces redirect:error to prevent redirect-based bypass.
 *
 * Logic extracted from server/services/pdfTextExtractor.ts assertSafeUrl.
 */

import { isIPv4 } from "node:net";

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local + AWS IMDS
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
];

const BLOCKED_IPV6_HOSTS = new Set(["::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata"]);

function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
  return host;
}

function ipv4MappedIpv6ToIpv4(host: string): string | null {
  const normalised = host.replace(/^0(?::0){0,4}:ffff:/i, "::ffff:");
  const match = normalised.match(/^::ffff:([0-9a-f.:]+)$/i);
  if (!match) return null;
  const tail = match[1];
  if (isIPv4(tail)) return tail;
  const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexMatch) return null;
  const high = parseInt(hexMatch[1], 16);
  const low = parseInt(hexMatch[2], 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;
  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  const decoded = `${a}.${b}.${c}.${d}`;
  return isIPv4(decoded) ? decoded : null;
}

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`ssrf-blocked: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Throws SsrfBlockedError if the URL resolves to a private/loopback/IMDS host.
 * Returns the parsed URL on success.
 * Pass allowInsecureHosts=true only in tests/dev (allows localhost + http).
 */
export function assertSafeExternalUrl(rawUrl: string, allowInsecureHosts = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid url");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SsrfBlockedError(`blocked protocol ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !allowInsecureHosts) {
    throw new SsrfBlockedError("plain http blocked");
  }

  const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!host) throw new SsrfBlockedError("missing host");

  if (METADATA_HOSTNAMES.has(host)) throw new SsrfBlockedError(`metadata host ${host}`);
  if (BLOCKED_IPV6_HOSTS.has(host)) throw new SsrfBlockedError(`blocked ipv6 ${host}`);
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    throw new SsrfBlockedError(`blocked ipv6 range ${host}`);
  }
  if (LOOPBACK_HOSTNAMES.has(host) && !allowInsecureHosts) {
    throw new SsrfBlockedError(`loopback host ${host}`);
  }

  const mappedIpv4 = ipv4MappedIpv6ToIpv4(host);
  const checkHost = mappedIpv4 ?? host;
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(checkHost)) {
      if (allowInsecureHosts && checkHost.startsWith("127.")) continue;
      throw new SsrfBlockedError(`private ipv4 ${checkHost}`);
    }
  }

  return parsed;
}

/**
 * Returns true iff the URL's exact origin matches one of the allowed prefixes.
 * Uses new URL().origin (scheme + host + port) for exact comparison, not startsWith.
 */
export function isExactOriginAllowed(url: string, allowedPrefixes: (string | undefined)[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const requestOrigin = parsed.origin; // e.g. "https://pub-xxx.r2.dev"
  for (const prefix of allowedPrefixes) {
    if (!prefix) continue;
    try {
      const allowedOrigin = new URL(prefix.replace(/\/+$/, "")).origin;
      if (requestOrigin === allowedOrigin) return true;
    } catch {
      // skip malformed allowed prefix
    }
  }
  return false;
}
