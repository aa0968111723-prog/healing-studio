/**
 * voice-transcription-ssrf.test.ts — AIDV-780 項 10
 *
 * 釘住 transcribeAudio 的 SSRF 防線與 fetch 逾時：
 *   1. 使用者提供的 audioUrl 指向私網/IMDS → 直接拒絕（INVALID_FORMAT），
 *      完全不發出 fetch。
 *   2. 合法外部 URL → 照常下載，且 fetch 必帶 AbortSignal 逾時（不掛死）。
 *   3. 非 production（test/dev）允許 127.0.0.1/localhost，保住本機儲存路徑
 *      的既有行為（正常路徑零變化）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 隔離 env.validated 的啟動驗證 — 只提供 transcribeAudio 用到的兩個欄位
vi.mock("./_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example.com",
    forgeApiKey: "test-key",
  },
}));

import { transcribeAudio } from "./_core/voiceTranscription";

describe("transcribeAudio SSRF 守衛（AIDV-780）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("拒絕 AWS IMDS（169.254.169.254）且不發出任何 fetch", async () => {
    const result = await transcribeAudio({
      audioUrl: "http://169.254.169.254/latest/meta-data/",
    });

    expect(result).toMatchObject({
      error: "Audio URL is not allowed",
      code: "INVALID_FORMAT",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒絕私網位址（10.x）且不發出任何 fetch", async () => {
    const result = await transcribeAudio({
      audioUrl: "https://10.0.0.5/internal.mp3",
    });

    expect(result).toMatchObject({ code: "INVALID_FORMAT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒絕非 http(s) 協定（file:）", async () => {
    const result = await transcribeAudio({
      audioUrl: "file:///etc/passwd",
    });

    expect(result).toMatchObject({ code: "INVALID_FORMAT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("合法外部 URL 照常下載，且 fetch 帶 AbortSignal 逾時", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await transcribeAudio({
      audioUrl: "https://cdn.example.com/audio.mp3",
    });

    // 走到下載步驟（守衛放行），下載失敗屬既有行為
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.example.com/audio.mp3",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toMatchObject({ error: "Failed to download audio file" });
  });

  it("非 production 允許 127.0.0.1（本機儲存正常路徑零變化）", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await transcribeAudio({
      audioUrl: "http://127.0.0.1:3000/local-audio.mp3",
    });

    // 守衛放行（test 環境 NODE_ENV !== "production"），有發出 fetch
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
