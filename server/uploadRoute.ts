import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import { authenticateRequest } from "./_core/googleAuth";

const uploadRouter = Router();

// ── Allowed MIME types for upload ─────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // image/svg+xml intentionally NOT allowed (AIDV-64): SVG can embed
  // <script>/<foreignObject> → stored XSS when the asset URL is opened.
  "image/avif",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  // Video
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  // Documents
  "application/pdf",
  // Office / text documents — used by the teaching-archive feature for
  // class slides and discourse transcripts. Treated as the `document`
  // kind below; storage-backed like every other upload.
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain", // .txt
  "text/markdown", // .md
  "application/rtf", // .rtf
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/rtf",
]);

// ── AIDV-64: storage extension is derived from the VALIDATED mime, never from
// the user-supplied filename. This stops a markup/script body uploaded under a
// document/text mime (e.g. text/plain) but named "x.html" from being stored at
// a .html object key and then served as executable HTML by extension-based
// handlers (express.static / many CDNs) — a stored-XSS bypass of the guard.
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/rtf": "rtf",
};

// The stored object key's extension — always derived from the validated mime,
// falling back to a non-executable ".bin" for anything unmapped. The result is
// never a script-capable extension (.html/.svg/.js/…).
function safeStorageExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? "bin";
}

// ── Size policy (Issue #178) ───────────────────────────────────────────────
// Per-kind hard ceilings, aligned with server/services/orbAttachmentGuard.ts
// so the upload endpoint and the LLM-side guard agree on what "too big" means.
const PER_KIND_MAX_BYTES = {
  image: 10 * 1024 * 1024, // 10 MB
  audio: 20 * 1024 * 1024, // 20 MB
  video: 40 * 1024 * 1024, // 40 MB
  pdf: 12 * 1024 * 1024, // 12 MB
  document: 25 * 1024 * 1024, // 25 MB — PPT/DOC/TXT/MD for teaching archive
} as const;

const ABSOLUTE_MAX_BYTES = 40 * 1024 * 1024; // hard ceiling for any kind

// Files larger than this MUST be referenced by storage URL only — they may
// never be re-inlined as base64 into an LLM request (Issue #178). The
// response carries `inlineEligible=false` so multimodal helpers know to keep
// the file at the URL boundary.
const INLINE_BASE64_THRESHOLD = 1 * 1024 * 1024; // 1 MB

// video/* and audio/* are *always* storage-only, regardless of size: even a
// 200 KB MP4 should not be inlined as base64 into a Gemini/OpenAI prompt
// because most providers do not support inline video/audio data URIs and the
// 1.33× JSON inflation hurts request latency for no benefit.
const STORAGE_ONLY_KIND_PREFIXES = ["video/", "audio/"];

type FileKind = "image" | "audio" | "video" | "pdf" | "document";

function inferKind(mimeType: string): FileKind {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  if (lower === "application/pdf") return "pdf";
  if (DOCUMENT_MIME_TYPES.has(lower)) return "document";
  return "pdf"; // legacy fallback — preserves existing behaviour for anything that slipped past the allowlist
}

// ── AIDV-64: content/MIME mismatch guard (magic-byte sanity) ────────────────
// A binary media kind (image/audio/video/pdf) must never actually be markup.
// SVG / HTML / XML disguised as an image (or pdf, etc.) is the stored-XSS
// vector: an "image" that is really `<svg><script>…`. Real binary media never
// starts with `<`, so checking for a leading `<` (after BOM + whitespace)
// closes the disguise vector with effectively zero false positives. Document
// kinds (txt/md/rtf/office) are excluded — they are served as non-rendered
// downloads and may legitimately begin with markup-ish text.
const BINARY_MEDIA_KINDS: ReadonlySet<FileKind> = new Set([
  "image",
  "audio",
  "video",
  "pdf",
]);

