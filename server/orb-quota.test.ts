import { beforeEach, describe, expect, it } from "vitest";
import { __unsafe_resetOrbQuotaForTests, checkAndConsumeQuota } from "./services/orbQuota";
import {
  __unsafe_resetOrbIdempotencyForTests,
  buildOrbIdempotencyKey,
  findDuplicateTask,
  rememberTaskKey,
} from "./services/orbIdempotency";
import { validateAttachmentGuards } from "./services/orbAttachmentGuard";

describe("orb quota guard", () => {
  beforeEach(() => {
    __unsafe_resetOrbQuotaForTests();
    __unsafe_resetOrbIdempotencyForTests();
  });

  it("quota exceeded prevents provider call path by blocking generation", () => {
    let blocked = false;
    for (let i = 0; i < 41; i += 1) {
      const result = checkAndConsumeQuota("generation", { userId: 7 });
      if (!result.allowed) blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("rapid duplicate task returns existing task", () => {
    const key = buildOrbIdempotencyKey({
      userId: 7,
      text: "生成一段影片",
      attachmentUrls: ["https://cdn.example.com/a.png"],
    });
    rememberTaskKey(key, { taskId: "task_1", planId: "plan_1" });
    const duplicate = findDuplicateTask(key);
    expect(duplicate?.taskId).toBe("task_1");
  });

  it("retryBudget prevents infinite retry", () => {
    const allowed = checkAndConsumeQuota("task_retry", { userId: 1, retryCount: 1 });
    const blocked = checkAndConsumeQuota("task_retry", { userId: 1, retryCount: 2 });
    expect(allowed.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
  });

  it("oversized image/audio/video/pdf blocked", () => {
    const oversizedImage = validateAttachmentGuards([
      {
        role: "user",
        content: [{ type: "file_url", file_url: { url: "https://x", mime_type: "image/png", size_bytes: 11 * 1024 * 1024 } }],
      },
    ]);
    const oversizedAudio = validateAttachmentGuards([
      {
        role: "user",
        content: [{ type: "file_url", file_url: { url: "https://x", mime_type: "audio/mpeg", size_bytes: 21 * 1024 * 1024 } }],
      },
    ]);
    const oversizedVideo = validateAttachmentGuards([
      {
        role: "user",
        content: [{ type: "file_url", file_url: { url: "https://x", mime_type: "video/mp4", size_bytes: 41 * 1024 * 1024 } }],
      },
    ]);
    const oversizedPdf = validateAttachmentGuards([
      {
        role: "user",
        content: [{ type: "file_url", file_url: { url: "https://x", mime_type: "application/pdf", size_bytes: 13 * 1024 * 1024 } }],
      },
    ]);
    expect(oversizedImage.ok).toBe(false);
    expect(oversizedAudio.ok).toBe(false);
    expect(oversizedVideo.ok).toBe(false);
    expect(oversizedPdf.ok).toBe(false);
  });

  it("unsupported file blocked", () => {
    const unsupported = validateAttachmentGuards([
      {
        role: "user",
        content: [{ type: "file_url", file_url: { url: "https://x", mime_type: "application/zip", size_bytes: 1024 } }],
      },
    ]);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.reason).toBe("unsupported");
  });
});
