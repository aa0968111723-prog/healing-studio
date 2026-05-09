/**
 * orb-attachment-guard.test.ts
 *
 * Locks the input-validation contract for the orb's attachment guard so
 * the router's `routeIntent` decision (planner_pdf / multimodal / text)
 * stays correct as the supported MIME catalogue grows. These cases came
 * out of the audit:
 *
 *   - R3: legacy docx file_url replays from history must NOT be rejected
 *     as "unsupported" — the docx is recognisable and routes via the text
 *     planner.
 *   - R4: `inferKind` was using `lower.includes("pdf")`, which both
 *     missed surrounding whitespace and over-matched malicious MIMEs
 *     like `text/pdf-injection`.
 */
import { describe, expect, it } from "vitest";
import { validateAttachmentGuards } from "./services/orbAttachmentGuard";
import type { Message } from "./_core/llm";

describe("validateAttachmentGuards", () => {
  it("recognises PDF MIME with surrounding whitespace and uppercase", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: { url: "https://cdn.test/a.pdf", mime_type: " Application/PDF " as never },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(true);
    expect(result.kinds).toContain("pdf");
  });

  it("recognises legacy DOCX file_url parts (R3) so replayed history doesn't dead-end", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: {
              url: "https://cdn.test/legacy.docx",
              mime_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(true);
    expect(result.kinds).toContain("text");
  });

  it("recognises the legacy application/msword MIME as text-kind", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: { url: "https://cdn.test/old.doc", mime_type: "application/msword" as never },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(true);
    expect(result.kinds).toContain("text");
  });

  it("rejects look-alike attack MIMEs that merely contain the substring 'pdf' (R4)", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: {
              url: "https://cdn.test/x",
              mime_type: "text/pdf-injection-attack" as never,
            },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported");
  });

  it("recognises vendor PDF MIME variants (application/x-pdf)", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: { url: "https://cdn.test/a.pdf", mime_type: "application/x-pdf" as never },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(true);
    expect(result.kinds).toContain("pdf");
  });

  it("treats an empty MIME (mobile picker quirk) as unsupported (kind=unknown)", () => {
    const result = validateAttachmentGuards([
      {
        role: "user",
        content: [
          {
            type: "file_url",
            file_url: { url: "https://cdn.test/x", mime_type: "" as never },
          },
        ],
      } as Message,
    ]);
    expect(result.ok).toBe(false);
  });
});