function looksLikeMarkup(buffer: Buffer): boolean {
  let i = 0;
  let utf16be = false;
  if (
    // UTF-8 BOM
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    i = 3;
  } else if (
    // UTF-16 LE / BE BOM
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) ||
      (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    utf16be = buffer[0] === 0xfe; // FE FF = big-endian
    i = 2;
  }
  // skip leading ASCII whitespace (space, tab, LF, CR)
  while (
    i < buffer.length &&
    (buffer[i] === 0x20 ||
      buffer[i] === 0x09 ||
      buffer[i] === 0x0a ||
      buffer[i] === 0x0d)
  ) {
    i++;
  }
  // For UTF-16-BE, the high byte of the first code unit is a leading NUL
  // (e.g. '<' encodes as 00 3C). Skip that single NUL so BE markup is caught.
  // We only do this when a UTF-16-BE BOM was actually present, to avoid
  // treating a stray 00 in arbitrary binary as a markup lead-in.
  if (utf16be && i < buffer.length && buffer[i] === 0x00) i++;
  return i < buffer.length && buffer[i] === 0x3c; // '<'
}

// ── AIDV-64: per-format magic-byte content sniffing ─────────────────────────
// This UPGRADES the simple looksLikeMarkup() guard into a full allowlist-model
// content classifier. We sniff the leading bytes, map them to a coarse "family"
// (the kind set the magic actually proves), and reject only when the claimed
// MIME's kind is CLEARLY incompatible with what the bytes positively are.
//
// Design principles (from the authoritative signature research):
//   1. ALLOWLIST + default-accept-on-unknown: an unrecognised leading
//      signature is NOT proof of a disguise, so we stay lenient and accept it.
//      We only REJECT on a *positive* match to an incompatible format.
//   2. Treat audio+video as ONE "media" bucket: OggS / ftyp / EBML containers
//      are genuinely ambiguous between audio and video, so we never reject
//      across the audio/video line.
//   3. Wildcard every length/size field (WebP bytes 4-7, ISOBMFF box size
//      0-3) — they are file-specific and must never be matched literally.
//   4. Never require optional/variant bytes (JPEG 4th byte, JFIF/Exif tag,
//      specific WebP sub-format, specific AVIF box size).

// The coarse content families a buffer can be POSITIVELY detected as.
type ContentFamily =
  | "markup" // SVG / HTML / XML / XHTML
  | "image" // raster image (jpeg/png/gif/webp/avif)
  | "pdf"
  | "media" // audio OR video — intentionally merged (container ambiguity)
  | "isobmff" // ftyp / QuickTime container: mp4/m4a/mov/avif/heic share it
  | "ole" // legacy MS-Office / OLE compound (.doc/.xls/.ppt/.msi)
  | "zip" // ZIP / OOXML (.docx/.pptx/.xlsx/.jar/.apk/.epub/.zip)
  | "rtf"
  | "executable"; // PE/ELF/Mach-O/shebang

function startsWith(buffer: Buffer, sig: number[], offset = 0): boolean {
  if (buffer.length < offset + sig.length) return false;
  for (let k = 0; k < sig.length; k++) {
    if (buffer[offset + k] !== sig[k]) return false;
  }
  return true;
}

// Read a 4-byte ASCII tag at the given offset, or "" if out of range.
function fourCC(buffer: Buffer, offset: number): string {
  if (buffer.length < offset + 4) return "";
  return buffer.toString("latin1", offset, offset + 4);
}

// NOTE: ISOBMFF (ftyp) files — mp4/m4a/mov AND avif/heic still images — all
// share the same container. Distinguishing image-vs-video by ftyp brand is
// fragile (compatible-brand lists, 64-bit largesize boxes, brand variants) and
// caused a false-reject of real mp4s that list 'avif' as a compatible brand.
// So we classify ALL ftyp as one ambiguous 'isobmff' family (see
// detectContentFamily) and let it satisfy image/audio/video kinds alike — none
// of which is a security-relevant disguise.

/**
 * Positively classify a buffer's content family from its magic bytes, or
 * return null when nothing recognisable matches (→ stay lenient / accept).
 */
