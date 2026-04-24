import { z } from "zod";

export type OrbChatAttachmentKind = "image" | "video" | "audio" | "pdf";

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
] as const;

export type OrbChatAttachmentMimeType = (typeof ORB_CHAT_ATTACHMENT_MIME_TYPES)[number];

export interface OrbChatAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: OrbChatAttachmentMimeType;
  kind: OrbChatAttachmentKind;
}

export type OrbChatLLMMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "file_url"; file_url: { url: string; mime_type: OrbChatAttachmentMimeType } };

export type OrbChatLLMMessageContent = string | OrbChatLLMMessagePart[];

export const ORB_UPLOAD_ACCEPT = "image/*,video/*,audio/*,.pdf";

export const ORB_ALLOWED_MIME_TYPES = new Set<OrbChatAttachmentMimeType>(
  ORB_CHAT_ATTACHMENT_MIME_TYPES
);

export const ORB_UNSUPPORTED_ATTACHMENT_MESSAGE =
  "這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4，或貼文字內容。";

export function resolveOrbAttachmentKind(
  mimeType: string
): { kind: OrbChatAttachmentKind; mimeType: OrbChatAttachmentMimeType } | null {
  const mime = mimeType.toLowerCase().trim();
  if (!ORB_ALLOWED_MIME_TYPES.has(mime as OrbChatAttachmentMimeType)) return null;
  const normalized = mime as OrbChatAttachmentMimeType;
  if (normalized.startsWith("image/")) return { kind: "image", mimeType: normalized };
  if (normalized.startsWith("video/")) return { kind: "video", mimeType: normalized };
  if (normalized.startsWith("audio/")) return { kind: "audio", mimeType: normalized };
  if (normalized === "application/pdf") return { kind: "pdf", mimeType: normalized };
  return null;
}

export function attachmentToLLMMessagePart(
  attachment: OrbChatAttachment
): Extract<OrbChatLLMMessagePart, { type: "image_url" | "file_url" }> {
  if (attachment.kind === "image") {
    return {
      type: "image_url",
      image_url: {
        url: attachment.url,
        detail: "auto",
      },
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

  return [
    {
      type: "text",
      text: input.text.trim() || "請參考我上傳的附件內容。",
    },
    ...attachments.map(attachmentToLLMMessagePart),
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
  text: z.string(),
});

export const OrbChatLLMImageUrlPartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string().url(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

export const OrbChatLLMFileUrlPartSchema = z.object({
  type: z.literal("file_url"),
  file_url: z.object({
    url: z.string().url(),
    mime_type: OrbChatAttachmentMimeTypeSchema,
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
