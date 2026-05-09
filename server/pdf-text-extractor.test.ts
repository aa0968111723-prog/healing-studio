/**
 * pdf-text-extractor.test.ts
 *
 * Verifies the network-bounded behaviour of `extractPdfTextFromUrl`. We
 * mock global `fetch` to avoid hitting real S3 / CDN during CI but still
 * exercise the size cap, abort path, and parse fallback so the orb chat
 * fallback never crashes the request when given a hostile PDF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeUrl,
  extractPdfTextFromUrl,
  UnsafePdfUrlError,
} from "./services/pdfTextExtractor";

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

  it("extracts real text from a minimal valid PDF (end-to-end parse contract)", async () => {
    // Hand-built single-page PDF with two text lines so we don't depend on a
    // committed binary fixture. If `unpdf` ever stops producing usable text
    // for plain Type1 / Helvetica content, this test breaks loudly instead
    // of silently regressing the user-facing fallback.
    const objects = [
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
      "4 0 obj << /Length 80 >> stream\n" +
        "BT /F1 18 Tf 72 720 Td (Hello, healing studio!) Tj 0 -24 Td (Scene one: forest dawn.) Tj ET\n" +
        "endstream endobj\n",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ];
    const header = "%PDF-1.4\n";
    const offsets: number[] = [];
    let acc = header;
    for (const obj of objects) {
      offsets.push(acc.length);
      acc += obj;
    }
    const xrefStart = acc.length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
    for (const offset of offsets) {
      xref += String(offset).padStart(10, "0") + " 00000 n\n";
    }
    const trailer = `trailer << /Size ${
      objects.length + 1
    } /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    const pdfBytes = new TextEncoder().encode(acc + xref + trailer);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse(
          pdfBytes.buffer.slice(
            pdfBytes.byteOffset,
            pdfBytes.byteOffset + pdfBytes.byteLength
          )
        )
      ) as typeof fetch;

    const result = await extractPdfTextFromUrl("https://cdn.test/sample.pdf");
    expect(result).not.toBeNull();
    expect(result?.pageCount).toBe(1);
    expect(result?.truncated).toBe(false);
    expect(result?.text).toContain("Hello, healing studio!");
    expect(result?.text).toContain("Scene one: forest dawn.");
  });
});

describe("assertSafeUrl (SSRF guard)", () => {
  it("rejects AWS IMDS / link-local addresses regardless of insecure-host flag", () => {
    expect(() =>
      assertSafeUrl("http://169.254.169.254/latest/meta-data/", true)
    ).toThrow(UnsafePdfUrlError);
    expect(() =>
      assertSafeUrl("https://169.254.169.254/latest/meta-data/", false)
    ).toThrow(UnsafePdfUrlError);
  });

  it("rejects private IPv4 ranges (10/8, 172.16/12, 192.168/16) in production mode", () => {
    expect(() => assertSafeUrl("https://10.0.0.5/internal", false)).toThrow(
      UnsafePdfUrlError
    );
    expect(() => assertSafeUrl("https://172.16.5.5/internal", false)).toThrow(
      UnsafePdfUrlError
    );
    expect(() => assertSafeUrl("https://192.168.1.1/internal", false)).toThrow(
      UnsafePdfUrlError
    );
  });

  it("rejects IPv6 loopback and link-local hosts", () => {
    expect(() => assertSafeUrl("http://[::1]/admin", true)).toThrow(
      UnsafePdfUrlError
    );
    expect(() => assertSafeUrl("https://[fe80::1]/internal", false)).toThrow(
      UnsafePdfUrlError
    );
    expect(() => assertSafeUrl("https://[fc00::1]/internal", false)).toThrow(
      UnsafePdfUrlError
    );
  });

  it("rejects hostnames pointing at internal metadata services", () => {
    expect(() =>
      assertSafeUrl("http://metadata.google.internal/foo", true)
    ).toThrow(UnsafePdfUrlError);
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => assertSafeUrl("file:///etc/passwd", true)).toThrow(
      UnsafePdfUrlError
    );
    expect(() => assertSafeUrl("ftp://example.com/foo.pdf", true)).toThrow(
      UnsafePdfUrlError
    );
  });

  it("rejects http:// in production mode", () => {
    expect(() =>
      assertSafeUrl("http://cdn.example.com/foo.pdf", false)
    ).toThrow(UnsafePdfUrlError);
  });

  it("allows public https URLs in production mode", () => {
    expect(() =>
      assertSafeUrl(
        "https://my-bucket.s3.amazonaws.com/uploads/42/script.pdf?X-Amz-Signature=abc",
        false
      )
    ).not.toThrow();
    expect(() =>
      assertSafeUrl("https://pub-xyz.r2.dev/uploads/42/script.pdf", false)
    ).not.toThrow();
  });

  it("allows 127.0.0.1 only when insecure hosts are permitted (dev / tests)", () => {
    expect(() => assertSafeUrl("http://127.0.0.1:8080/x.pdf", true)).not.toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1:8080/x.pdf", false)).toThrow(
      UnsafePdfUrlError
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => assertSafeUrl("not a url", true)).toThrow(UnsafePdfUrlError);
    expect(() => assertSafeUrl("", true)).toThrow(UnsafePdfUrlError);
  });
});

describe("extractPdfTextFromUrl SSRF behaviour", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(makeResponse(new ArrayBuffer(0)));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("never calls fetch when the URL points at an internal IP (production mode)", async () => {
    const result = await extractPdfTextFromUrl(
      "https://169.254.169.254/latest/meta-data/iam/",
      { allowInsecureHosts: false }
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch when the URL points at a private LAN IP (production mode)", async () => {
    const result = await extractPdfTextFromUrl("https://10.0.0.5/foo.pdf", {
      allowInsecureHosts: false,
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch when the URL uses a non-http(s) protocol", async () => {
    const result = await extractPdfTextFromUrl("file:///etc/passwd", {
      allowInsecureHosts: false,
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
