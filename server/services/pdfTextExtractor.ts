/**
 * pdfTextExtractor — server-side PDF text extraction using `unpdf`.
 *
 * Used as the fallback path when no multimodal LLM provider is available
 * (e.g. `GEMINI_API_KEY` not configured). We fetch the stored PDF, extract
 * plain text, and inline it into the user message so a text-only LLM
 * (`default_llm`) can still respond about the script.
 *
 * Notes:
 *   - `unpdf` is a pure-JS, serverless-friendly fork of pdf.js with no native
 *     bindings — safe in Railway / Vercel containers.
 *   - We cap fetch size, request timeout, and inlined char budget so a
 *     200-page PDF never blows the LLM token budget.
 *   - Server-side fetching of a user-supplied URL is an SSRF surface, so
 *     `assertSafeUrl` blocks loopback / private / link-local hosts (AWS IMDS,
 *     LAN ranges, ::1) before we ever call `fetch`.
 */
import { logger } from "../_core/logger";

export interface PdfTextExtractionResult {
  text: string;
  pageCount: number;
  truncated: boolean;
}

export interface PdfTextExtractionOptions {
  /** Hard cap on bytes downloaded; defaults to 12 MB to match attachment guard. */
  maxBytes?: number;
  /** Hard cap on characters returned; longer extractions are truncated. */
  maxChars?: number;
  /** Fetch + parse timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Allow http:// and loopback hosts. Defaults to true outside production so
   * unit tests with `127.0.0.1` and dev S3-compatible local stacks still
   * work; production callers should keep this false.
   */
  allowInsecureHosts?: boolean;
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 12_000;

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local + AWS IMDS
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
];

const BLOCKED_IPV6_HOSTS = new Set(["::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0"]);

/** Loopback hostnames — allowed in dev (so 127.0.0.1 / localhost test stacks work). */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

/** Cloud metadata hostnames — always blocked, even in dev. */
const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata"]);

function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
  return host;
}

export class UnsafePdfUrlError extends Error {
  constructor(reason: string) {
    super(`unsafe pdf url: ${reason}`);
    this.name = "UnsafePdfUrlError";
  }
}

export function assertSafeUrl(rawUrl: string, allowInsecureHosts: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafePdfUrlError("invalid url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UnsafePdfUrlError(`blocked protocol ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !allowInsecureHosts) {
    throw new UnsafePdfUrlError("plain http blocked outside dev");
  }
  const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!host) throw new UnsafePdfUrlError("missing host");
  if (METADATA_HOSTNAMES.has(host)) {
    throw new UnsafePdfUrlError(`blocked metadata hostname ${host}`);
  }
  if (LOOPBACK_HOSTNAMES.has(host) && !allowInsecureHosts) {
    throw new UnsafePdfUrlError(`blocked loopback hostname ${host}`);
  }
  if (BLOCKED_IPV6_HOSTS.has(host)) {
    throw new UnsafePdfUrlError(`blocked ipv6 host ${host}`);
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    throw new UnsafePdfUrlError(`blocked ipv6 range ${host}`);
  }
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(host)) {
      if (allowInsecureHosts && host.startsWith("127.")) continue;
      throw new UnsafePdfUrlError(`blocked private ipv4 ${host}`);
    }
  }
  return parsed;
}

async function downloadPdf(
  url: string,
  opts: Required<PdfTextExtractionOptions>
): Promise<Uint8Array> {
  assertSafeUrl(url, opts.allowInsecureHosts);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) {
      throw new Error(`PDF fetch failed: HTTP ${response.status}`);
    }
    const reported = Number(response.headers.get("content-length") ?? "0");
    if (reported && reported > opts.maxBytes) {
      throw new Error(`PDF too large: ${reported} bytes`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > opts.maxBytes) {
      throw new Error(`PDF too large: ${buffer.byteLength} bytes`);
    }
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function clipText(raw: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return {
    text: `${normalized.slice(0, maxChars)}\n…(此處省略，原文較長)`,
    truncated: true,
  };
}

export async function extractPdfTextFromUrl(
  url: string,
  options: PdfTextExtractionOptions = {}
): Promise<PdfTextExtractionResult | null> {
  const opts: Required<PdfTextExtractionOptions> = {
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowInsecureHosts:
      options.allowInsecureHosts ?? process.env.NODE_ENV !== "production",
  };

  let bytes: Uint8Array;
  try {
    bytes = await downloadPdf(url, opts);
  } catch (err) {
    logger.warn("pdfTextExtractor.download_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(document, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
    const clipped = clipText(merged, opts.maxChars);
    if (!clipped.text.trim()) return null;
    return {
      text: clipped.text,
      pageCount: typeof totalPages === "number" ? totalPages : 0,
      truncated: clipped.truncated,
    };
  } catch (err) {
    logger.warn("pdfTextExtractor.parse_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
