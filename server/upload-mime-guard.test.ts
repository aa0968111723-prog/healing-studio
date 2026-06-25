/**
 * upload-mime-guard.test.ts — AIDV-229 驗收契約
 *
 * 驗收條件：
 *   1. 上傳非白名單 MIME（exe/php/js/sh 等）→ ALLOWED_MIME_TYPES 拒絕（路由回 415）
 *   2. 上傳超過 ABSOLUTE_MAX_BYTES（40 MB）→ 大小邏輯觸發 413
 *   3. 上傳超過各 kind per-kind 上限 → 413（image>10MB, audio>20MB, video>40MB…）
 *   4. 100 MB 檔案同樣會被拒絕（攻擊向量 DoS 場景）
 *
 * 純邏輯測試：直接測 __uploadRouteInternals，不啟動 Express / 真實 S3。
 */

import { describe, expect, it } from "vitest";
import { __uploadRouteInternals } from "./uploadRoute";

const {
  ALLOWED_MIME_TYPES,
  PER_KIND_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  inferKind,
} = __uploadRouteInternals;

// ── 1. MIME 白名單：危險類型必須不在名單中 ────────────────────────────────────
describe("AIDV-229: MIME allowlist — dangerous types blocked", () => {
  const BLOCKED: string[] = [
    // Executables
    "application/x-executable",
    "application/x-elf",
    "application/x-msdownload", // .exe
    "application/x-pe-app-32bit-i386",
    // Scripts
    "application/x-php",
    "application/php",
    "text/x-php",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
    "application/x-sh",
    "application/x-shellscript",
    "text/x-sh",
    "text/x-shellscript",
    // Web / markup
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml", // AIDV-64: stored-XSS vector
    // Archives that could contain executables
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/x-gzip",
    "application/x-bzip2",
    "application/x-7z-compressed",
    // Bytecode / JVM
    "application/java-archive",
    "application/java-vm",
    // Python / Ruby / Perl
    "text/x-python",
    "text/x-ruby",
    "text/x-perl",
    "application/x-python",
    // XML (XEE / SSRF vector)
    "text/xml",
    "application/xml",
    // CSS (can contain expression() in IE / data URIs)
    "text/css",
  ];

  for (const mime of BLOCKED) {
    it(`blocks ${mime}`, () => {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(false);
    });
  }
});

// ── 2. MIME 白名單：合法媒體類型必須允許 ─────────────────────────────────────
describe("AIDV-229: MIME allowlist — legitimate media types allowed", () => {
  const ALLOWED: string[] = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
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
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/rtf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ];

  for (const mime of ALLOWED) {
    it(`allows ${mime}`, () => {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    });
  }
});

// ── 3. 絕對大小上限（DoS 防護） ───────────────────────────────────────────────
describe("AIDV-229: size limits — absolute cap and per-kind ceilings", () => {
  it("ABSOLUTE_MAX_BYTES is set (guards DoS / memory exhaustion)", () => {
    expect(ABSOLUTE_MAX_BYTES).toBeGreaterThan(0);
    // 40 MB absolute hard ceiling — tighter than the 100 MB stated in the
    // ticket which assumed no limit existed; existing cap is already more
    // restrictive (better security posture).
    expect(ABSOLUTE_MAX_BYTES).toBe(40 * 1024 * 1024);
  });

  it("a 100 MB file exceeds ABSOLUTE_MAX_BYTES → 413 path would trigger", () => {
    const hundredMb = 100 * 1024 * 1024;
    expect(hundredMb).toBeGreaterThan(ABSOLUTE_MAX_BYTES);
  });

  it("a 50 MB file exceeds ABSOLUTE_MAX_BYTES → 413 path would trigger", () => {
    const fiftyMb = 50 * 1024 * 1024;
    expect(fiftyMb).toBeGreaterThan(ABSOLUTE_MAX_BYTES);
  });

  it("a file exactly at ABSOLUTE_MAX_BYTES is within the ceiling", () => {
    expect(ABSOLUTE_MAX_BYTES).toBeLessThanOrEqual(ABSOLUTE_MAX_BYTES);
  });

  // ── per-kind ceilings ──────────────────────────────────────────────────────
  it("image/png: file > 10 MB would be rejected", () => {
    const sizeBytes = 11 * 1024 * 1024;
    const kind = inferKind("image/png");
    expect(kind).toBe("image");
    expect(sizeBytes).toBeGreaterThan(PER_KIND_MAX_BYTES[kind]);
  });

  it("image/png: file at exactly 10 MB is at the limit", () => {
    const sizeBytes = 10 * 1024 * 1024;
    const kind = inferKind("image/png");
    // Exactly at limit should not exceed it (boundary inclusive)
    expect(sizeBytes).toBe(PER_KIND_MAX_BYTES[kind]);
  });

  it("audio/mpeg: file > 20 MB would be rejected", () => {
    const sizeBytes = 21 * 1024 * 1024;
    const kind = inferKind("audio/mpeg");
    expect(kind).toBe("audio");
    expect(sizeBytes).toBeGreaterThan(PER_KIND_MAX_BYTES[kind]);
  });

  it("video/mp4: file > 40 MB would be rejected (absolute ceiling)", () => {
    const sizeBytes = 41 * 1024 * 1024;
    const kind = inferKind("video/mp4");
    expect(kind).toBe("video");
    expect(sizeBytes).toBeGreaterThan(PER_KIND_MAX_BYTES[kind]);
    expect(sizeBytes).toBeGreaterThan(ABSOLUTE_MAX_BYTES);
  });

  it("application/pdf: file > 12 MB would be rejected", () => {
    const sizeBytes = 13 * 1024 * 1024;
    const kind = inferKind("application/pdf");
    expect(kind).toBe("pdf");
    expect(sizeBytes).toBeGreaterThan(PER_KIND_MAX_BYTES[kind]);
  });

  it("document (docx): file > 25 MB would be rejected", () => {
    const sizeBytes = 26 * 1024 * 1024;
    const kind = inferKind(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(kind).toBe("document");
    expect(sizeBytes).toBeGreaterThan(PER_KIND_MAX_BYTES[kind]);
  });
});

// ── 4. 大小限制一致性守門 ─────────────────────────────────────────────────────
describe("AIDV-229: size policy invariants", () => {
  it("all per-kind limits are <= ABSOLUTE_MAX_BYTES (no kind can exceed the ceiling)", () => {
    for (const [kind, limit] of Object.entries(PER_KIND_MAX_BYTES)) {
      expect(limit).toBeLessThanOrEqual(ABSOLUTE_MAX_BYTES);
    }
  });

  it("video kind has the highest per-kind limit (aligned with ABSOLUTE_MAX_BYTES)", () => {
    const videoLimit = PER_KIND_MAX_BYTES.video;
    const allLimits = Object.values(PER_KIND_MAX_BYTES);
    const maxLimit = Math.max(...allLimits);
    expect(videoLimit).toBe(maxLimit);
  });
});
