/**
 * upload-route.test.ts
 *
 * Locks down the inline-vs-storage decision policy enforced by
 * `server/uploadRoute.ts` (Issue #178). The route's pure classifier is
 * exported as `__uploadRouteInternals.classifyInlineEligibility` so we can
 * assert the policy without spinning up an Express app or a real S3 backend.
 *
 * Production contract:
 *   1. video/* and audio/* are ALWAYS storage-only (inlineEligible=false),
 *      regardless of size. They must never be re-base64'd into LLM requests.
 *   2. image/* and application/pdf may inline only when <= 1 MB.
 *   3. Anything > 1 MB must be referenced by storage URL.
 *   4. The recommendation string distinguishes "kind requires storage" from
 *      "size pushed past threshold" so observability can tell them apart.
 */

import { describe, expect, it } from "vitest";
import { __uploadRouteInternals } from "./uploadRoute";

const {
  PER_KIND_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  INLINE_BASE64_THRESHOLD,
  STORAGE_ONLY_KIND_PREFIXES,
  ALLOWED_MIME_TYPES,
  inferKind,
  looksLikeMarkup,
  detectContentFamily,
  detectMimeMismatch,
  safeStorageExt,
  MIME_TO_EXT,
  classifyInlineEligibility,
} = __uploadRouteInternals;

describe("AIDV-64 hardening: ftyp ambiguity fix + safe storage extension", () => {
  it("mp4 listing 'avif' as a compatible brand is accepted as video/mp4 (no false reject)", () => {
    // ftyp@4, major brand 'isom', compatible-brands include 'avif' — a real
    // pattern that previously mis-classified as image and got 415-rejected.
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from("ftypisom", "latin1"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomavifmp41", "latin1"),
    ]);
    expect(detectContentFamily(mp4)).toBe("isobmff");
    expect(detectMimeMismatch("video/mp4", mp4).reject).toBe(false);
    expect(detectMimeMismatch("audio/mp4", mp4).reject).toBe(false);
  });

  it("avif still image is accepted as image/avif", () => {
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypavif", "latin1"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("avifmif1", "latin1"),
    ]);
    expect(detectContentFamily(avif)).toBe("isobmff");
    expect(detectMimeMismatch("image/avif", avif).reject).toBe(false);
  });

  it("safeStorageExt derives a safe ext from the validated mime, never script-capable", () => {
    expect(safeStorageExt("image/png")).toBe("png");
    expect(safeStorageExt("video/quicktime")).toBe("mov");
    expect(safeStorageExt("text/plain")).toBe("txt");
    const dangerous = new Set([
      "html",
      "htm",
      "svg",
      "xhtml",
      "xml",
      "js",
      "mjs",
      "css",
      "shtml",
    ]);
    for (const ext of Object.values(MIME_TO_EXT)) {
      expect(dangerous.has(ext as string)).toBe(false);
    }
    // unmapped mime → inert ".bin", never echoing a user-supplied .html
    expect(safeStorageExt("application/x-anything")).toBe("bin");
  });
});

// ── magic-byte sample builders ──────────────────────────────────────────────
// Each returns a minimal but VALID leading-signature buffer for the format.
const ascii = (s: string) => Buffer.from(s, "latin1");
const bytes = (...b: number[]) => Buffer.from(b);
const concat = (...parts: Buffer[]) => Buffer.concat(parts);

