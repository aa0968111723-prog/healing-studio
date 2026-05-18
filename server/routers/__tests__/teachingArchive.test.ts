/**
 * teachingArchive.test.ts
 *
 * Locks down input validation + media-payload assertions for the
 * teaching-archive router (Phase 1 of the training-data feature). We
 * exercise the pure schema layer so this can run without spinning up
 * MySQL or the tRPC HTTP transport.
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { __teachingArchiveInternals } from "../teachingArchive";

const { createInputSchema, assertMediaPayload } = __teachingArchiveInternals;

describe("teachingArchive createInputSchema", () => {
  it("accepts a minimal text discourse", () => {
    const parsed = createInputSchema.parse({
      title: "印心禪法簡介",
      mediaType: "text",
      textContent: "悟覺妙天禪師開示：印心禪法的核心在於……",
    });
    expect(parsed.sourceType).toBe("discourse"); // default
    expect(parsed.visibility).toBe("private"); // default
    expect(parsed.isFeatured).toBe(false); // default
  });

  it("accepts a minimal PDF upload with metadata", () => {
    const parsed = createInputSchema.parse({
      title: "2025 春季社課講義",
      mediaType: "pdf",
      fileUrl: "https://example.com/uploads/abc.pdf",
      fileKey: "uploads/1/abc.pdf",
      pageCount: 24,
      lineage: "悟覺妙天禪師",
      sourceType: "class",
      sourceDate: "2025-04-12",
      topic: "禪修方法",
      tags: ["社課", "入門"],
    });
    expect(parsed.lineage).toBe("悟覺妙天禪師");
    expect(parsed.sourceDate).toBe("2025-04-12");
    expect(parsed.tags).toEqual(["社課", "入門"]);
  });

  it("rejects malformed sourceDate (must be YYYY-MM-DD)", () => {
    const result = createInputSchema.safeParse({
      title: "x",
      mediaType: "text",
      textContent: "x",
      sourceDate: "April 12, 2025",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mediaType outside the enum", () => {
    const result = createInputSchema.safeParse({
      title: "x",
      // @ts-expect-error — deliberately invalid for the runtime check
      mediaType: "spreadsheet",
      textContent: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = createInputSchema.safeParse({
      title: "   ",
      mediaType: "text",
      textContent: "x",
    });
    expect(result.success).toBe(false);
  });

  it("caps tags at 32 entries", () => {
    const tags = Array.from({ length: 33 }, (_, i) => `t${i}`);
    const result = createInputSchema.safeParse({
      title: "x",
      mediaType: "text",
      textContent: "x",
      tags,
    });
    expect(result.success).toBe(false);
  });
});

describe("teachingArchive assertMediaPayload", () => {
  it("requires textContent for text mediaType", () => {
    const parsed = createInputSchema.parse({
      title: "x",
      mediaType: "text",
      textContent: "x",
    });
    // Force textContent to empty after parse — mimics a caller that drops
    // the field between validation and the assertion guard.
    expect(() =>
      assertMediaPayload({ ...parsed, textContent: "" })
    ).toThrow(TRPCError);
  });

  it("requires fileUrl for non-text mediaType", () => {
    const parsed = createInputSchema.parse({
      title: "x",
      mediaType: "video",
      fileUrl: "https://example.com/v.mp4",
    });
    expect(() => assertMediaPayload({ ...parsed, fileUrl: undefined })).toThrow(
      TRPCError
    );
  });

  it("accepts a valid text payload", () => {
    const parsed = createInputSchema.parse({
      title: "x",
      mediaType: "text",
      textContent: "non-empty body",
    });
    expect(() => assertMediaPayload(parsed)).not.toThrow();
  });

  it("accepts a valid video payload", () => {
    const parsed = createInputSchema.parse({
      title: "x",
      mediaType: "video",
      fileUrl: "https://example.com/v.mp4",
    });
    expect(() => assertMediaPayload(parsed)).not.toThrow();
  });
});
