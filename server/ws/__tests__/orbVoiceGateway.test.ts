import { describe, expect, it, vi } from "vitest";
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

describe("orbVoiceGateway", () => {
  it("rejects without valid JWT", async () => {
    const ws = mockWs();
    await handleOrbVoiceConnection(ws, { url: "/ws/orb-voice?token=bad" } as any);
    expect(ws.close).toHaveBeenCalled();
  });

  it("closes session after max duration", async () => {
    vi.useFakeTimers();
    process.env.ORB_VOICE_MAX_SESSION_MS = "1";
    const ws = mockWs();
    await handleOrbVoiceConnection(ws, { url: "/ws/orb-voice?token=ok&userId=1" } as any);
    vi.advanceTimersByTime(2);
    expect(ws.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("audio chunks too large emit error", async () => {
    const handlers: Record<string, (arg: any) => void> = {};
    const ws = { close: vi.fn(), send: vi.fn(), on: vi.fn((ev: string, cb: any) => { handlers[ev] = cb; }) } as any;
    await handleOrbVoiceConnection(ws, { url: "/ws/orb-voice?token=ok&userId=2" } as any);
    handlers.message?.(new Uint8Array(33 * 1024));
    expect(ws.send).toHaveBeenCalled();
  });
});