function detectContentFamily(buffer: Buffer): ContentFamily | null {
  // 0) Markup first — handles BOM + whitespace, the stored-XSS vector.
  if (looksLikeMarkup(buffer)) return "markup";

  // 1) Executables — never a valid upload of any allowed kind.
  if (startsWith(buffer, [0x4d, 0x5a])) return "executable"; // 'MZ' PE/DOS
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) return "executable"; // ELF
  if (startsWith(buffer, [0x23, 0x21])) return "executable"; // '#!' shebang
  if (
    startsWith(buffer, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(buffer, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe]) // Mach-O / fat binary
  ) {
    return "executable";
  }

  // 2) Documents / archives that disguise as media.
  if (
    startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip"; // ZIP / OOXML
  }
  if (
    startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  ) {
    return "ole"; // legacy OLE compound (.doc/.xls/.ppt/.msi)
  }
  if (startsWith(buffer, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return "rtf"; // '{\rtf'

  // 3) PDF — '%PDF-' at offset 0 (lenient strict-start match).
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";

  // 4) Images.
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image"; // JPEG (any 4th byte)
  if (
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image"; // PNG / APNG
  }
  if (
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || // GIF87a
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
  ) {
    return "image";
  }
  if (
    // RIFF....WEBP — 'RIFF' @0 + 'WEBP' @8 (bytes 4-7 wildcarded).
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image";
  }
  // 5) Media (audio OR video) — merged bucket.
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) return "media"; // 'OggS'
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return "media"; // EBML (webm/mkv)
  if (startsWith(buffer, [0x66, 0x4c, 0x61, 0x43])) return "media"; // 'fLaC'
  if (
    // RIFF....WAVE — WAV audio.
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x41, 0x56, 0x45], 8)
  ) {
    return "media";
  }
  if (startsWith(buffer, [0x49, 0x44, 0x33])) return "media"; // 'ID3' (mp3/aac)
  // MPEG/AAC frame sync: FF Ex / FF Fx (mask 0xE0 on 2nd byte).
  if (
    buffer.length >= 2 &&
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0
  ) {
    return "media";
  }
  // 6) ISOBMFF container (ftyp: mp4/m4a/mov/avif/heic) + brandless QuickTime
  // boxes. Image and audio/video share this container and are genuinely
  // ambiguous at the byte level → ONE 'isobmff' family compatible with
  // image/audio/video so we never false-reject across them.
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) return "isobmff"; // ftyp @4
  {
    const box = fourCC(buffer, 4);
    if (
      box === "moov" ||
      box === "mdat" ||
      box === "wide" ||
      box === "free" ||
      box === "skip"
    ) {
      return "isobmff";
    }
  }

  return null; // unknown / no signature → caller stays lenient
}

// The set of content families that are compatible with a claimed FileKind.
// A positive detection OUTSIDE this set (and not "markup", handled by the
// stricter rule below) is a confirmed cross-kind disguise → reject.
const KIND_COMPATIBLE_FAMILIES: Record<FileKind, ReadonlySet<ContentFamily>> = {
  // image accepts 'image' raster sigs AND 'isobmff' (avif/heic share the mp4
  // container; we don't try to distinguish them from video by brand).
  image: new Set<ContentFamily>(["image", "isobmff"]),
  // audio & video share the same containers — accept the merged 'media' family
  // and 'isobmff' for BOTH. We keep them lenient toward each other but strict
  // against non-media binaries (markup/pdf/zip/ole/executable).
  audio: new Set<ContentFamily>(["media", "isobmff"]),
  video: new Set<ContentFamily>(["media", "isobmff"]),
  pdf: new Set<ContentFamily>(["pdf"]),
  // Document kinds map to many possible families (office=zip/ole, rtf, plain
  // text has no signature). We do NOT gate documents on a positive content
  // family — only markup/executable disguises are rejected below.
  document: new Set<ContentFamily>(["zip", "ole", "rtf", "pdf", "image", "media", "isobmff"]),
};

export interface MimeMismatchResult {
  reject: boolean;
  reason?: string;
}

/**
 * AIDV-64 full per-format guard. Decides whether the actual bytes contradict
 * the CLAIMED MIME type in a security-relevant way. Pure function — same input
 * always yields the same output, no Express/storage coupling.
 *
 * Reject only on CLEAR, security-relevant disguises:
 *   (a) markup (SVG/HTML/XML) claimed as a binary media kind;
 *   (b) an executable claimed as anything (never a valid upload);
 *   (c) a binary media kind (image/audio/video/pdf) whose bytes POSITIVELY
 *       match a different, incompatible family (e.g. PDF-as-png, zip-as-jpeg,
 *       OLE-as-image, a different image format, media-as-image, …).
 *
 * Stay lenient (accept) when:
 *   - the signature is unknown / unrecognised (default-accept);
 *   - intra-kind container ambiguity (audio↔video via OggS/ftyp/EBML);
 *   - document/text kinds, unless they are executable or markup-as-binary.
 */
