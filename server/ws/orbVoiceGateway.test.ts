/**
 * orbVoiceGateway.test.ts — AIDV-263
 * Verifies that the concurrent-session limit uses the authenticated identity
 * (payload.sub) and not the client-controlled userId query param.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../_core/googleAuth", () => ({
  verifySessionToken: vi.fn(),
}));

vi.mock("../services/agentToolExecutor", () => ({
  getAllowedOrigins: vi.fn(() => ["https://example.com"]),
}));

import { verifySessionToken } from "../_core/googleAuth";
import { handleOrbVoiceConnection, ORB_MAX_PAYLOAD_BYTES } from "./orbVoiceGateway";

function makeWs() {
  const sent: string[] = [];
  let closeCode: number | undefined;
  let closeReason: string | undefined;
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
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

    // 送超大 binary frame
    const bigBuf = Buffer.alloc(ORB_MAX_PAYLOAD_BYTES + 1);
    ws._emit("message", bigBuf);
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
    ws._emit("message", bigStr);
    const errMsg = ws._sent.find(s => JSON.parse(s).type === "error");
    expect(errMsg).toBeDefined();

    ws._emit("close");
  });

  it("正常大小的 binary frame → 回 transcript", async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ sub: "user-ok-payload" } as any);
    const ws = makeWs();
    await handleOrbVoiceConnection(ws as any, makeReq({ token: "ok" }));

    const smallBuf = Buffer.alloc(1024);
    ws._emit("message", smallBuf);
    const transcriptMsg = ws._sent.find(s => JSON.parse(s).type === "transcript");
    expect(transcriptMsg).toBeDefined();

    ws._emit("close");
  });
});
