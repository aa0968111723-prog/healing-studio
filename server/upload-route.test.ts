/**
 * upload-route.test.ts
 *
 * Locks down the inline-vs-storage decision policy enforced by
 * `server/uploadRoute.ts` (Issue #178). The route's pure classifier is
 * exported as `__uploadRouteInternals.classifyInlineEligibility` so we can
 * assert the policy without spinning up an Express app or a real S3 backend.
 *
 * Production contract:
 *   1. video/* and audio/* are ALWAYS storage-only (inlineEligible=false),
 *      regardless of size. They must never be re-base64'd into LLM requests.
 *   2. image/* and application/pdf may inline only when <= 1 MB.
 *   3. Anything > 1 MB must be referenced by storage URL.
 *   4. The recommendation string distinguishes "kind requires storage" from
 *      "size pushed past threshold" so observability can tell them apart.
 */

import { describe, expect, it } from "vitest";
import { __uploadRouteInternals } from "./uploadRoute";

const {
  PER_KIND_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  INLINE_BASE64_THRESHOLD,
  STORAGE_ONLY_KIND_PREFIXES,
  inferKind,
  classifyInlineEligibility,
} = __uploadRouteInternals;

describe("uploadRoute size + inline policy (Issue #178)", () => {
  describe("constants", () => {
    it("INLINE_BASE64_THRESHOLD is 1 MB", () => {
      expect(INLINE_BASE64_THRESHOLD).toBe(1 * 1024 * 1024);
    });

    it("video/audio prefixes are flagged as storage-only", () => {
      expect(STORAGE_ONLY_KIND_PREFIXES).toContain("video/");
      expect(STORAGE_ONLY_KIND_PREFIXES).toContain("audio/");
    });

    it("per-kind size limits match orbAttachmentGuard policy", () => {
      // Aligned with server/services/orbAttachmentGuard.ts so the upload
      // endpoint and the LLM-side guard agree on what 'too big' means.
      expect(PER_KIND_MAX_BYTES.image).toBe(10 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.audio).toBe(20 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.video).toBe(40 * 1024 * 1024);
      expect(PER_KIND_MAX_BYTES.pdf).toBe(12 * 1024 * 1024);
    });

    it("ABSOLUTE_MAX_BYTES is 40 MB", () => {
      expect(ABSOLUTE_MAX_BYTES).toBe(40 * 1024 * 1024);
    });
  });

  describe("inferKind", () => {
    it("classifies image/png, image/jpeg, image/webp as image", () => {
      expect(inferKind("image/png")).toBe("image");
      expect(inferKind("image/jpeg")).toBe("image");
      expect(inferKind("image/webp")).toBe("image");
    });

    it("classifies audio/* as audio", () => {
      expect(inferKind("audio/mpeg")).toBe("audio");
      expect(inferKind("audio/webm")).toBe("audio");
      expect(inferKind("audio/wav")).toBe("audio");
    });

    it("classifies video/* as video", () => {
      expect(inferKind("video/mp4")).toBe("video");
      expect(inferKind("video/webm")).toBe("video");
      expect(inferKind("video/quicktime")).toBe("video");
    });

    it("classifies application/pdf as pdf", () => {
      expect(inferKind("application/pdf")).toBe("pdf");
    });
  });

  describe("classifyInlineEligibility — small files", () => {
    it("small image (<=1MB) is inline-eligible", () => {
      const result = classifyInlineEligibility("image/png", 500_000);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });

    it("small PDF (<=1MB) is inline-eligible", () => {
      const result = classifyInlineEligibility("application/pdf", 800_000);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });

    it("exactly 1MB is inline-eligible (boundary inclusive)", () => {
      const result = classifyInlineEligibility("image/png", 1 * 1024 * 1024);
      expect(result.inlineEligible).toBe(true);
      expect(result.inlineRecommendation).toBe("inline-ok");
    });
  });

  describe("classifyInlineEligibility — large files cross threshold", () => {
    it("image > 1MB must use storage URL (not inline)", () => {
      const result = classifyInlineEligibility("image/png", 2 * 1024 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url");
    });

    it("PDF > 1MB must use storage URL", () => {
      const result = classifyInlineEligibility(
        "application/pdf",
        5 * 1024 * 1024
      );
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url");
    });

    it("1MB+1 byte already crosses the threshold", () => {
      const result = classifyInlineEligibility(
        "image/jpeg",
        INLINE_BASE64_THRESHOLD + 1
      );
      expect(result.inlineEligible).toBe(false);
    });
  });

  describe("classifyInlineEligibility — video/audio always storage-only", () => {
    it("tiny 200 KB video MP4 is still storage-only", () => {
      const result = classifyInlineEligibility("video/mp4", 200 * 1024);
      expect(result.inlineEligible).toBe(false);
      // Must surface the 'required' variant — not 'use-storage-url' — so
      // dashboards / UI can tell users 'this kind doesn't fit inline ever'
      // vs 'this file is just too big'.
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("tiny 100 KB MP3 is still storage-only", () => {
      const result = classifyInlineEligibility("audio/mpeg", 100 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("large 30 MB video is storage-only with the 'required' label", () => {
      const result = classifyInlineEligibility("video/mp4", 30 * 1024 * 1024);
      expect(result.inlineEligible).toBe(false);
      // 'required' takes precedence over 'use-storage-url' so the reason
      // surfaced to ops is the kind, not the size.
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });

    it("audio/webm is also storage-only", () => {
      const result = classifyInlineEligibility("audio/webm", 50 * 1024);
      expect(result.inlineEligible).toBe(false);
      expect(result.inlineRecommendation).toBe("use-storage-url-required");
    });
  });

  describe("policy invariants", () => {
    it("inlineEligible=true implies inlineRecommendation='inline-ok'", () => {
      const cases: Array<{ mime: string; size: number }> = [
        { mime: "image/png", size: 100 },
        { mime: "image/jpeg", size: 999_999 },
        { mime: "application/pdf", size: 50_000 },
      ];
      for (const c of cases) {
        const r = classifyInlineEligibility(c.mime, c.size);
        if (r.inlineEligible) expect(r.inlineRecommendation).toBe("inline-ok");
      }
    });

    it("video/audio with any size yields inlineEligible=false", () => {
      const sizes = [0, 1, 1024, 500_000, 5 * 1024 * 1024, 30 * 1024 * 1024];
      for (const size of sizes) {
        expect(classifyInlineEligibility("video/mp4", size).inlineEligible).toBe(
          false
        );
        expect(classifyInlineEligibility("audio/mpeg", size).inlineEligible).toBe(
          false
        );
      }
    });
  });
});
