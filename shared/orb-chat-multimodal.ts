import { z } from "zod";

export type OrbChatAttachmentKind = "image" | "video" | "audio" | "pdf" | "text";

export const ORB_CHAT_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  // Text-like documents — their bytes are extracted client-side into
  // `OrbChatAttachment.extractedText` and inlined into the LLM message as
  // plain text, so the model can actually read scripts users upload.
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type OrbChatAttachmentMimeType = (typeof ORB_CHAT_ATTACHMENT_MIME_TYPES)[number];

const TEXT_LIKE_MIME_TYPES: ReadonlySet<OrbChatAttachmentMimeType> = new Set<
  OrbChatAttachmentMimeType
>([
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isTextLikeOrbAttachmentMime(
  mime: OrbChatAttachmentMimeType
): boolean {
  return TEXT_LIKE_MIME_TYPES.has(mime);
}

export interface OrbChatAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: OrbChatAttachmentMimeType;
  kind: OrbChatAttachmentKind;
  /**
   * Plain-text content extracted from a text-like document (txt / md / docx)
   * on the client. When present, `chatMessageToLLMContent` inlines this into
   * the user's message body so the LLM can read it directly — `file_url`
   * parts can't help for formats the model doesn't natively parse.
   */
  extractedText?: string;
}

export type OrbChatLLMMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | {
      type: "file_url";
      file_url: {
        url: string;
        mime_type: OrbChatAttachmentMimeType;
        size_bytes?: number;
        duration_sec?: number;
        page_count?: number;
      };
    };

export type OrbChatLLMMessageContent = string | OrbChatLLMMessagePart[];

export const ORB_UPLOAD_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.txt,.md,.docx";

export const ORB_ALLOWED_MIME_TYPES = new Set<OrbChatAttachmentMimeType>(
  ORB_CHAT_ATTACHMENT_MIME_TYPES
);

/**
 * Some browsers (notably mobile Chrome/Safari pickers) report office documents
 * with vendor-specific MIME strings like `application/msword` or hand back an
 * empty `file.type`. We map those to the canonical types the rest of the
 * pipeline understands so a `.docx` script doesn't get silently rejected.
 */
const FALLBACK_MIME_BY_EXTENSION: Record<string, OrbChatAttachmentMimeType> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const LEGACY_MIME_ALIASES: Record<string, OrbChatAttachmentMimeType> = {
  "application/msword":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/x-markdown": "text/markdown",
};

export const ORB_UNSUPPORTED_ATTACHMENT_MESSAGE =
  "這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4 / TXT / DOCX，或直接貼文字內容。";

function fileExtension(fileName: string | undefined): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot + 1).toLowerCase().trim();
}

export function resolveOrbAttachmentKind(
  mimeType: string,
  fileName?: string
): { kind: OrbChatAttachmentKind; mimeType: OrbChatAttachmentMimeType } | null {
  const declared = mimeType.toLowerCase().trim();
  const aliased = (LEGACY_MIME_ALIASES[declared] ?? declared) as string;
  let normalized = aliased as OrbChatAttachmentMimeType;
  if (!ORB_ALLOWED_MIME_TYPES.has(normalized)) {
    const ext = fileExtension(fileName);
    const byExt = ext ? FALLBACK_MIME_BY_EXTENSION[ext] : undefined;
    if (!byExt) return null;
    normalized = byExt;
  }
  if (normalized.startsWith("image/")) return { kind: "image", mimeType: normalized };
  if (normalized.startsWith("video/")) return { kind: "video", mimeType: normalized };
  if (normalized.startsWith("audio/")) return { kind: "audio", mimeType: normalized };
  if (normalized === "application/pdf") return { kind: "pdf", mimeType: normalized };
  if (isTextLikeOrbAttachmentMime(normalized)) return { kind: "text", mimeType: normalized };
  return null;
}

/**
 * Maximum text characters inlined per text-kind attachment. Long scripts get
 * truncated with a marker so the LLM call doesn't blow through the token
 * budget on a 200-page document. 30k chars ≈ 7-8k tokens — generous for a
 * full short-film script while still bounded.
 */
const MAX_INLINED_TEXT_CHARS = 30_000;

