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
}

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 12_000;

async function downloadPdf(url: string, opts: Required<PdfTextExtractionOptions>): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
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
