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
import { sanitizeOrbUserText } from "../../shared/orb-prompt-defense";
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
  /** Prompt-defense triggers fired while sanitizing extracted PDF bodies. */
  injectionTriggers: string[];
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

interface SanitizedBody {
  text: string;
  triggers: string[];
}

/**
 * Run extracted PDF text through the same prompt-injection sanitizer the
 * user's typed message goes through. Without this, a malicious PDF could
 * embed "ignore previous instructions" / fake `<|system|>` role markers
 * and the text-only LLM would see them unfiltered when the multimodal
 * fallback inlines the body.
 */
function sanitizeExtractedBody(raw: string): SanitizedBody {
  const result = sanitizeOrbUserText(raw);
  return { text: result.sanitized, triggers: result.triggers };
}

function buildInlinedPdfText(name: string, body: string, truncated: boolean): string {
  const suffix = truncated ? "（內容較長，已自動截斷）" : "";
  return `📎 附件「${name}」內容${suffix}：\n${body.trim()}`;
}

function buildExtractionFailureNote(name: string): string {
  // Phrased as an instruction to the LLM so partial-failure runs (where
  // some PDFs succeed and one fails) don't silently produce a confident
  // answer that ignores the unreadable file. The reply must explicitly
  // mention which attachment was unreadable.
  return `📎 附件「${name}」：系統無法擷取 PDF 內文（可能是掃描檔或加密檔）。請在回覆開頭明確告訴使用者「附件「${name}」目前讀不到」，並建議他直接把該腳本內容貼到對話裡。`;
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
  // First pass: discover every unique PDF URL so we can fetch them all in
  // parallel. Sequential `await` per PDF was a real perf bug — three
  // attachments × 12 s timeout each = 36 s worst-case blocking, which
  // exceeded the outer route handler budget.
  const pdfUrls = new Set<string>();
  let hasUnextractableBinary = false;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isFileUrlPart(part) && isPdfPart(part)) {
        pdfUrls.add(part.file_url.url);
      } else if (isUnextractableBinaryPart(part)) {
        hasUnextractableBinary = true;
      }
    }
  }

  const extractionsByUrl = new Map<
    string,
    Awaited<ReturnType<typeof extractPdfTextFromUrl>>
  >();
  await Promise.all(
    Array.from(pdfUrls).map(async url => {
      const result = await extractPdfTextFromUrl(url, options).catch(err => {
        logger.warn("orbAttachmentExtraction.unexpected_error", {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      extractionsByUrl.set(url, result);
    })
  );

  let extractedCount = 0;
  let failedCount = 0;
  const allInjectionTriggers = new Set<string>();

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
        const result = extractionsByUrl.get(url) ?? null;
        if (result) {
          extractedCount += 1;
          const cleaned = sanitizeExtractedBody(result.text);
          cleaned.triggers.forEach(trigger => allInjectionTriggers.add(trigger));
          nextParts.push({
            type: "text",
            text: buildInlinedPdfText(name, cleaned.text, result.truncated),
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

      nextParts.push(rawPart as MessageContent);
    }

    rewritten.push({ ...message, content: nextParts });
  }

  return {
    messages: rewritten,
    extractedCount,
    failedCount,
    hasUnextractableBinary,
    injectionTriggers: Array.from(allInjectionTriggers),
  };
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
