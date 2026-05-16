import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  awaitFalQueueResult,
  extractFalMediaUrl,
} from "./services/falQueueAwaiter";

const ORIGINAL_KEY = process.env.FAL_API_KEY;
beforeEach(() => {
  process.env.FAL_API_KEY = "test-key";
});
afterEach(() => {
  process.env.FAL_API_KEY = ORIGINAL_KEY;
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("extractFalMediaUrl", () => {
  it("finds video_url at the top level", () => {
    expect(extractFalMediaUrl({ video_url: "https://cdn/v.mp4" })).toEqual({
      output_url: "https://cdn/v.mp4",
      video_url: "https://cdn/v.mp4",
      image_url: undefined,
      audio_url: undefined,
    });
  });

  it("finds video.url nested object (kling shape)", () => {
    expect(extractFalMediaUrl({ video: { url: "https://cdn/v2.mp4" } }).video_url).toBe(
      "https://cdn/v2.mp4"
    );
  });

  it("finds images[0].url (flux shape)", () => {
    const out = extractFalMediaUrl({ images: [{ url: "https://cdn/i.png" }] });
    expect(out.image_url).toBe("https://cdn/i.png");
    expect(out.output_url).toBe("https://cdn/i.png");
  });

  it("finds videos[0].url (array shape used by some fal video models)", () => {
    // 回歸:videoStudio.extractVideoUrl 早就支援 videos[]，但通用 extractor
    // 過去漏 — 導致 checkStudioJob 在我們新加的「沒 URL 改 failed」分支
    // 把本來有 URL 的完成任務誤判為失敗。
    const out = extractFalMediaUrl({
      videos: [{ url: "https://cdn/vid-arr.mp4" }],
    });
    expect(out.video_url).toBe("https://cdn/vid-arr.mp4");
    expect(out.output_url).toBe("https://cdn/vid-arr.mp4");
  });

  it("finds videos[0].url nested under data / output envelopes", () => {
    expect(
      extractFalMediaUrl({
        output: { videos: [{ url: "https://cdn/o-vid.mp4" }] },
      }).video_url
    ).toBe("https://cdn/o-vid.mp4");
    expect(
      extractFalMediaUrl({
        data: { videos: [{ url: "https://cdn/d-vid.mp4" }] },
      }).video_url
    ).toBe("https://cdn/d-vid.mp4");
  });

  it("walks the data / output / result envelopes that some models nest under", () => {
    expect(
      extractFalMediaUrl({ data: { video: { url: "https://cdn/d.mp4" } } }).video_url
    ).toBe("https://cdn/d.mp4");
    expect(
      extractFalMediaUrl({ output: { audio: { url: "https://cdn/o.mp3" } } }).audio_url
    ).toBe("https://cdn/o.mp3");
  });

  it("returns empty object for unrecognised shapes", () => {
    expect(extractFalMediaUrl({ unrelated: 1 })).toEqual({
      output_url: undefined,
      video_url: undefined,
      image_url: undefined,
      audio_url: undefined,
    });
  });
});

describe("awaitFalQueueResult", () => {
  it("polls status, fetches result when COMPLETED, returns extracted media URL", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/status")) {
        // First call: still in queue. Second: done.
        return jsonResponse({
          status: calls.filter(c => c.endsWith("/status")).length === 1 ? "IN_PROGRESS" : "COMPLETED",
        });
      }
      return jsonResponse({ video: { url: "https://cdn/done.mp4" } });
    }) as unknown as typeof fetch;

    const sleepFn = async () => {};
    let now = 0;
    const result = await awaitFalQueueResult("req-1", "fal-ai/kling/v2", {
      fetchFn,
      sleepFn,
      nowFn: () => (now += 100),
      timeoutMs: 60_000,
    });

    expect(result.status).toBe("completed");
    expect(result.video_url).toBe("https://cdn/done.mp4");
    expect(result.output_url).toBe("https://cdn/done.mp4");
    expect(calls).toContain("https://queue.fal.run/fal-ai/kling/v2/requests/req-1/status");
    expect(calls).toContain("https://queue.fal.run/fal-ai/kling/v2/requests/req-1");
  });

  it("returns status='pending' on timeout (request_id preserved so caller can retry)", async () => {
    const fetchFn = (async () => jsonResponse({ status: "IN_PROGRESS" })) as unknown as typeof fetch;
    const sleepFn = async () => {};
    let now = 0;
    const result = await awaitFalQueueResult("req-2", "fal-ai/m", {
      fetchFn,
      sleepFn,
      // First nowFn() reads 0 (deadline = 0 + 5_000), subsequent reads jump
      // past the deadline so the loop exits after one iteration.
      nowFn: () => {
        const cur = now;
        now += 6_000;
        return cur;
      },
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("pending");
    expect(result.request_id).toBe("req-2");
    expect(result.error).toMatch(/timed out/);
  });

  it("returns status='failed' when the queue reports FAILED", async () => {
    const fetchFn = (async () =>
      jsonResponse({ status: "FAILED", error: "model OOM" })) as unknown as typeof fetch;
    const result = await awaitFalQueueResult("req-3", "fal-ai/m", {
      fetchFn,
      sleepFn: async () => {},
      nowFn: () => 0,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("model OOM");
  });

  it("returns status='pending' when FAL_API_KEY is missing (no network call)", async () => {
    process.env.FAL_API_KEY = "";
    let called = 0;
    const fetchFn = (async () => {
      called += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await awaitFalQueueResult("req-4", "fal-ai/m", {
      fetchFn,
      sleepFn: async () => {},
      nowFn: () => 0,
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("pending");
    expect(result.error).toMatch(/FAL_API_KEY/);
    expect(called).toBe(0);
  });

  it("rides through transient 404s right after submit", async () => {
    let statusCallCount = 0;
    const fetchFn = (async (url: string) => {
      if (url.endsWith("/status")) {
        statusCallCount += 1;
        if (statusCallCount === 1) {
          return new Response("not found", { status: 404 });
        }
        return jsonResponse({ status: "COMPLETED" });
      }
      return jsonResponse({ images: [{ url: "https://cdn/img.png" }] });
    }) as unknown as typeof fetch;

    let now = 0;
    const result = await awaitFalQueueResult("req-5", "fal-ai/flux/dev", {
      fetchFn,
      sleepFn: async () => {},
      nowFn: () => (now += 100),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe("completed");
    expect(result.image_url).toBe("https://cdn/img.png");
  });
});
