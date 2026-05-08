/**
 * orb-chat-multimodal.test.ts
 *
 * 鎖定 Global Orb 多模態附件 pipeline 的 production contract：
 *
 *  1. image/png、image/jpeg → image_url
 *  2. audio/mpeg、audio/webm → file_url + mime_type
 *  3. video/mp4 → file_url + mime_type
 *  4. application/pdf → file_url + mime_type
 *  5. application/zip 等不支援格式 → friendly fallback message
 *  6. ChatAttachment[] 經 `chatMessageToLLMContent` 後仍為 multimodal 結構（不會被
 *     轉成純文字），且通過共用的 zod 路由 schema。
 *
 * 對應 Shared contract 在 `shared/orb-chat-multimodal.ts`，
 * 路由端在 `server/routers.ts` 內 `ai.chat` 採用同一份 zod schema。
 */

import { describe, expect, it } from "vitest";
import {
  ORB_ALLOWED_MIME_TYPES,
  ORB_CHAT_ATTACHMENT_MIME_TYPES,
  ORB_UNSUPPORTED_ATTACHMENT_MESSAGE,
  ORB_UPLOAD_ACCEPT,
  OrbChatLLMMessageContentSchema,
  OrbChatLLMMessagePartSchema,
  OrbChatRouterMessageSchema,
  assertSupportedOrbAttachmentMimeType,
  attachmentToLLMMessagePart,
  chatMessageToLLMContent,
  isMultimodalOrbChatContent,
  resolveOrbAttachmentKind,
  type OrbChatAttachment,
} from "../shared/orb-chat-multimodal";

