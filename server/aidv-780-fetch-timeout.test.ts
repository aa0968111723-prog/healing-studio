/**
 * aidv-780-fetch-timeout.test.ts — AIDV-780 項 10
 *
 * 釘住 elevenLabsExtended / falTrainer 對使用者提供 URL 的抓取防線：
 *   - SSRF 守衛（assertSafeUrl allowlist，既有）擋掉非白名單來源、不發 fetch
 *   - 每個外抓 fetch 必帶 AbortSignal 逾時（音訊 30s／影片與訓練素材 90s），
 *     惡意/掛死來源不能無限吊住 worker
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// falTrainer 頂層 import ../db.js 與 ../storage.js — 隔離避免真連線
vi.mock("./db.js", () => ({
  updateFineTunedModel: vi.fn(),
  updateBackgroundJob: vi.fn(),
  getDb: vi.fn().mockResolvedValue(null),
}));
vi.mock("./storage.js", () => ({
  storagePut: vi.fn(),
}));

import { ElevenLabsExtendedClient } from "./services/elevenLabsExtended";
import { buildZipBuffer } from "./services/falTrainer";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.ELEVENLABS_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ELEVENLABS_API_KEY;
});

describe("ElevenLabsExtendedClient — 外抓 URL 防線（AIDV-780）", () => {
  it("cloneVoice：合法音訊 URL 的 fetch 帶 AbortSignal 逾時", async () => {
    fetchMock
      // 第一次：抓使用者音訊
      .mockResolvedValueOnce({
        blob: async () => new Blob(["audio-bytes"]),
      })
      // 第二次：ElevenLabs API /voices/add
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ voice_id: "v-123" }),
      });

    const client = new ElevenLabsExtendedClient();
    const result = await client.cloneVoice({
      name: "test-voice",
      audioUrls: ["https://storage.googleapis.com/bucket/sample.mp3"],
    });

    expect(result.voiceId).toBe("v-123");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://storage.googleapis.com/bucket/sample.mp3"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal: expect.any(AbortSignal),
    });
  });

  it("cloneVoice：非白名單來源直接拒絕，不發出任何 fetch", async () => {
    const client = new ElevenLabsExtendedClient();
    await expect(
      client.cloneVoice({
        name: "evil",
        audioUrls: ["https://evil.attacker.example/payload.mp3"],
      })
    ).rejects.toThrow(/url-not-allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createDubbing：影片 URL 的 fetch 帶 AbortSignal 逾時（90s 檔位）", async () => {
    fetchMock
      // 第一次：抓使用者影片
      .mockResolvedValueOnce({
        blob: async () => new Blob(["video-bytes"]),
      })
      // 第二次：ElevenLabs API /dubbing
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          dubbing_id: "d-1",
          expected_duration_sec: 12,
        }),
      });

    const client = new ElevenLabsExtendedClient();
    await client.createDubbing({
      videoUrl: "https://storage.googleapis.com/bucket/movie.mp4",
      targetLanguage: "zh",
    } as any);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal: expect.any(AbortSignal),
    });
  });
});

describe("falTrainer.buildZipBuffer — 訓練素材外抓防線（AIDV-780）", () => {
  it("合法素材 URL 的 fetch 帶 AbortSignal 逾時", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    });

    const buffer = await buildZipBuffer([
      "https://storage.googleapis.com/bucket/img.png",
    ]);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.googleapis.com/bucket/img.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("非白名單素材 URL 被守衛擋下（不發 fetch），全滅時拋錯", async () => {
    await expect(
      buildZipBuffer(["https://evil.attacker.example/x.png"])
    ).rejects.toThrow(/No files were successfully downloaded/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
