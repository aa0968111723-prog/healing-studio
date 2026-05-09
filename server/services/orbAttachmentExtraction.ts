/**
 * orbAttachmentExtraction — server-side fallback that turns PDF attachments
 * into inlined text so a text-only LLM can still answer when the multimodal
 * provider (Gemini) is offline or unconfigured.
 *
 * The orb chat flow normally relies on Gemini to natively read PDF / image /
 * audio / video. When `selectProvider({ intent: "planner_pdf" })` returns no
 * healthy provider (typically because `GEMINI_API_KEY` is missing), we don't
 * want to dead-end the user with "please paste the script". Instead, for PDFs
 * we fetch the file ourselves, extract the text via `unpdf`, and rewrite the
 * planner messages so the PDF `file_url` part becomes inline text. After that
 * the route intent collapses to `planner_text`, which `default_llm` handles.
 *
 * Other binary kinds (image / audio / video) are not handled here — the orb
 * still surfaces a friendly "describe it in text" fallback for those because
 * we can't synthesize a sensible text replacement for them server-side.
 */
import type { Message, MessageContent, FileContent } from "../_core/llm";
import { logger } from "../_core/logger";
import { extractPdfTextFromUrl, type PdfTextExtractionOptions } from "./pdfTextExtractor";

export interface OrbAttachmentExtractionResult {
  /** Rewritten planner messages with PDF file_url parts replaced by text. */
  messages: Message[];
  /** Number of PDFs we successfully extracted text from. */
  extractedCount: number;
  /** Number of PDFs that could not be extracted (download / parse failure). */
  failedCount: number;
  /** True when at least one binary attachment is still present (image/audio/video). */
  hasUnextractableBinary: boolean;
}

function isFileUrlPart(part: unknown): part is FileContent {
  if (!part || typeof part !== "object") return false;
  const candidate = part as { type?: unknown };
  return candidate.type === "file_url";
}

function isPdfPart(part: FileContent): boolean {
  const mime = part.file_url?.mime_type ?? "";
  return String(mime).toLowerCase().includes("pdf");
}

function isUnextractableBinaryPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const candidate = part as { type?: unknown };
  if (candidate.type === "image_url") return true;
  if (candidate.type === "file_url" && isFileUrlPart(part) && !isPdfPart(part)) {
    const mime = (part.file_url?.mime_type ?? "").toLowerCase();
    if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) {
      return true;
    }
  }
  return false;
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const decoded = decodeURIComponent(last);
    return decoded || "uploaded.pdf";
  } catch {
    return "uploaded.pdf";
  }
}

function buildInlinedPdfText(name: string, body: string, truncated: boolean): string {
  const suffix = truncated ? "（內容較長，已自動截斷）" : "";
  return `📎 附件「${name}」內容${suffix}：\n${body.trim()}`;
}

function buildExtractionFailureNote(name: string): string {
  return `📎 附件「${name}」：我這邊無法擷取 PDF 內文，可能是掃描檔或加密檔。建議直接把腳本內容貼到對話裡，我就能繼續協助。`;
}

/**
 * Walk every planner message, replacing PDF `file_url` parts with inline
 * text. Returns the rewritten message array along with counters used by the
 * caller for telemetry / decision-making.
 */
export async function extractPdfAttachmentsToText(
  messages: Message[],
  options: PdfTextExtractionOptions = {}
): Promise<OrbAttachmentExtractionResult> {
  let extractedCount = 0;
  let failedCount = 0;
  let hasUnextractableBinary = false;

  const rewritten: Message[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      rewritten.push(message);
      continue;
    }

    const nextParts: MessageContent[] = [];

    for (const rawPart of message.content) {
      if (isFileUrlPart(rawPart) && isPdfPart(rawPart)) {
        const url = rawPart.file_url.url;
        const name = fileNameFromUrl(url);
        const result = await extractPdfTextFromUrl(url, options).catch(err => {
          logger.warn("orbAttachmentExtraction.unexpected_error", {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });
        if (result) {
          extractedCount += 1;
          nextParts.push({
            type: "text",
            text: buildInlinedPdfText(name, result.text, result.truncated),
          });
        } else {
          failedCount += 1;
          nextParts.push({
            type: "text",
            text: buildExtractionFailureNote(name),
          });
        }
        continue;
      }

      if (isUnextractableBinaryPart(rawPart)) {
        hasUnextractableBinary = true;
      }
      nextParts.push(rawPart as MessageContent);
    }

    rewritten.push({ ...message, content: nextParts });
  }

  return { messages: rewritten, extractedCount, failedCount, hasUnextractableBinary };
}

export function countPdfAttachments(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isFileUrlPart(part) && isPdfPart(part)) total += 1;
    }
  }
  return total;
}
