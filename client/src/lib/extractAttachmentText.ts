/**
 * extractAttachmentText — pulls plain-text content out of text-like
 * attachments (txt / md / docx) entirely on the client. The result is stored
 * in `OrbChatAttachment.extractedText` so `chatMessageToLLMContent` can
 * inline it into the LLM message; we never rely on the LLM to natively parse
 * `.docx`, which it can't.
 */

import JSZip from "jszip";
import type { OrbChatAttachmentMimeType } from "../../../shared/orb-chat-multimodal";

export class AttachmentTextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentTextExtractionError";
  }
}

async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}

/**
 * docx files are ZIP archives whose `word/document.xml` entry holds the body
 * paragraphs. We unzip in-browser, strip the XML markup, and return the
 * concatenated text. No third-party docx parser required.
 */
async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new AttachmentTextExtractionError(
      `無法解析 .docx 內容：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const docEntry =
    zip.file("word/document.xml") ?? zip.file("word/document2.xml");
  if (!docEntry) {
    throw new AttachmentTextExtractionError(
      "找不到 word/document.xml — 這可能不是標準的 .docx 檔。",
    );
  }

  const xml = await docEntry.async("string");

  // Convert paragraph + line break tags into newlines so list items and
  // multi-line scripts retain readable structure, then drop every other tag.
  // The self-closing form `<w:p w14:paraId="..."/>` is what Word emits for
  // empty paragraphs (very common as scene separators); the previous
  // `<w:p\/>` literal missed those entirely and silently merged scenes.
  const withBreaks = xml
    .replace(/<w:p\b[^>]*\/>/g, "\n")
    .replace(/<w:p\b[^>]*>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");

  // Decode the small set of XML entities Word emits.
  const decoded = stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

const TEXT_LIKE_MIMES: ReadonlySet<OrbChatAttachmentMimeType> = new Set<
  OrbChatAttachmentMimeType
>([
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isTextLikeMime(mime: OrbChatAttachmentMimeType): boolean {
  return TEXT_LIKE_MIMES.has(mime);
}

export async function extractAttachmentText(
  file: File,
  mime: OrbChatAttachmentMimeType,
): Promise<string> {
  if (mime === "text/plain" || mime === "text/markdown") {
    return (await readFileAsText(file)).trim();
  }
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return await extractDocxText(file);
  }
  throw new AttachmentTextExtractionError(`不支援的文字附件格式：${mime}`);
}
