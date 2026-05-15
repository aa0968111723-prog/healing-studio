import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOrbVoiceConnection } from "../orbVoiceGateway";

vi.mock("../../_core/googleAuth", () => ({
  verifySessionToken: vi.fn(async (token: string) => token === "ok" ? { sub: "u1" } : null),
}));

function mockWs() {
  return {
    close: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
  } as any;
}

function mockReqWithCookie(cookie?: string, url = "/ws/orb-voice"): any {
  return {
    url,
    headers: cookie ? { cookie } : {},
  };
}

describe("orbVoiceGateway", () => {
  // 大多數測試需要 gateway 啟用才能跑到後續邏輯；單測用 beforeEach / afterEach
  // 控制環境變數，避免互相污染。
  beforeEach(() => {
    process.env.ENABLE_ORB_VOICE_GATEWAY = "true";
  });
  afterEach(() => {
    delete process.env.ENABLE_ORB_VOICE_GATEWAY;
    delete process.env.ORB_VOICE_MAX_SESSION_MS;
  });

  it("rejects without valid JWT (no cookie, bad query token)", async () => {
    const ws = mockWs();
    await handleOrbVoiceConnection(ws, mockReqWithCookie(undefined, "/ws/orb-voice?token=bad"));
    expect(ws.close).toHaveBeenCalledWith(1008, "unauthorized");
  });

  it("rejects when no cookie AND no query token are provided", async () => {
    const ws = mockWs();
    await handleOrbVoiceConnection(ws, mockReqWithCookie());
    expect(ws.close).toHaveBeenCalledWith(1008, "unauthorized");
  });

  it("authenticates via httpOnly session cookie (production path)", async () => {
    const handlers: Record<string, (arg: any) => void> = {};
    const ws = { close: vi.fn(), send: vi.fn(), on: vi.fn((ev: string, cb: any) => { handlers[ev] = cb; }) } as any;
    await handleOrbVoiceConnection(
      ws,
      mockReqWithCookie("app_session_id=ok; other=junk", "/ws/orb-voice?userId=10")
    );
    // ready 訊息應該送出（不會被 1008 拒絕）
    expect(ws.close).not.toHaveBeenCalledWith(1008, "unauthorized");
    const readyCalls = ws.send.mock.calls.filter((c: any[]) =>
      typeof c[0] === "string" && c[0].includes('"type":"ready"')
    );
    expect(readyCalls.length).toBeGreaterThan(0);
  });

  it("cookie takes precedence over query token when both present", async () => {
    const ws = mockWs();
    await handleOrbVoiceConnection(
      ws,
      mockReqWithCookie("app_session_id=ok", "/ws/orb-voice?token=bad")
    );
    expect(ws.close).not.toHaveBeenCalledWith(1008, "unauthorized");
  });

  it("closes session after max duration", async () => {
    vi.useFakeTimers();
    process.env.ORB_VOICE_MAX_SESSION_MS = "1";
    const ws = mockWs();
    await handleOrbVoiceConnection(ws, { url: "/ws/orb-voice?token=ok&userId=1", headers: {} } as any);
    vi.advanceTimersByTime(2);
    expect(ws.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("audio chunks too large emit error", async () => {
    const handlers: Record<string, (arg: any) => void> = {};
    const ws = { close: vi.fn(), send: vi.fn(), on: vi.fn((ev: string, cb: any) => { handlers[ev] = cb; }) } as any;
    await handleOrbVoiceConnection(
      ws,
      { url: "/ws/orb-voice?token=ok&userId=2", headers: {} } as any
    );
    handlers.message?.(new Uint8Array(33 * 1024));
    expect(ws.send).toHaveBeenCalled();
  });

  describe("when ENABLE_ORB_VOICE_GATEWAY=false (default)", () => {
    beforeEach(() => {
      delete process.env.ENABLE_ORB_VOICE_GATEWAY;
    });

    it("sends voice-gateway-disabled error and politely closes", async () => {
      vi.useFakeTimers();
      const ws = mockWs();
      await handleOrbVoiceConnection(ws, { url: "/ws/orb-voice?token=ok&userId=3", headers: {} } as any);
      // error 訊息應該已送出
      expect(ws.send).toHaveBeenCalled();
      const sendArg = String(ws.send.mock.calls[0][0]);
      expect(sendArg).toContain("voice-gateway-disabled");
      // 50ms 後 socket 應該被優雅關閉
      vi.advanceTimersByTime(60);
      expect(ws.close).toHaveBeenCalledWith(1011, "voice-gateway-disabled");
      vi.useRealTimers();
    });
  });
});
