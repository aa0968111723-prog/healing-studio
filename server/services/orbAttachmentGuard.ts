import type { Message } from "../_core/llm";

export interface AttachmentGuardResult {
  ok: boolean;
  reason?: "too_large" | "unsupported";
  message?: string;
  totalBytes: number;
  kinds: Array<"image" | "audio" | "video" | "pdf" | "text" | "unknown">;
}

const LIMITS = {
  image: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 40 * 1024 * 1024,
  pdf: 12 * 1024 * 1024,
  // Text-like documents (txt/md/docx) are usually inlined client-side, but
  // they may still arrive as file_url through replayed history; keep the
  // cap aligned with the rough docx upper bound.
  text: 12 * 1024 * 1024,
};

const FRIENDLY = "這個檔案太大，我目前無法直接處理。請壓縮後再上傳，或先轉成較短的 MP3 / MP4 / PDF 摘要。";

const PDF_MIME_EQUIVALENTS = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/acrobat",
  "applications/vnd.pdf",
]);

const TEXT_MIME_EQUIVALENTS = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function inferKind(
  mime?: string
): "image" | "audio" | "video" | "pdf" | "text" | "unknown" {
  const lower = String(mime ?? "").trim().toLowerCase();
  if (!lower) return "unknown";
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  // Use explicit MIME equality rather than `.includes("pdf")` so a
  // hypothetical `text/pdf-injection-attack` can't sneak through; also
  // covers vendor variants like `application/x-pdf`.
  if (PDF_MIME_EQUIVALENTS.has(lower)) return "pdf";
  if (TEXT_MIME_EQUIVALENTS.has(lower)) return "text";
  return "unknown";
}

function getDeclaredSize(part: Record<string, unknown>): number {
  if (typeof part.sizeBytes === "number" && Number.isFinite(part.sizeBytes)) return Math.max(0, part.sizeBytes);
  const nested = part.file_url;
  if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).size_bytes === "number") {
    return Math.max(0, Number((nested as Record<string, unknown>).size_bytes));
  }
  return 0;
}

export function validateAttachmentGuards(messages: Message[]): AttachmentGuardResult {
  let totalBytes = 0;
  const kinds: AttachmentGuardResult["kinds"] = [];
  for (const message of messages) {
    const contentParts = Array.isArray(message.content) ? message.content : [];
    for (const raw of contentParts) {
      if (!raw || typeof raw !== "object") continue;
      const part = raw as Record<string, unknown>;
      const type = String(part.type ?? "");
      if (type !== "file_url" && type !== "image_url") continue;

      const mime = type === "image_url"
        ? "image/*"
        : String(((part.file_url as Record<string, unknown> | undefined)?.mime_type) ?? "");
      const kind = type === "image_url" ? "image" : inferKind(mime);
      kinds.push(kind);

      if (kind === "unknown") {
        return { ok: false, reason: "unsupported", message: "這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4，或貼文字內容。", totalBytes, kinds };
      }

      const size = getDeclaredSize(part);
      totalBytes += size;
      const max = LIMITS[kind];
      if (size > max) {
        return { ok: false, reason: "too_large", message: FRIENDLY, totalBytes, kinds };
      }
    }
  }

  return { ok: true, totalBytes, kinds };
}
