/**
 * orb-attachment-extraction.test.ts
 *
 * Locks down the server-side PDF text extraction fallback used by the orb
 * chat route when no multimodal LLM provider is healthy. The fallback turns
 * a `file_url` part for `application/pdf` into an inline text part so a
 * text-only LLM can answer about the PDF content — this is the difference
 * between "all features work" and the "請把腳本內容貼到對話裡" dead-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countPdfAttachments,
  extractPdfAttachmentsToText,
} from "./services/orbAttachmentExtraction";
import type { Message } from "./_core/llm";

vi.mock("./services/pdfTextExtractor", () => ({
  extractPdfTextFromUrl: vi.fn(),
}));

import { extractPdfTextFromUrl } from "./services/pdfTextExtractor";

const mockedExtract = vi.mocked(extractPdfTextFromUrl);

describe("orbAttachmentExtraction", () => {
  beforeEach(() => {
    mockedExtract.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("countPdfAttachments", () => {
    it("counts PDF file_url parts across messages", () => {
      const messages: Message[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "看這個" },
            {
              type: "file_url",
              file_url: { url: "https://cdn.test/a.pdf", mime_type: "application/pdf" },
            },
            {
              type: "file_url",
              file_url: { url: "https://cdn.test/b.pdf", mime_type: "application/pdf" },
            },
          ],
        },
      ];
      expect(countPdfAttachments(messages)).toBe(2);
    });

    it("ignores non-PDF file_url parts", () => {
      const messages: Message[] = [
        {
          role: "user",
          content: [
            {
              type: "file_url",
              file_url: { url: "https://cdn.test/a.mp3", mime_type: "audio/mpeg" },
            },
            {
              type: "image_url",
              image_url: { url: "https://cdn.test/x.png" },
            },
          ],
        },
      ];
      expect(countPdfAttachments(messages)).toBe(0);
    });

    it("returns 0 for plain string content", () => {
      const messages: Message[] = [{ role: "user", content: "你好" }];
      expect(countPdfAttachments(messages)).toBe(0);
    });
  });

  describe("extractPdfAttachmentsToText", () => {
    it("replaces a successful PDF extraction with an inline text part", async () => {
      mockedExtract.mockResolvedValueOnce({
        text: "場景一：清晨森林\n旁白：呼吸，慢慢來。",
        pageCount: 2,
        truncated: false,
      });

      const messages: Message[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "幫我拆解這個腳本" },
            {
              type: "file_url",
              file_url: {
                url: "https://cdn.test/uploads/42/script.pdf",
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ];

      const result = await extractPdfAttachmentsToText(messages);

      expect(result.extractedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.hasUnextractableBinary).toBe(false);

      const parts = result.messages[0].content as Array<{ type: string; text?: string }>;
      expect(parts.map(p => p.type)).toEqual(["text", "text"]);
      expect(parts[1].text).toContain("📎 附件「script.pdf」內容");
      expect(parts[1].text).toContain("場景一：清晨森林");
    });

    it("marks truncation in the inlined header when extraction was clipped", async () => {
      mockedExtract.mockResolvedValueOnce({
        text: "very long body",
        pageCount: 200,
        truncated: true,
      });

      const result = await extractPdfAttachmentsToText([
        {
          role: "user",
          content: [
            {
              type: "file_url",
              file_url: {
                url: "https://cdn.test/big.pdf",
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ]);

      const parts = result.messages[0].content as Array<{ type: string; text?: string }>;
      expect(parts[0].text).toContain("（內容較長，已自動截斷）");
    });

    it("falls back to a friendly text note when extraction returns null", async () => {
      mockedExtract.mockResolvedValueOnce(null);

      const result = await extractPdfAttachmentsToText([
        {
          role: "user",
          content: [
            {
              type: "file_url",
              file_url: {
                url: "https://cdn.test/bad.pdf",
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ]);

      expect(result.extractedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      const parts = result.messages[0].content as Array<{ type: string; text?: string }>;
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe("text");
      expect(parts[0].text).toContain("無法擷取 PDF 內文");
    });

    it("flags unextractable binary attachments (image / audio / video) so caller skips fallback", async () => {
      mockedExtract.mockResolvedValueOnce({
        text: "scene 1",
        pageCount: 1,
        truncated: false,
      });

      const result = await extractPdfAttachmentsToText([
        {
          role: "user",
          content: [
            { type: "text", text: "看這個" },
            {
              type: "file_url",
              file_url: {
                url: "https://cdn.test/script.pdf",
                mime_type: "application/pdf",
              },
            },
            {
              type: "image_url",
              image_url: { url: "https://cdn.test/photo.png" },
            },
            {
              type: "file_url",
              file_url: {
                url: "https://cdn.test/clip.mp4",
                mime_type: "video/mp4",
              },
            },
          ],
        },
      ]);

      expect(result.extractedCount).toBe(1);
      expect(result.hasUnextractableBinary).toBe(true);
    });

    it("preserves messages whose content is a plain string", async () => {
      const messages: Message[] = [
        { role: "assistant", content: "嗨，我是光球" },
        { role: "user", content: "再幫我看看" },
      ];

      const result = await extractPdfAttachmentsToText(messages);

      expect(mockedExtract).not.toHaveBeenCalled();
      expect(result.extractedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.messages).toEqual(messages);
    });

    it("does not call the extractor when there are no PDF attachments", async () => {
      const messages: Message[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "你好" },
            {
              type: "image_url",
              image_url: { url: "https://cdn.test/photo.png" },
            },
          ],
        },
      ];

      const result = await extractPdfAttachmentsToText(messages);

      expect(mockedExtract).not.toHaveBeenCalled();
      expect(result.extractedCount).toBe(0);
      expect(result.hasUnextractableBinary).toBe(true);
    });
  });
});