function detectMimeMismatch(
  claimedMime: string,
  buffer: Buffer
): MimeMismatchResult {
  const kind = inferKind(claimedMime);
  const family = detectContentFamily(buffer);

  // Executables are never a valid upload of ANY allowed kind.
  if (family === "executable") {
    return {
      reject: true,
      reason:
        "File content is an executable binary, which is never an allowed upload.",
    };
  }

  // Markup disguised as a binary media kind = the stored-XSS vector.
  if (family === "markup") {
    if (BINARY_MEDIA_KINDS.has(kind)) {
      return {
        reject: true,
        reason:
          "File content does not match its declared type (looks like markup, not a binary file).",
      };
    }
    // Documents/text legitimately may be markup-ish text → accept.
    return { reject: false };
  }

  // No positive signature → stay lenient (allowlist default-accept).
  if (family === null) return { reject: false };

  // Positive signature: reject only when it is incompatible with the kind.
  const compatible = KIND_COMPATIBLE_FAMILIES[kind];
  if (!compatible.has(family)) {
    return {
      reject: true,
      reason: `File content does not match its declared type: claimed ${claimedMime} but the bytes are ${family}.`,
    };
  }

  return { reject: false };
}

export interface UploadResponseBody {
  success: true;
  url: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  /**
   * Issue #178: tells multimodal helpers whether they may re-inline this file
   * as base64 in an LLM request. False means "must reference via storage URL".
   * Always false for video/* and audio/*, and for any file > 1 MB.
   */
  inlineEligible: boolean;
  /**
   * Always true once this endpoint returns success — the file is sitting in
   * S3/R2/GCS (whatever storagePut points to) and accessible via `url`.
   * Provided so callers can assert `storageBacked === true` instead of
   * inspecting the URL shape.
   */
  storageBacked: true;
  /**
   * Hint shown to dev-tools / orb attachment UI when the file exceeded the
   * inline threshold or is in a kind that must always be storage-backed.
   */
  inlineRecommendation: "inline-ok" | "use-storage-url" | "use-storage-url-required";
}

