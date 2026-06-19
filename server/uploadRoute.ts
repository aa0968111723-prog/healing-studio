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
  return i < buffer.length && buffer[i] === 0x3c; // '<'
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

    // AIDV-64: reject binary media whose actual bytes are markup
    // (SVG/HTML/XML disguised as image/pdf/etc. = stored-XSS vector).
    if (BINARY_MEDIA_KINDS.has(kind) && looksLikeMarkup(buffer)) {
      res.status(415).json({
        error:
          "File content does not match its declared type (looks like markup, not a binary file).",
      });
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
    const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1) : "";
    const baseNameRaw = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const safeName = baseNameRaw.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileKey = `uploads/${user.id}/${safeName}-${suffix}${ext ? "." + ext : ""}`;

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
  inferKind,
  looksLikeMarkup,
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
