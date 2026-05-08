/**
 * useOrbAttachments — shared multimodal upload state for the Orb chat surfaces
 * (ProactiveOrbWidget, OrbGuidePanel, AgentChat).
 *
 * Wraps file selection, S3 upload and feedback so every chat surface can attach
 * images / video / audio / PDF to a single sendMessage call against
 * GlobalOrbChatContext.
 */

import { useCallback, useRef, useState } from "react";
import { shortErrorMsg, uploadFileToS3 } from "@/lib/upload";
import {
  ORB_UNSUPPORTED_ATTACHMENT_MESSAGE,
  resolveOrbAttachmentKind,
} from "../../../shared/orb-chat-multimodal";
import {
  extractAttachmentText,
  AttachmentTextExtractionError,
} from "@/lib/extractAttachmentText";
import type { ChatAttachment } from "@/contexts/GlobalOrbChatContext";

type Notify = (message: string) => void;

export interface UseOrbAttachmentsResult {
  attachments: ChatAttachment[];
  isUploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  pickAttachment: () => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  handleFiles: (files: FileList | null) => Promise<void>;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useOrbAttachments(notify?: Notify): UseOrbAttachmentsResult {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || isUploading) return;
      const candidates = Array.from(files);
      const validFiles = candidates
        .map(file => ({
          file,
          resolved: resolveOrbAttachmentKind(file.type, file.name),
        }))
        .filter(
          (
            entry
          ): entry is {
            file: File;
            resolved: NonNullable<ReturnType<typeof resolveOrbAttachmentKind>>;
          } => entry.resolved !== null
        );

      if (validFiles.length === 0) {
        notify?.(ORB_UNSUPPORTED_ATTACHMENT_MESSAGE);
        return;
      }

      setIsUploading(true);
      try {
        const uploaded = await Promise.all(
          validFiles.map(async ({ file, resolved }) => {
            // Text-like documents (txt / md / docx) are unreadable by the
            // LLM as `file_url` parts — so we extract their text on the
            // client and stash it on the attachment so
            // `chatMessageToLLMContent` can inline it. Failure to extract
            // surfaces a friendly error; we still upload the file so the
            // chip in the bubble keeps a working download link.
            let extractedText: string | undefined;
            if (resolved.kind === "text") {
              try {
                extractedText = await extractAttachmentText(file, resolved.mimeType);
                if (!extractedText.trim()) {
                  throw new AttachmentTextExtractionError(
                    "附件看起來是空的，沒有可讀取的內容。",
                  );
                }
              } catch (err) {
                const reason =
                  err instanceof AttachmentTextExtractionError
                    ? err.message
                    : shortErrorMsg(err);
                notify?.(`無法讀取「${file.name}」：${reason}`);
                throw err;
              }
            }
            const result = await uploadFileToS3(file);
            return {
              id: generateId(),
              name: file.name,
              url: result.url,
              mimeType: resolved.mimeType,
              kind: resolved.kind,
              ...(extractedText ? { extractedText } : {}),
            } satisfies ChatAttachment;
          })
        );
        setAttachments(prev => [...prev, ...uploaded]);
      } catch (err) {
        if (!(err instanceof AttachmentTextExtractionError)) {
          notify?.(`附件上傳失敗：${shortErrorMsg(err)}`);
        }
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [isUploading, notify]
  );

  const pickAttachment = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    attachments,
    isUploading,
    fileInputRef,
    pickAttachment,
    removeAttachment,
    clearAttachments,
    handleFiles,
  };
}

/** Returns an emoji that represents the attachment kind. */
export function attachmentKindEmoji(kind: ChatAttachment["kind"]): string {
  switch (kind) {
    case "image":
      return "🖼️";
    case "video":
      return "🎬";
    case "audio":
      return "🎵";
    case "pdf":
      return "📄";
    case "text":
      return "📝";
    default:
      return "📎";
  }
}