// Parse raw body for file uploads (multipart handled manually via base64 JSON)
// We use JSON-based upload: { fileName, mimeType, data (base64) }
uploadRouter.post("/api/upload", async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { fileName, mimeType, data } = req.body as {
      fileName: string;
      mimeType: string;
      data: string; // base64 encoded
    };

    if (!fileName || !mimeType || !data) {
      res.status(400).json({ error: "Missing fileName, mimeType, or data" });
      return;
    }

    // Validate MIME type against allowlist
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      res.status(415).json({ error: `Unsupported file type: ${mimeType}` });
      return;
    }

    // Decode base64 data
    const buffer = Buffer.from(data, "base64");

    // Per-kind size enforcement (Issue #178). The previous flat 16 MB limit
    // was too generous for images and too tight for video, and didn't match
    // orbAttachmentGuard's per-kind limits — leading to "uploaded fine but
    // rejected at chat time" UX bugs.
    const kind = inferKind(mimeType);

    // AIDV-64: full per-format magic-byte guard. Rejects clear, security-
    // relevant disguises (markup-as-binary, executables, and a binary media
    // kind whose bytes positively match a different incompatible format),
    // while staying lenient on unknown signatures and audio↔video ambiguity.
    const mismatch = detectMimeMismatch(mimeType, buffer);
    if (mismatch.reject) {
      res.status(415).json({ error: mismatch.reason });
      return;
    }

    const perKindLimit = PER_KIND_MAX_BYTES[kind];
    if (buffer.length > perKindLimit || buffer.length > ABSOLUTE_MAX_BYTES) {
      const limitMb = Math.floor(perKindLimit / (1024 * 1024));
      res.status(413).json({
        error: `File too large for ${kind} uploads. Maximum size is ${limitMb} MB.`,
      });
      return;
    }

    // Generate a unique file key to prevent enumeration.
    // Strip the extension from the base name so it is not duplicated
    // (the extension is appended explicitly after the unique suffix)
    const suffix = nanoid(8);
    const dotIdx = fileName.lastIndexOf(".");
    const baseNameRaw = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const safeName = baseNameRaw.replace(/[^a-zA-Z0-9._-]/g, "_");
    // AIDV-64: extension comes from the validated mime, NOT the user filename —
    // so a markup body can never be stored under .html/.svg and served as HTML.
    const ext = safeStorageExt(mimeType);
    const fileKey = `uploads/${user.id}/${safeName}-${suffix}.${ext}`;

    // Upload to S3 via storagePut — storage-backed for *every* successful
    // response. Even small images go through storage so the URL shape is
    // consistent and we never return a base64 data URI from this endpoint.
    const { url, key } = await storagePut(fileKey, buffer, mimeType);

    // Decide whether downstream code may re-inline this file as base64.
    // video/audio: never inline (provider compatibility + bandwidth).
    // others: only inline when small enough to keep prompt size sane.
    const storageOnlyKind = STORAGE_ONLY_KIND_PREFIXES.some(prefix =>
      mimeType.startsWith(prefix)
    );
    const tooLargeToInline = buffer.length > INLINE_BASE64_THRESHOLD;
    const inlineEligible = !storageOnlyKind && !tooLargeToInline;
    const inlineRecommendation: UploadResponseBody["inlineRecommendation"] =
      storageOnlyKind
        ? "use-storage-url-required"
        : tooLargeToInline
          ? "use-storage-url"
          : "inline-ok";

    const responseBody: UploadResponseBody = {
      success: true,
      url,
      fileKey: key,
      fileName: safeName,
      mimeType,
      fileSizeBytes: buffer.length,
      inlineEligible,
      storageBacked: true,
      inlineRecommendation,
    };
    res.json(responseBody);
  } catch (error: any) {
    console.error("[Upload] Error:", error);
    if (
      error.message?.includes("authenticate") ||
      error.message?.includes("Unauthorized")
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Return a short, user-friendly error — avoid dumping long config instructions to the UI
    const isStorageError =
      error.message?.includes("Storage") ||
      error.message?.includes("S3") ||
      error.message?.includes("GCS") ||
      error.message?.includes("Forge");
    if (isStorageError) {
      res.status(503).json({
        error:
          "Storage 未設定：請聯絡管理員在 Railway 設定 S3/R2 儲存環境變數。",
      });
      return;
    }
    res
      .status(500)
      .json({ error: "Upload failed: " + (error.message || "Unknown error") });
  }
});

// Exported for unit tests so we don't have to spin up a real Express app to
// assert the inline-vs-storage decision policy.
export const __uploadRouteInternals = {
  PER_KIND_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  INLINE_BASE64_THRESHOLD,
  STORAGE_ONLY_KIND_PREFIXES,
  ALLOWED_MIME_TYPES,
  BINARY_MEDIA_KINDS,
  MIME_TO_EXT,
  inferKind,
  looksLikeMarkup,
  detectContentFamily,
  detectMimeMismatch,
  safeStorageExt,
  /**
   * Pure helper that mirrors the inlineEligible / inlineRecommendation
   * decision the route makes. Same input → same output, no Express coupling.
   */
  classifyInlineEligibility(mimeType: string, sizeBytes: number): {
    inlineEligible: boolean;
    inlineRecommendation: UploadResponseBody["inlineRecommendation"];
  } {
    const storageOnlyKind = STORAGE_ONLY_KIND_PREFIXES.some(prefix =>
      mimeType.startsWith(prefix)
    );
    const tooLargeToInline = sizeBytes > INLINE_BASE64_THRESHOLD;
    return {
      inlineEligible: !storageOnlyKind && !tooLargeToInline,
      inlineRecommendation: storageOnlyKind
        ? "use-storage-url-required"
        : tooLargeToInline
          ? "use-storage-url"
          : "inline-ok",
    };
  },
};

export { uploadRouter };