const sample = {
  jpegJfif: () => bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46),
  jpegExif: () => bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66), // phone/camera
  jpegRaw: () => bytes(0xff, 0xd8, 0xff, 0xdb), // raw quant table, no JFIF/Exif tag
  png: () => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d),
  gif87: () => ascii("GIF87a"),
  gif89: () => ascii("GIF89a"),
  webp: () =>
    concat(ascii("RIFF"), bytes(0x24, 0x00, 0x00, 0x00), ascii("WEBP"), ascii("VP8 ")),
  webpLossless: () =>
    concat(ascii("RIFF"), bytes(0x10, 0x00, 0x00, 0x00), ascii("WEBP"), ascii("VP8L")),
  // AVIF: box size (wildcard) + 'ftyp' + major brand 'avif'
  avif: () => concat(bytes(0x00, 0x00, 0x00, 0x1c), ascii("ftyp"), ascii("avif"), ascii("mif1avifmiaf")),
  // AVIF declaring 'mif1' major brand with 'avif' only in compatible brands
  avifCompat: () =>
    concat(bytes(0x00, 0x00, 0x00, 0x1c), ascii("ftyp"), ascii("mif1"), bytes(0, 0, 0, 0), ascii("avif"), ascii("miaf")),
  pdf: () => ascii("%PDF-1.7\n%âãÏÓ"),
  // audio
  mp3Id3: () => concat(ascii("ID3"), bytes(0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21)),
  mp3Sync: () => bytes(0xff, 0xfb, 0x90, 0x00),
  wav: () =>
    concat(ascii("RIFF"), bytes(0x24, 0x00, 0x00, 0x00), ascii("WAVE"), ascii("fmt ")),
  oggS: () => concat(ascii("OggS"), bytes(0x00, 0x02, 0x00, 0x00)),
  webmEbml: () => bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00),
  flac: () => concat(ascii("fLaC"), bytes(0x00, 0x00, 0x00, 0x22)),
  aacAdts: () => bytes(0xff, 0xf1, 0x50, 0x80),
  // mp4 / mov ISOBMFF: box size + 'ftyp' + brand
  mp4: () => concat(bytes(0x00, 0x00, 0x00, 0x18), ascii("ftyp"), ascii("mp42"), ascii("isommp42")),
  m4a: () => concat(bytes(0x00, 0x00, 0x00, 0x18), ascii("ftyp"), ascii("M4A "), ascii("isomM4A ")),
  mov: () => concat(bytes(0x00, 0x00, 0x00, 0x18), ascii("ftyp"), ascii("qt  "), ascii("qt  qt  ")),
  movMoov: () => concat(bytes(0x00, 0x00, 0x10, 0x00), ascii("moov")),
  // documents
  ole: () => bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
  zip: () => bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00),
  rtf: () => ascii("{\\rtf1\\ansi"),
  txt: () => ascii("Just some plain text without any signature.\n"),
  md: () => ascii("# Heading\n\nsome *markdown* text\n"),
  // disguises / hostile
  svg: () => ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  html: () => ascii("<!DOCTYPE html><html><body>hi</body></html>"),
  elf: () => bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00),
  pe: () => bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00),
  garbage: () => bytes(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0),
};

describe("AIDV-64: upload security — SVG removal + markup-disguise guard", () => {
  it("image/svg+xml is no longer allowed (stored-XSS vector removed)", () => {
    expect(ALLOWED_MIME_TYPES.has("image/svg+xml")).toBe(false);
    // legitimate raster image types remain allowed
    expect(ALLOWED_MIME_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_MIME_TYPES.has("image/webp")).toBe(true);
  });

  it("looksLikeMarkup: real binary signatures are NOT flagged", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const gif = Buffer.from("GIF89a");
    const pdf = Buffer.from("%PDF-1.7\n");
    expect(looksLikeMarkup(png)).toBe(false);
    expect(looksLikeMarkup(jpeg)).toBe(false);
    expect(looksLikeMarkup(gif)).toBe(false);
    expect(looksLikeMarkup(pdf)).toBe(false);
  });

  it("looksLikeMarkup: SVG/HTML/XML disguised content IS flagged", () => {
    expect(
      looksLikeMarkup(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        )
      )
    ).toBe(true);
    expect(looksLikeMarkup(Buffer.from("<!DOCTYPE html><html></html>"))).toBe(true);
    expect(looksLikeMarkup(Buffer.from('<?xml version="1.0"?><svg/>'))).toBe(true);
  });

  it("looksLikeMarkup: ignores leading whitespace and a UTF-8/UTF-16 BOM", () => {
    expect(looksLikeMarkup(Buffer.from("   \n\t  <svg/>"))).toBe(true);
    // UTF-8 BOM + '<'
    expect(looksLikeMarkup(Buffer.from([0xef, 0xbb, 0xbf, 0x3c]))).toBe(true);
    // UTF-16 LE BOM + '<'
    expect(looksLikeMarkup(Buffer.from([0xff, 0xfe, 0x3c, 0x00]))).toBe(true);
  });

  it("looksLikeMarkup: ordinary non-markup content is not flagged", () => {
    expect(looksLikeMarkup(Buffer.from("hello world"))).toBe(false);
    expect(looksLikeMarkup(Buffer.from(""))).toBe(false);
    expect(looksLikeMarkup(Buffer.from("text, angle bracket < not at start"))).toBe(false);
  });
});