function clipExtractedText(raw: string): string {
  const trimmed = raw.replace(/\r\n?/g, "\n").trim();
  if (trimmed.length <= MAX_INLINED_TEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_INLINED_TEXT_CHARS)}\n…(此處省略，原文較長)`;
}

function formatInlinedAttachment(attachment: OrbChatAttachment): string | null {
  if (attachment.kind !== "text") return null;
  const body = (attachment.extractedText ?? "").trim();
  if (!body) return null;
  return `📎 附件「${attachment.name}」內容：\n${clipExtractedText(body)}`;
}

export function attachmentToLLMMessagePart(
  attachment: OrbChatAttachment
): OrbChatLLMMessagePart {
  if (attachment.kind === "image") {
    return {
      type: "image_url",
      image_url: {
        url: attachment.url,
        detail: "auto",
      },
    };
  }

  if (attachment.kind === "text") {
    // Text-like documents (txt / md / docx) are inlined as plain text by
    // `chatMessageToLLMContent`. When a caller still asks for the part shape
    // (e.g. legacy code paths), surface the extracted body directly so the
    // model can read it instead of receiving a useless dead URL.
    return {
      type: "text",
      text: formatInlinedAttachment(attachment) ?? `📎 附件：${attachment.name}`,
    };
  }

  return {
    type: "file_url",
    file_url: {
      url: attachment.url,
      mime_type: attachment.mimeType,
    },
  };
}

export function chatMessageToLLMContent(input: {
  text: string;
  attachments?: OrbChatAttachment[];
}): OrbChatLLMMessageContent {
  const attachments = input.attachments ?? [];
  if (!attachments.length) return input.text;

  const textAttachments = attachments.filter(a => a.kind === "text");
  const binaryAttachments = attachments.filter(a => a.kind !== "text");

  const inlinedTextBlocks = textAttachments
    .map(formatInlinedAttachment)
    .filter((s): s is string => Boolean(s));

  const userBody = input.text.trim();
  const composedText = [userBody, ...inlinedTextBlocks]
    .filter(s => s.length > 0)
    .join("\n\n")
    .trim();

  if (binaryAttachments.length === 0) {
    // Pure text payload (or text + inlined script): return a string so the
    // server's existing text-only path keeps working.
    return composedText || "請參考我上傳的附件內容。";
  }

  return [
    {
      type: "text",
      text: composedText || "請參考我上傳的附件內容。",
    },
    ...binaryAttachments.map(a => {
      const part = attachmentToLLMMessagePart(a);
      return part as Extract<OrbChatLLMMessagePart, { type: "image_url" | "file_url" }>;
    }),
  ];
}

export function assertSupportedOrbAttachmentMimeType(mimeType: string): OrbChatAttachmentMimeType {
  const resolved = resolveOrbAttachmentKind(mimeType);
  if (!resolved) throw new Error(ORB_UNSUPPORTED_ATTACHMENT_MESSAGE);
  return resolved.mimeType;
}

export const OrbChatAttachmentMimeTypeSchema = z.enum(ORB_CHAT_ATTACHMENT_MIME_TYPES);

export const OrbChatLLMTextPartSchema = z.object({
  type: z.literal("text"),
  // AIDV-294: 32 K chars ≈ 8 K tokens; more than any real prompt needs.
  text: z.string().max(32_000),
});

/**
 * Issue #178: large media uploads must reference a stored object URL, not a
 * base64 data URI. We refuse `data:` URIs at the schema boundary so server
 * code never has to re-encode buffers into JSON for the LLM call.
 *
 * Note: `z.string().url()` accepts `data:` URIs (RFC 3986 schemes), so this
 * extra refinement is required even on top of the URL check.
 */
export const ORB_DATA_URI_REJECTED_MESSAGE =
  "Attachment URL must be a stored object URL (https://...). Inline data: URIs are not allowed; upload via /api/upload first.";

const storedObjectUrl = z
  .string()
  .url()
  .refine(value => !/^data:/i.test(value.trim()), {
    message: ORB_DATA_URI_REJECTED_MESSAGE,
  });

export const OrbChatLLMImageUrlPartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: storedObjectUrl,
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

export const OrbChatLLMFileUrlPartSchema = z.object({
  type: z.literal("file_url"),
  file_url: z.object({
    url: storedObjectUrl,
    mime_type: OrbChatAttachmentMimeTypeSchema,
    size_bytes: z.number().int().nonnegative().optional(),
    duration_sec: z.number().nonnegative().optional(),
    page_count: z.number().int().positive().optional(),
  }),
});

export const OrbChatLLMMessagePartSchema = z.union([
  OrbChatLLMTextPartSchema,
  OrbChatLLMImageUrlPartSchema,
  OrbChatLLMFileUrlPartSchema,
]);

export const OrbChatLLMMessageContentSchema = z.union([
  z.string(),
  z.array(OrbChatLLMMessagePartSchema),
]);

export const OrbChatRouterMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: OrbChatLLMMessageContentSchema,
});

export type OrbChatRouterMessage = z.infer<typeof OrbChatRouterMessageSchema>;

export function isMultimodalOrbChatContent(
  content: unknown
): content is OrbChatLLMMessagePart[] {
  if (!Array.isArray(content)) return false;
  return content.some(part => {
    if (!part || typeof part !== "object") return false;
    const type = (part as { type?: unknown }).type;
    return type === "image_url" || type === "file_url";
  });
}
