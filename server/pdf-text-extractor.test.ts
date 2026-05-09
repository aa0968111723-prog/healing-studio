/**
 * pdf-text-extractor.test.ts
 *
 * Verifies the network-bounded behaviour of `extractPdfTextFromUrl`. We
 * mock global `fetch` to avoid hitting real S3 / CDN during CI but still
 * exercise the size cap, abort path, and parse fallback so the orb chat
 * fallback never crashes the request when given a hostile PDF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfTextFromUrl } from "./services/pdfTextExtractor";

const realFetch = globalThis.fetch;

function makeResponse(body: ArrayBuffer | null, opts: { status?: number; contentLength?: string } = {}): Response {
  const headers = new Headers();
  if (opts.contentLength) headers.set("content-length", opts.contentLength);
  return new Response(body, { status: opts.status ?? 200, headers });
}

describe("extractPdfTextFromUrl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns null when fetch responds with non-2xx status", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(null, { status: 404 })) as typeof fetch;

    const result = await extractPdfTextFromUrl("https://cdn.test/missing.pdf");
    expect(result).toBeNull();
  });

  it("returns null when content-length advertises a payload above the cap", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(new ArrayBuffer(0), {
          contentLength: String(64 * 1024 * 1024),
        })
      ) as typeof fetch;

    const result = await extractPdfTextFromUrl("https://cdn.test/huge.pdf", {
      maxBytes: 1024,
    });
    expect(result).toBeNull();
  });

  it("returns null when downloaded bytes exceed the cap (no content-length)", async () => {
    const oversize = new ArrayBuffer(2048);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(oversize)) as typeof fetch;

    const result = await extractPdfTextFromUrl("https://cdn.test/no-clen.pdf", {
      maxBytes: 1024,
    });
    expect(result).toBeNull();
  });

  it("returns null when the fetched bytes are not parseable as a PDF", async () => {
    const bogus = new TextEncoder().encode("not a pdf");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(bogus.buffer.slice(bogus.byteOffset, bogus.byteOffset + bogus.byteLength))
      ) as typeof fetch;

    const result = await extractPdfTextFromUrl("https://cdn.test/bogus.pdf");
    expect(result).toBeNull();
  });
});
