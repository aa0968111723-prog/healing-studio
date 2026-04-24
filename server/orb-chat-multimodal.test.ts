import { describe, expect, it } from "vitest";
import {
  ORB_UNSUPPORTED_ATTACHMENT_MESSAGE,
  attachmentToLLMMessagePart,
  chatMessageToLLMContent,
  resolveOrbAttachmentKind,
} from "../shared/orb-chat-multimodal";

describe("orb-chat-multimodal", () => {
  it("resolves supported upload mime types", () => {
    expect(resolveOrbAttachmentKind("image/png")).toEqual({ kind: "image", mimeType: "image/png" });
    expect(resolveOrbAttachmentKind("audio/mpeg")).toEqual({ kind: "audio", mimeType: "audio/mpeg" });
    expect(resolveOrbAttachmentKind("video/mp4")).toEqual({ kind: "video", mimeType: "video/mp4" });
    expect(resolveOrbAttachmentKind("application/pdf")).toEqual({ kind: "pdf", mimeType: "application/pdf" });
  });

  it("rejects unsupported upload mime types", () => {
    expect(resolveOrbAttachmentKind("application/zip")).toBeNull();
    expect(resolveOrbAttachmentKind("application/vnd.ms-excel")).toBeNull();
  });

  it("maps image attachments to image_url parts", () => {
    expect(attachmentToLLMMessagePart({
      id: "img",
      name: "photo.png",
      url: "https://cdn.test/photo.png",
      mimeType: "image/png",
      kind: "image",
    })).toEqual({
      type: "image_url",
      image_url: { url: "https://cdn.test/photo.png", detail: "auto" },
    });
  });

  it("maps audio/video/pdf attachments to file_url parts", () => {
    expect(attachmentToLLMMessagePart({
      id: "aud",
      name: "voice.mp3",
      url: "https://cdn.test/voice.mp3",
      mimeType: "audio/mpeg",
      kind: "audio",
    })).toEqual({
      type: "file_url",
      file_url: { url: "https://cdn.test/voice.mp3", mime_type: "audio/mpeg" },
    });

    expect(attachmentToLLMMessagePart({
      id: "vid",
      name: "clip.mp4",
      url: "https://cdn.test/clip.mp4",
      mimeType: "video/mp4",
      kind: "video",
    })).toEqual({
      type: "file_url",
      file_url: { url: "https://cdn.test/clip.mp4", mime_type: "video/mp4" },
    });

    expect(attachmentToLLMMessagePart({
      id: "pdf",
      name: "doc.pdf",
      url: "https://cdn.test/doc.pdf",
      mimeType: "application/pdf",
      kind: "pdf",
    })).toEqual({
      type: "file_url",
      file_url: { url: "https://cdn.test/doc.pdf", mime_type: "application/pdf" },
    });
  });

  it("converts a chat message with attachments into multimodal LLM content", () => {
    const content = chatMessageToLLMContent({
      text: "請把這張照片做成影片",
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

    expect(content).toEqual([
      { type: "text", text: "請把這張照片做成影片" },
      { type: "image_url", image_url: { url: "https://cdn.test/photo.png", detail: "auto" } },
    ]);
  });

  it("documents the friendly unsupported attachment fallback message", () => {
    expect(ORB_UNSUPPORTED_ATTACHMENT_MESSAGE).toContain("PDF / PNG / MP3 / MP4");
  });
});
