import { fileTypeFromBuffer } from "file-type";

export class FileTypeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTypeValidationError";
  }
}

// MIME types that are always blocked — never valid media content.
// file-type detects these from magic bytes, so a disguised upload is caught
// even when the Content-Type header lies.
const BLOCKED_MIMES = new Set([
  "text/html",
  "text/xml",
  "application/xml",
  "image/svg+xml", // can embed <script> tags
  "application/x-shellscript",
  "application/x-executable",
  "application/x-elf",
  "application/x-dosexec",
  "application/x-mach-binary",
]);

// Strict allowlist for user-initiated uploads. SVG excluded (AIDV-64).
const ALLOWED_UPLOAD_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
]);

/**
 * Strict magic-byte validation for user-initiated uploads.
 * Throws FileTypeValidationError if the content is unrecognised or not
 * in the upload allowlist. Supplements (not replaces) the MIME header allowlist
 * in uploadRoute.ts — provides a second layer using file-type signatures.
 */
export async function validateFileType(
  buffer: Buffer
): Promise<{ mime: string; ext: string }> {
  const result = await fileTypeFromBuffer(buffer.slice(0, 4100));
  if (!result) {
    throw new FileTypeValidationError("無法識別的檔案格式（magic bytes 未知）");
  }
  if (BLOCKED_MIMES.has(result.mime)) {
    throw new FileTypeValidationError(`不允許的格式：${result.mime}`);
  }
  if (!ALLOWED_UPLOAD_MIMES.has(result.mime)) {
    throw new FileTypeValidationError(
      `不支援的格式：${result.mime}（僅接受圖片/影片/音訊）`
    );
  }
  return result;
}

/**
 * Lenient magic-byte check for externally-fetched media (AI provider outputs).
 * Only blocks positively-detected dangerous content (markup, executables).
 * Unknown signatures pass through (default-accept, per AIDV-64/AIDV-315 design).
 */
export async function assertSafeMediaBytes(buffer: Buffer): Promise<void> {
  const result = await fileTypeFromBuffer(buffer.slice(0, 4100));
  if (!result) return; // unknown signature → stay lenient
  if (BLOCKED_MIMES.has(result.mime)) {
    throw new FileTypeValidationError(`外部媒體內容不安全：${result.mime}`);
  }
}
