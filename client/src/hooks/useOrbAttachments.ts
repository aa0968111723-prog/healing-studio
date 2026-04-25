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
        .map(file => ({ file, resolved: resolveOrbAttachmentKind(file.type) }))
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
            const result = await uploadFileToS3(file);
            return {
              id: generateId(),
              name: file.name,
              url: result.url,
              mimeType: resolved.mimeType,
              kind: resolved.kind,
            } satisfies ChatAttachment;
          })
        );
        setAttachments(prev => [...prev, ...uploaded]);
      } catch (err) {
        notify?.(`附件上傳失敗：${shortErrorMsg(err)}`);
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
    default:
      return "📎";
  }
}
