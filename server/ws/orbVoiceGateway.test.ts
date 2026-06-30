/**
 * orbVoiceGateway.test.ts — AIDV-263 / AIDV-120
 * Verifies that the concurrent-session limit uses the authenticated identity
 * (payload.sub) and not the client-controlled userId query param.
 * Also covers the real ASR+LLM+TTS pipeline (mocked processor).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../_core/googleAuth", () => ({
  verifySessionToken: vi.fn(),
}));

vi.mock("../services/agentToolExecutor", () => ({
  getAllowedOrigins: vi.fn(() => ["https://example.com"]),
}));

vi.mock("../services/orbVoiceProcessor", () => ({
  transcribeAudioBuffer: vi.fn(),
  generateOrbReply: vi.fn(),
  synthesizeOrbSpeech: vi.fn(),
}));

import { verifySessionToken } from "../_core/googleAuth";
import {
  transcribeAudioBuffer,
  generateOrbReply,
  synthesizeOrbSpeech,
} from "../services/orbVoiceProcessor";
import { handleOrbVoiceConnection, ORB_MAX_PAYLOAD_BYTES } from "./orbVoiceGateway";

function makeWs() {
  const sent: string[] = [];
  let closeCode: number | undefined;
  let closeReason: string | undefined;
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    readyState: 1 as number, // 1 = WebSocket.OPEN
    close: vi.fn((code?: number, reason?: string) => {
      closeCode = code;
      closeReason = reason;
    }),
    send: vi.fn((data: string) => sent.push(data)),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    _emit: (event: string, ...args: unknown[]) => {
      (listeners[event] ?? []).forEach(cb => cb(...args));
    },
    _sent: sent,
    _closeCode: () => closeCode,
    _closeReason: () => closeReason,
  };
}

function makeReq(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return { url: `/ws/orb-voice${qs ? `?${qs}` : ""}` } as any;
}

beforeEach(() => {
  vi.mocked(verifySessionToken).mockReset();
  vi.mocked(transcribeAudioBuffer).mockResolvedValue("測試文字");
  vi.mocked(generateOrbReply).mockResolvedValue("Orb 回應");
  vi.mocked(synthesizeOrbSpeech).mockResolvedValue(Buffer.from("audio-data"));
});

describe("handleOrbVoiceConnection — AIDV-263", () => {
  it("無效 token → 關閉 1008 unauthorized", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "bad" }));
    expect(ws.close).toHaveBeenCalledWith(1008, "unauthorized");
  });

  it("ORB_MAX_PAYLOAD_BYTES 匯出為 64 KB", () => {
    expect(ORB_MAX_PAYLOAD_BYTES).toBe(64 * 1024);
  });

  it("連線後發送 ready 事件", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-1" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));
    const readyMsg = ws._sent.find(s => JSON.parse(s).type === "ready");
    expect(readyMsg).toBeDefined();
    ws._emit("close");
  });

  it("併發限制以 payload.sub 計，userId 查詢參數無法繞過", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-locked" } as any);
    const env = process.env.ORB_VOICE_MAX_CONCURRENT;
    process.env.ORB_VOICE_MAX_CONCURRENT = "1";

    try {
      const ws1 = makeWs();
      await handleOrbVoiceConnection(ws1 as any, makeReq({ token: "ok", userId: "9999" }));
      expect(ws1._closeCode()).toBeUndefined();

      // 嘗試用不同 userId bypass（應被擋，因為 sub 相同）
      const ws2 = makeWs();
      await handleOrbVoiceConnection(ws2 as any, makeReq({ token: "ok", userId: "1111" }));
      expect(ws2.close).toHaveBeenCalledWith(1013, "too-many-sessions");

      ws1._emit("close");
    } finally {
      if (env === undefined) delete process.env.ORB_VOICE_MAX_CONCURRENT;
      else process.env.ORB_VOICE_MAX_CONCURRENT = env;
    }
  });

  it("超過 maxPayload 的 binary frame → 回 error 不崩潰", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-payload" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    const bigBuf = Buffer.alloc(ORB_MAX_PAYLOAD_BYTES + 1);
    ws._emit("message", bigBuf, true); // isBinary = true
    const errMsg = ws._sent.find(s => JSON.parse(s).type === "error");
    expect(errMsg).toBeDefined();
    expect(JSON.parse(errMsg!).message).toBe("audio-chunk-too-large");

    ws._emit("close");
  });

  it("超過 maxPayload 的 string frame → 同樣回 error", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-strpayload" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    const bigStr = "x".repeat(ORB_MAX_PAYLOAD_BYTES + 1);
    ws._emit("message", bigStr, false); // isBinary = false
    const errMsg = ws._sent.find(s => JSON.parse(s).type === "error");
    expect(errMsg).toBeDefined();

    ws._emit("close");
  });

  it("正常大小的 binary frame → 累積至 audioChunks（無立即回應）", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-ok-payload" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    const initialCount = ws._sent.length; // ready message already sent
    const smallBuf = Buffer.alloc(1024);
    ws._emit("message", smallBuf, true); // binary audio chunk
    // No new synchronous messages — chunk just accumulates
    expect(ws._sent.length).toBe(initialCount);

    ws._emit("close");
  });

  it("stop 訊號觸發 pipeline → 回 userTranscript + transcript + audio", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-pipeline" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    ws._emit("message", Buffer.alloc(512), true); // audio chunk
    ws._emit("message", JSON.stringify({ type: "stop" }), false); // trigger pipeline

    await vi.waitFor(() => {
      expect(ws._sent.some(s => JSON.parse(s).type === "audio")).toBe(true);
    }, { timeout: 2000 });

    expect(ws._sent.some(s => JSON.parse(s).type === "userTranscript")).toBe(true);
    expect(ws._sent.some(s => JSON.parse(s).type === "transcript")).toBe(true);
    expect(ws._sent.some(s => JSON.parse(s).type === "audio")).toBe(true);

    ws._emit("close");
  });

  it("pipeline 失敗時回 error 訊息", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-pipeline-err" } as any);
    vi.mocked(transcribeAudioBuffer).mockRejectedValue(new Error("ASR failed"));
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    ws._emit("message", Buffer.alloc(512), true);
    ws._emit("message", JSON.stringify({ type: "stop" }), false);

    await vi.waitFor(() => {
      expect(ws._sent.some(s => JSON.parse(s).type === "error")).toBe(true);
    }, { timeout: 2000 });

    const errMsg = ws._sent.find(s => JSON.parse(s).type === "error");
    expect(JSON.parse(errMsg!).message).toContain("ASR failed");

    ws._emit("close");
  });
});