describe("orb-chat-multimodal contract", () => {
  describe("resolveOrbAttachmentKind", () => {
    it("recognises supported image MIME types", () => {
      expect(resolveOrbAttachmentKind("image/png")).toEqual({
        kind: "image",
        mimeType: "image/png",
      });
      expect(resolveOrbAttachmentKind("image/jpeg")).toEqual({
        kind: "image",
        mimeType: "image/jpeg",
      });
      expect(resolveOrbAttachmentKind("IMAGE/PNG")).toEqual({
        kind: "image",
        mimeType: "image/png",
      });
    });

    it("recognises supported audio MIME types", () => {
      expect(resolveOrbAttachmentKind("audio/mpeg")).toEqual({
        kind: "audio",
        mimeType: "audio/mpeg",
      });
      expect(resolveOrbAttachmentKind("audio/webm")).toEqual({
        kind: "audio",
        mimeType: "audio/webm",
      });
    });

    it("recognises supported video MIME types", () => {
      expect(resolveOrbAttachmentKind("video/mp4")).toEqual({
        kind: "video",
        mimeType: "video/mp4",
      });
    });

    it("recognises PDF MIME type", () => {
      expect(resolveOrbAttachmentKind("application/pdf")).toEqual({
        kind: "pdf",
        mimeType: "application/pdf",
      });
    });

    it("rejects unsupported MIME types", () => {
      expect(resolveOrbAttachmentKind("application/zip")).toBeNull();
      expect(resolveOrbAttachmentKind("application/octet-stream")).toBeNull();
      expect(resolveOrbAttachmentKind("application/vnd.ms-excel")).toBeNull();
      expect(resolveOrbAttachmentKind("text/csv")).toBeNull();
      expect(resolveOrbAttachmentKind("")).toBeNull();
    });

    it("recognises text-like document MIME types", () => {
      expect(resolveOrbAttachmentKind("text/plain")).toEqual({
        kind: "text",
        mimeType: "text/plain",
      });
      expect(resolveOrbAttachmentKind("text/markdown")).toEqual({
        kind: "text",
        mimeType: "text/markdown",
      });
      expect(
        resolveOrbAttachmentKind(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toEqual({
        kind: "text",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    });

    it("falls back to filename extension when the browser hands us an empty MIME (mobile docx pickers)", () => {
      expect(resolveOrbAttachmentKind("", "script.docx")).toEqual({
        kind: "text",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      expect(resolveOrbAttachmentKind("application/octet-stream", "notes.txt")).toEqual({
        kind: "text",
        mimeType: "text/plain",
      });
      expect(resolveOrbAttachmentKind("application/msword", "legacy.docx")).toEqual({
        kind: "text",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    });
  });

  describe("attachmentToLLMMessagePart", () => {
    it("maps image/png attachments to image_url parts", () => {
      const part = attachmentToLLMMessagePart({
        id: "img-1",
        name: "photo.png",
        url: "https://cdn.test/photo.png",
        mimeType: "image/png",
        kind: "image",
      });
      expect(part).toEqual({
        type: "image_url",
        image_url: { url: "https://cdn.test/photo.png", detail: "auto" },
      });
    });

    it("maps image/jpeg attachments to image_url parts", () => {
      const part = attachmentToLLMMessagePart({
        id: "img-2",
        name: "photo.jpg",
        url: "https://cdn.test/photo.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      });
      expect(part).toEqual({
        type: "image_url",
        image_url: { url: "https://cdn.test/photo.jpg", detail: "auto" },
      });
    });

    it("maps audio/mpeg attachments to file_url parts with mime_type", () => {
      expect(
        attachmentToLLMMessagePart({
          id: "aud-1",
          name: "voice.mp3",
          url: "https://cdn.test/voice.mp3",
          mimeType: "audio/mpeg",
          kind: "audio",
        })
      ).toEqual({
        type: "file_url",
        file_url: { url: "https://cdn.test/voice.mp3", mime_type: "audio/mpeg" },
      });
    });

    it("maps audio/webm attachments to file_url parts with mime_type", () => {
      expect(
        attachmentToLLMMessagePart({
          id: "aud-2",
          name: "speak.webm",
          url: "https://cdn.test/speak.webm",
          mimeType: "audio/webm",
          kind: "audio",
        })
      ).toEqual({
        type: "file_url",
        file_url: { url: "https://cdn.test/speak.webm", mime_type: "audio/webm" },
      });
    });

    it("maps video/mp4 attachments to file_url parts with mime_type", () => {
      expect(
        attachmentToLLMMessagePart({
          id: "vid-1",
          name: "clip.mp4",
          url: "https://cdn.test/clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
        })
      ).toEqual({
        type: "file_url",
        file_url: { url: "https://cdn.test/clip.mp4", mime_type: "video/mp4" },
      });
    });

    it("maps application/pdf attachments to file_url parts with mime_type", () => {
      expect(
        attachmentToLLMMessagePart({
          id: "pdf-1",
          name: "doc.pdf",
          url: "https://cdn.test/doc.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
        })
      ).toEqual({
        type: "file_url",
        file_url: { url: "https://cdn.test/doc.pdf", mime_type: "application/pdf" },
      });
    });

    it("does NOT base64-encode attachment URLs (security)", () => {
      const part = attachmentToLLMMessagePart({
        id: "img-3",
        name: "photo.png",
        url: "https://cdn.test/photo.png",
        mimeType: "image/png",
        kind: "image",
      });
      const serialised = JSON.stringify(part);
      expect(serialised).not.toMatch(/data:image\/png;base64/);
      expect(serialised).not.toMatch(/[A-Za-z0-9+/]{64,}/);
    });
  });

  describe("chatMessageToLLMContent", () => {
    it("returns plain string when no attachments are provided", () => {
      const content = chatMessageToLLMContent({ text: "你好" });
      expect(content).toBe("你好");
      expect(typeof content).toBe("string");
    });

    it("preserves multimodal structure when attachments are present", () => {
      const content = chatMessageToLLMContent({
        text: "請分析這張照片",
        attachments: [
          {
            id: "img",
            name: "photo.png",
            url: "https://cdn.test/photo.png",
            mimeType: "image/png",
            kind: "image",
          },
        ],
      });
      expect(Array.isArray(content)).toBe(true);
      expect(content).toEqual([
        { type: "text", text: "請分析這張照片" },
        {
          type: "image_url",
          image_url: { url: "https://cdn.test/photo.png", detail: "auto" },
        },
      ]);
      expect(isMultimodalOrbChatContent(content)).toBe(true);
    });

    it("substitutes default text when only attachments and no body text", () => {
      const content = chatMessageToLLMContent({
        text: "   ",
        attachments: [
          {
            id: "pdf",
            name: "doc.pdf",
            url: "https://cdn.test/doc.pdf",
            mimeType: "application/pdf",
            kind: "pdf",
          },
        ],
      });
      expect(Array.isArray(content)).toBe(true);
      expect((content as Array<{ type: string; text?: string }>)[0]).toEqual({
        type: "text",
        text: "請參考我上傳的附件內容。",
      });
    });

    it("inlines text-kind attachments (txt / md / docx) into the user message body so the LLM can read scripts", () => {
      const content = chatMessageToLLMContent({
        text: "把這個腳本做成影片",
        attachments: [
          {
            id: "doc",
            name: "禪定入門篇 影片腳本.docx",
            url: "https://cdn.test/script.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            kind: "text",
            extractedText: "場景一：清晨森林\n旁白：呼吸，慢慢來。",
          },
        ],
      });
      expect(typeof content).toBe("string");
      expect(content as string).toContain("把這個腳本做成影片");
      expect(content as string).toContain(
        "📎 附件「禪定入門篇 影片腳本.docx」內容：",
      );
      expect(content as string).toContain("場景一：清晨森林");
    });

    it("keeps text-attachment inlining alongside binary attachments (mixed payload)", () => {
      const content = chatMessageToLLMContent({
        text: "幫我搭配這張圖",
        attachments: [
          {
            id: "doc",
            name: "腳本.txt",
            url: "https://cdn.test/script.txt",
            mimeType: "text/plain",
            kind: "text",
            extractedText: "第一幕：海邊。",
          },
          {
            id: "img",
            name: "ref.png",
            url: "https://cdn.test/ref.png",
            mimeType: "image/png",
            kind: "image",
          },
        ],
      });
      expect(Array.isArray(content)).toBe(true);
      const parts = content as Array<{ type: string; text?: string }>;
      expect(parts.map(p => p.type)).toEqual(["text", "image_url"]);
      expect(parts[0].text).toContain("幫我搭配這張圖");
      expect(parts[0].text).toContain("📎 附件「腳本.txt」內容：");
      expect(parts[0].text).toContain("第一幕：海邊。");
    });

    it("merges every supported attachment kind in a single content array", () => {
      const attachments: OrbChatAttachment[] = [
        {
          id: "img",
          name: "photo.png",
          url: "https://cdn.test/photo.png",
          mimeType: "image/png",
          kind: "image",
        },
        {
          id: "aud",
          name: "voice.mp3",
          url: "https://cdn.test/voice.mp3",
          mimeType: "audio/mpeg",
          kind: "audio",
        },
        {
          id: "vid",
          name: "clip.mp4",
          url: "https://cdn.test/clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
        },
        {
          id: "pdf",
          name: "doc.pdf",
          url: "https://cdn.test/doc.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
        },
      ];

      const content = chatMessageToLLMContent({ text: "看一下", attachments });
      const parts = content as Array<{ type: string }>;
      expect(parts.map(p => p.type)).toEqual([
        "text",
        "image_url",
        "file_url",
        "file_url",
        "file_url",
      ]);
    });
  });

  describe("friendly fallback for unsupported formats", () => {
    it("ORB_UNSUPPORTED_ATTACHMENT_MESSAGE matches the production-required wording", () => {
      expect(ORB_UNSUPPORTED_ATTACHMENT_MESSAGE).toBe(
        "這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4 / TXT / DOCX，或直接貼文字內容。"
      );
    });

    it("assertSupportedOrbAttachmentMimeType throws the friendly fallback for application/zip", () => {
      expect(() => assertSupportedOrbAttachmentMimeType("application/zip")).toThrow(
        ORB_UNSUPPORTED_ATTACHMENT_MESSAGE
      );
    });

    it("assertSupportedOrbAttachmentMimeType allows supported types", () => {
      expect(assertSupportedOrbAttachmentMimeType("image/png")).toBe("image/png");
      expect(assertSupportedOrbAttachmentMimeType("application/pdf")).toBe(
        "application/pdf"
      );
    });
  });

  describe("zod schemas (production contract)", () => {
    it("OrbChatLLMMessagePartSchema accepts text/image_url/file_url shapes", () => {
      expect(
        OrbChatLLMMessagePartSchema.safeParse({ type: "text", text: "嗨" }).success
      ).toBe(true);
      expect(
        OrbChatLLMMessagePartSchema.safeParse({
          type: "image_url",
          image_url: { url: "https://cdn.test/x.png" },
        }).success
      ).toBe(true);
      expect(
        OrbChatLLMMessagePartSchema.safeParse({
          type: "file_url",
          file_url: { url: "https://cdn.test/x.pdf", mime_type: "application/pdf" },
        }).success
      ).toBe(true);
    });

    it("OrbChatLLMMessagePartSchema rejects unsupported file mime types", () => {
      expect(
        OrbChatLLMMessagePartSchema.safeParse({
          type: "file_url",
          file_url: { url: "https://cdn.test/x.zip", mime_type: "application/zip" },
        }).success
      ).toBe(false);
    });

    // Issue #178: server-side red line. Even if a mis-behaving client tries to
    // squeeze a base64 buffer through the multimodal contract by stuffing it
    // into image_url.url or file_url.url, the schema must reject it. This
    // makes /api/upload's storage-backed URL the *only* legal path for
    // attachments.
    it("OrbChatLLMImageUrlPartSchema rejects data: URIs (no inline base64)", () => {
      const result = OrbChatLLMMessagePartSchema.safeParse({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        },
      });
      expect(result.success).toBe(false);
    });

    it("OrbChatLLMFileUrlPartSchema rejects data: URIs for video/audio/pdf", () => {
      const cases = [
        {
          mime: "video/mp4",
          uri: "data:video/mp4;base64,AAAAIGZ0eXBpc29t",
        },
        {
          mime: "audio/mpeg",
          uri: "data:audio/mpeg;base64,SUQzBAAAAAAA",
        },
        {
          mime: "application/pdf",
          uri: "data:application/pdf;base64,JVBERi0xLjQK",
        },
      ];
      for (const { mime, uri } of cases) {
        const result = OrbChatLLMMessagePartSchema.safeParse({
          type: "file_url",
          file_url: { url: uri, mime_type: mime },
        });
        expect(result.success).toBe(false);
      }
    });

    it("OrbChatLLMFileUrlPartSchema accepts https URLs (storage-backed)", () => {
      const result = OrbChatLLMMessagePartSchema.safeParse({
        type: "file_url",
        file_url: {
          url: "https://cdn.test/uploads/42/clip-abc123.mp4",
          mime_type: "video/mp4",
          size_bytes: 5 * 1024 * 1024,
        },
      });
      expect(result.success).toBe(true);
    });

    it("OrbChatLLMMessageContentSchema accepts both string and array content", () => {
      expect(OrbChatLLMMessageContentSchema.safeParse("hello").success).toBe(true);
      expect(
        OrbChatLLMMessageContentSchema.safeParse([
          { type: "text", text: "hi" },
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/photo.png" },
          },
        ]).success
      ).toBe(true);
    });

    it("OrbChatRouterMessageSchema enforces user/assistant role plus content shape", () => {
      const ok = OrbChatRouterMessageSchema.safeParse({
        role: "user",
        content: "你好",
      });
      expect(ok.success).toBe(true);

      const bad = OrbChatRouterMessageSchema.safeParse({
        role: "system",
        content: "你好",
      });
      expect(bad.success).toBe(false);
    });
  });

  describe("metadata exports", () => {
    it("ORB_UPLOAD_ACCEPT covers image/video/audio/pdf families", () => {
      expect(ORB_UPLOAD_ACCEPT).toContain("image/*");
      expect(ORB_UPLOAD_ACCEPT).toContain("video/*");
      expect(ORB_UPLOAD_ACCEPT).toContain("audio/*");
      expect(ORB_UPLOAD_ACCEPT).toContain(".pdf");
    });

    it("ORB_ALLOWED_MIME_TYPES exposes the same list as ORB_CHAT_ATTACHMENT_MIME_TYPES", () => {
      expect(ORB_ALLOWED_MIME_TYPES.size).toBe(ORB_CHAT_ATTACHMENT_MIME_TYPES.length);
      for (const mime of ORB_CHAT_ATTACHMENT_MIME_TYPES) {
        expect(ORB_ALLOWED_MIME_TYPES.has(mime)).toBe(true);
      }
    });
  });
});