describe("uploadRoute size + inline policy (Issue #178)", () => {
  describe("constants", () => {
    it("INLINE_BASE64_THRESHOLD is 1 MB", () => {
      expect(INLINE_BASE64_THRESHOLD).toBe(1 * 1024 * 1024);
    });

    it("video/audio prefixes are flagged as storage-only", () => {
      expect(STORAGE_ONLY_KIND_PREFIXES).toContain("video/");
      expect(STORAGE_ONLY_KIND_PREFIXES).toContain("audio/");
    });

    it("per-kind size limits match orbAttachmentGuard policy", () => {
      // Aligned with server/services/orbAttachmentGuard.ts so the upload
      // endpoint and the LLM-side guard agree on what 'too big' means.
      expect(PER_KIND_MAX_BYTES.image).toBe(10 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.audio).toBe(20 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.video).toBe(40 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.pdf).toBe(12 * 1024 * 1024);
      // Office docs / plain text / markdown — teaching archive PPT slides
      // can be a few MB plus images, so the ceiling is higher than PDF.
      expect(PER_KIND_MAX_BYTES.document).toBe(25 * 1024 * 1024);
    });

    it("ABSOLUTE_MAX_BYTES is 40 MB", () => {
      expect(ABSOLUTE_MAX_BYTES).toBe(40 * 1024 * 1024);
    });
  });

  describe("inferKind", () => {
    it("classifies image/png, image/jpeg, image/webp as image", () => {
      expect(inferKind("image/png")).toBe("image");
      expect(inferKind("image/jpeg")).toBe("image");
      expect(inferKind("image/webp")).toBe("image");
    });

    it("classifies audio/* as audio", () => {
      expect(inferKind("audio/mpeg")).toBe("audio");
      expect(inferKind("audio/webm")).toBe("audio");
      expect(inferKind("audio/wav")).toBe("audio");
    });

    it("classifies video/* as video", () => {
      expect(inferKind("video/mp4")).toBe("video");
      expect(inferKind("video/webm")).toBe("video");
      expect(inferKind("video/quicktime")).toBe("video");
    });

    it("classifies application/pdf as pdf", () => {
      expect(inferKind("application/pdf")).toBe("pdf");
    });

    it("classifies office docs / text / markdown as document", () => {
      expect(inferKind("application/msword")).toBe("document");
      expect(
        inferKind(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
      ).toBe("document");
      expect(inferKind("application/vnd.ms-powerpoint")).toBe("document");
      expect(
        inferKind(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )
      ).toBe("document");
      expect(inferKind("text/plain")).toBe("document");
      expect(inferKind("text/markdown")).toBe("document");
    });
  });

  describe("classifyInlineEligibility — small files", () => {
    it("small image (<=1MB) is inline-eligible", () => {
      const result = classifyInlineEligibility("image/png", 500_000);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });

    it("small PDF (<=1MB) is inline-eligible", () => {
      const result = classifyInlineEligibility("application/pdf", 800_000);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });

    it("exactly 1MB is inline-eligible (boundary inclusive)", () => {
      const result = classifyInlineEligibility("image/png", 1 * 1024 * 1024);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });
  });

  describe("classifyInlineEligibility — large files cross threshold", () => {
    it("image > 1MB must use storage URL (not inline)", () => {
      const result = classifyInlineEligibility("image/png", 2 * 1024 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url");
    });

    it("PDF > 1MB must use storage URL", () => {
      const result = classifyInlineEligibility(
        "application/pdf",
        5 * 1024 * 1024
      );
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url");
    });

    it("1MB+1 byte already crosses the threshold", () => {
      const result = classifyInlineEligibility(
        "image/jpeg",
        INLINE_BASE64_THRESHOLD + 1
      );
      expect(result.inlineEligible).toBe(false);
    });
  });

  describe("classifyInlineEligibility — video/audio always storage-only", () => {
    it("tiny 200 KB video MP4 is still storage-only", () => {
      const result = classifyInlineEligibility("video/mp4", 200 * 1024);
      expect(result.inlineEligible).toBe(false);
      // Must surface the 'required' variant — not 'use-storage-url' — so
      // dashboards / UI can tell users 'this kind doesn't fit inline ever'
      // vs 'this file is just too big'.
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("tiny 100 KB MP3 is still storage-only", () => {
      const result = classifyInlineEligibility("audio/mpeg", 100 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("large 30 MB video is storage-only with the 'required' label", () => {
      const result = classifyInlineEligibility("video/mp4", 30 * 1024 * 1024);
      expect(result.inlineEligible).toBe(false);
      // 'required' takes precedence over 'use-storage-url' so the reason
      // surfaced to ops is the kind, not the size.
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("audio/webm is also storage-only", () => {
      const result = classifyInlineEligibility("audio/webm", 50 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });
  });

  describe("policy invariants", () => {
    it("inlineEligible=true implies inlineRecommendation='inline-ok'", () => {
      const cases: Array<{ mime: string; size: number }> = [
        { mime: "image/png", size: 100 },
        { mime: "image/jpeg", size: 999_999 },
        { mime: "application/pdf", size: 50_000 },
      ];
      for (const c of cases) {
        const r = classifyInlineEligibility(c.mime, c.size);
        if (r.inlineEligible) expect(r.inlineRecommendation).toBe("inline-ok");
      }
    });

    it("video/audio with any size yields inlineEligible=false", () => {
      const sizes = [0, 1, 1024, 500_000, 5 * 1024 * 1024, 30 * 1024 * 1024];
      for (const size of sizes) {
        expect(classifyInlineEligibility("video/mp4", size).inlineEligible).toBe(
          false
        );
        expect(classifyInlineEligibility("audio/mpeg", size).inlineEligible).toBe(
          false
        );
      }
    });
  });
});

describe("AIDV-64: full per-format magic-byte validation (detectMimeMismatch)", () => {
  // ── Every allowed binary format: a valid sample, claimed correctly, ACCEPTS ──
  describe("valid samples claimed correctly are ACCEPTED", () => {
    const accept = (mime: string, buf: Buffer) =>
      expect(detectMimeMismatch(mime, buf).reject).toBe(false);

    it("image/jpeg — JFIF, Exif (phone/camera), and raw-quant variants all accepted", () => {
      accept("image/jpeg", sample.jpegJfif());
      accept("image/jpeg", sample.jpegExif());
      accept("image/jpeg", sample.jpegRaw());
    });
    it("image/png accepted", () => accept("image/png", sample.png()));
    it("image/gif — both 87a and 89a accepted", () => {
      accept("image/gif", sample.gif87());
      accept("image/gif", sample.gif89());
    });
    it("image/webp — lossy and lossless accepted", () => {
      accept("image/webp", sample.webp());
      accept("image/webp", sample.webpLossless());
    });
    it("image/avif — major brand and compatible-brand forms accepted", () => {
      accept("image/avif", sample.avif());
      accept("image/avif", sample.avifCompat());
    });
    it("application/pdf accepted", () => accept("application/pdf", sample.pdf()));

    it("audio/mpeg — ID3 tag and raw frame-sync accepted", () => {
      accept("audio/mpeg", sample.mp3Id3());
      accept("audio/mpeg", sample.mp3Sync());
    });
    it("audio/wav accepted", () => accept("audio/wav", sample.wav()));
    it("audio/ogg accepted", () => accept("audio/ogg", sample.oggS()));
    it("audio/webm accepted", () => accept("audio/webm", sample.webmEbml()));
    it("audio/mp4 accepted", () => accept("audio/mp4", sample.m4a()));
    it("audio/aac — ADTS and ID3-wrapped accepted", () => {
      accept("audio/aac", sample.aacAdts());
      accept("audio/aac", sample.mp3Id3());
    });
    it("audio/flac accepted", () => accept("audio/flac", sample.flac()));

    it("video/mp4 accepted", () => accept("video/mp4", sample.mp4()));
    it("video/webm accepted", () => accept("video/webm", sample.webmEbml()));
    it("video/ogg accepted", () => accept("video/ogg", sample.oggS()));
    it("video/quicktime — ftyp 'qt  ' and brandless moov accepted", () => {
      accept("video/quicktime", sample.mov());
      accept("video/quicktime", sample.movMoov());
    });

    // documents — accepted by their signatures (never gated on positive family)
    it("application/msword (OLE) accepted", () =>
      accept("application/msword", sample.ole()));
    it("application/vnd.ms-powerpoint (OLE) accepted", () =>
      accept("application/vnd.ms-powerpoint", sample.ole()));
    it("docx (ZIP) accepted", () =>
      accept(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sample.zip()
      ));
    it("pptx (ZIP) accepted", () =>
      accept(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sample.zip()
      ));
    it("application/rtf accepted", () => accept("application/rtf", sample.rtf()));
    it("text/plain (no signature) accepted", () =>
      accept("text/plain", sample.txt()));
    it("text/markdown (no signature) accepted", () =>
      accept("text/markdown", sample.md()));
  });

  // ── Disguise cases: must be REJECTED ──────────────────────────────────────
  describe("cross-kind / markup / executable disguises are REJECTED", () => {
    const reject = (mime: string, buf: Buffer) => {
      const r = detectMimeMismatch(mime, buf);
      expect(r.reject).toBe(true);
      expect(r.reason).toBeTruthy();
    };

    it("markup (SVG) claimed as image/png is rejected", () =>
      reject("image/png", sample.svg()));
    it("markup (HTML) claimed as image/jpeg is rejected", () =>
      reject("image/jpeg", sample.html()));
    it("markup claimed as application/pdf is rejected", () =>
      reject("application/pdf", sample.svg()));
    it("markup claimed as video/mp4 is rejected", () =>
      reject("video/mp4", sample.svg()));

    it("PDF bytes claimed as image/png are rejected", () =>
      reject("image/png", sample.pdf()));
    it("ZIP bytes claimed as image/jpeg are rejected", () =>
      reject("image/jpeg", sample.zip()));
    it("OLE bytes claimed as image/png are rejected", () =>
      reject("image/png", sample.ole()));

    it("ELF executable claimed as image/png is rejected", () =>
      reject("image/png", sample.elf()));
    it("PE/MZ executable claimed as image/jpeg is rejected", () =>
      reject("image/jpeg", sample.pe()));
    it("executable claimed as a document is also rejected", () =>
      reject("text/plain", sample.elf()));
    it("executable claimed as application/pdf is rejected", () =>
      reject("application/pdf", sample.pe()));

    it("a DIFFERENT image format claimed (PNG bytes as image/jpeg) is accepted (same kind)", () => {
      // Same kind (image) → intra-kind, we don't gate on exact sub-format.
      expect(detectMimeMismatch("image/jpeg", sample.png()).reject).toBe(false);
    });

    it("mp4 (isobmff) claimed as image/png is ACCEPTED — ftyp is ambiguous between image(avif/heic) and video, so we stay lenient (harmless mismatch, not an XSS disguise)", () =>
      expect(detectMimeMismatch("image/png", sample.mp4()).reject).toBe(false));
    it("image (png) claimed as audio/mpeg is rejected", () =>
      reject("audio/mpeg", sample.png()));
    it("media (OggS) claimed as application/pdf is rejected", () =>
      reject("application/pdf", sample.oggS()));
  });

  // ── Intra-kind ambiguity: stay LENIENT across audio↔video ─────────────────
  describe("intra-kind container ambiguity stays lenient", () => {
    it("mp4 bytes accepted as BOTH video/mp4 and audio/mp4", () => {
      expect(detectMimeMismatch("video/mp4", sample.mp4()).reject).toBe(false);
      expect(detectMimeMismatch("audio/mp4", sample.mp4()).reject).toBe(false);
    });
    it("m4a bytes accepted as BOTH audio/mp4 and video/mp4", () => {
      expect(detectMimeMismatch("audio/mp4", sample.m4a()).reject).toBe(false);
      expect(detectMimeMismatch("video/mp4", sample.m4a()).reject).toBe(false);
    });
    it("OggS accepted as both audio/ogg and video/ogg", () => {
      expect(detectMimeMismatch("audio/ogg", sample.oggS()).reject).toBe(false);
      expect(detectMimeMismatch("video/ogg", sample.oggS()).reject).toBe(false);
    });
    it("EBML accepted as both audio/webm and video/webm", () => {
      expect(detectMimeMismatch("audio/webm", sample.webmEbml()).reject).toBe(
        false
      );
      expect(detectMimeMismatch("video/webm", sample.webmEbml()).reject).toBe(
        false
      );
    });
    it("mp3 frame-sync accepted as audio/aac too (mp3/aac overlap)", () => {
      expect(detectMimeMismatch("audio/aac", sample.mp3Sync()).reject).toBe(false);
      expect(detectMimeMismatch("audio/mpeg", sample.aacAdts()).reject).toBe(false);
    });
  });

  // ── Unknown / garbage signatures: accept (lenient default) ────────────────
  describe("unknown signatures are accepted (allowlist default-accept)", () => {
    it("garbage bytes claimed as image/png are accepted", () =>
      expect(detectMimeMismatch("image/png", sample.garbage()).reject).toBe(
        false
      ));
    it("garbage bytes claimed as application/pdf are accepted", () =>
      expect(detectMimeMismatch("application/pdf", sample.garbage()).reject).toBe(
        false
      ));
    it("garbage bytes claimed as audio/mpeg are accepted", () =>
      expect(detectMimeMismatch("audio/mpeg", sample.garbage()).reject).toBe(
        false
      ));
    it("empty buffer is accepted (no signature to contradict)", () =>
      expect(detectMimeMismatch("image/png", Buffer.alloc(0)).reject).toBe(false));
    it("plain text claimed as text/plain is accepted", () =>
      expect(detectMimeMismatch("text/plain", sample.txt()).reject).toBe(false));
  });

  // ── detectContentFamily direct unit checks ────────────────────────────────
  describe("detectContentFamily classification", () => {
    it("classifies images", () => {
      expect(detectContentFamily(sample.png())).toBe("image");
      expect(detectContentFamily(sample.jpegExif())).toBe("image");
      expect(detectContentFamily(sample.gif87())).toBe("image");
      expect(detectContentFamily(sample.webp())).toBe("image");
      // avif/heic are ISOBMFF (ftyp) → 'isobmff' (ambiguous with mp4/mov);
      // image kind accepts isobmff, so these remain valid images.
      expect(detectContentFamily(sample.avif())).toBe("isobmff");
      expect(detectContentFamily(sample.avifCompat())).toBe("isobmff");
    });
    it("classifies pdf", () =>
      expect(detectContentFamily(sample.pdf())).toBe("pdf"));
    it("classifies media (audio+video merged)", () => {
      expect(detectContentFamily(sample.wav())).toBe("media");
      expect(detectContentFamily(sample.oggS())).toBe("media");
      expect(detectContentFamily(sample.webmEbml())).toBe("media");
      expect(detectContentFamily(sample.flac())).toBe("media");
      // ftyp / QuickTime containers → 'isobmff' (shared by mp4/mov AND
      // avif/heic); audio & video kinds both accept isobmff.
      expect(detectContentFamily(sample.mp4())).toBe("isobmff");
      expect(detectContentFamily(sample.mov())).toBe("isobmff");
      expect(detectContentFamily(sample.movMoov())).toBe("isobmff");
      expect(detectContentFamily(sample.mp3Sync())).toBe("media");
    });
    it("classifies markup / zip / ole / rtf / executable", () => {
      expect(detectContentFamily(sample.svg())).toBe("markup");
      expect(detectContentFamily(sample.html())).toBe("markup");
      expect(detectContentFamily(sample.zip())).toBe("zip");
      expect(detectContentFamily(sample.ole())).toBe("ole");
      expect(detectContentFamily(sample.rtf())).toBe("rtf");
      expect(detectContentFamily(sample.elf())).toBe("executable");
      expect(detectContentFamily(sample.pe())).toBe("executable");
    });
    it("returns null for unknown / no-signature content", () => {
      expect(detectContentFamily(sample.garbage())).toBeNull();
      expect(detectContentFamily(sample.txt())).toBeNull();
      expect(detectContentFamily(Buffer.alloc(0))).toBeNull();
    });
    it("does NOT misclassify RIFF/WAVE as image (must read offset 8)", () => {
      expect(detectContentFamily(sample.wav())).not.toBe("image");
    });
    it("does NOT classify a video-brand ftyp as image", () => {
      expect(detectContentFamily(sample.mp4())).not.toBe("image");
      expect(detectContentFamily(sample.mov())).not.toBe("image");
    });
  });
});
