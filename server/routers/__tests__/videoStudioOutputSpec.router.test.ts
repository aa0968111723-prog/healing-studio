/**
 * videoStudioOutputSpec.router.test.ts — AIDV-255 接線層驗收測試
 *
 * 驗收矩陣（對齊研究 + HARD SAFETY）：
 *  HARD SAFETY #1：未帶 outputSpec → 送 fal 的 payload 與改動前位元級相同（不注入新 key）
 *  HARD SAFETY #2：wan/minimax 自帶 resolution enum 不被 outputSpec mapper 覆蓋
 *  4K + 免費方案 → FORBIDDEN，且不送 fal、不產生 dispatch
 *  4K + 付費方案 → 放行（Wan 降級 720p；Veo3 降級 1080p）
 *  不支援模型（Kling/MiniMax）帶 outputSpec → mapper no-op，不注入 resolution/fps/codec
 *  codec 永不出現在 payload
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 攔截 fal 派發以擷取最終 payload。
const dispatchSpy = vi.fn(async () => ({ request_id: "req-xyz" }));
vi.mock("../../services/falDispatcher", () => ({
  dispatchFalQueueTask: (...args: unknown[]) => dispatchSpy(...args),
}));

// 控制使用者訂閱方案（4K 守門）。其餘 db 取用走真實（getDb 在測試回 null）。
const getUserSubscriptionMock = vi.fn();
vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getUserSubscription: (...args: unknown[]) => getUserSubscriptionMock(...args),
  };
});

import { videoStudioRouter } from "../videoStudio";

const ctx: any = {
  user: {
    id: 7,
    openId: "u7",
    role: "user",
    email: "u7@example.com",
    name: "U7",
    loginMethod: "manus",
    remainingGenerations: 99,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} },
  res: { cookie: vi.fn(), clearCookie: vi.fn() },
};

/** 取最後一次 dispatch 的 input payload。 */
function lastInput(): Record<string, unknown> {
  const call = dispatchSpy.mock.calls.at(-1);
  return (call?.[0] as { input: Record<string, unknown> }).input;
}

beforeEach(() => {
  dispatchSpy.mockClear();
  getUserSubscriptionMock.mockReset();
  // 預設付費方案（避免無關測試被 4K 守門擋）。
  getUserSubscriptionMock.mockResolvedValue({ planId: "premium", status: "active" });
});

describe("HARD SAFETY #1 — 未帶 outputSpec → payload 零變化", () => {
  it("klingTextToVideo 未帶 outputSpec → payload 不含 resolution/fps/codec", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.klingTextToVideo({ prompt: "hello", duration: "5", aspectRatio: "16:9", cfgScale: 0.5 });
    const input = lastInput();
    expect(input).toEqual({
      prompt: "hello",
      duration: "5",
      aspect_ratio: "16:9",
      cfg_scale: 0.5,
    });
    expect(input).not.toHaveProperty("resolution");
    expect(input).not.toHaveProperty("frames_per_second");
    expect(input).not.toHaveProperty("codec");
  });

  it("veo3TextToVideo 未帶 outputSpec → payload 不含 resolution", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.veo3TextToVideo({ prompt: "hi", aspectRatio: "16:9", generateAudio: true, enhancePrompt: true });
    const input = lastInput();
    expect(input).not.toHaveProperty("resolution");
    expect(input).not.toHaveProperty("codec");
    expect(input.prompt).toBe("hi");
  });

  it("wanTextToVideo 未帶 outputSpec → 仍只送既有欄位（resolution 為自帶 720p）", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.wanTextToVideo({ prompt: "w", numFrames: 81, resolution: "720p", aspectRatio: "16:9", enableSafety: false });
    const input = lastInput();
    expect(input.resolution).toBe("720p"); // 端點自帶值
    expect(input).not.toHaveProperty("frames_per_second"); // mapper 未注入
    expect(input).not.toHaveProperty("codec");
  });
});

describe("HARD SAFETY #2 — wan/minimax 自帶 resolution 不被覆蓋", () => {
  it("wanTextToVideo(v2.1) 帶 outputSpec resolution=4K，最終 resolution 仍為端點自帶 480p，且 mapper 全 no-op", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.wanTextToVideo({
      prompt: "w",
      numFrames: 81,
      resolution: "480p",
      aspectRatio: "16:9",
      enableSafety: false,
      outputSpec: { resolution: "4K", fps: 30, codec: "h264" },
    });
    const input = lastInput();
    // 端點自帶 480p 必須勝出（不被 mapper 的降級值覆蓋）
    expect(input.resolution).toBe("480p");
    // v2.1（fal-ai/wan-t2v）真實 schema 無 frames_per_second，幀率由 num_frames 控制 →
    // mapper 不得注入非該端點參數的 frames_per_second（HARD SAFETY 回歸守護）。
    expect(input).not.toHaveProperty("frames_per_second");
    expect(input).not.toHaveProperty("codec");
  });

  it("minimaxTextToVideo 帶 outputSpec，最終 resolution 仍為端點自帶 768p（mapper no-op）", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.minimaxTextToVideo({
      prompt: "m",
      promptOptimizer: true,
      duration: "6",
      resolution: "768p",
      aspectRatio: "16:9",
      outputSpec: { resolution: "1080p", fps: 60, codec: "h265" },
    });
    const input = lastInput();
    expect(input.resolution).toBe("768p");
    expect(input).not.toHaveProperty("frames_per_second"); // MiniMax fps 不可控
    expect(input).not.toHaveProperty("codec");
  });
});

describe("4K 付費守門", () => {
  it("4K + 免費方案 → FORBIDDEN 且不 dispatch", async () => {
    getUserSubscriptionMock.mockResolvedValue({ planId: "free", status: "active" });
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.veo3TextToVideo({
        prompt: "hi",
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
        outputSpec: { resolution: "4K", fps: 30, codec: "h264" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("4K + 查無方案（null）→ fail-closed FORBIDDEN", async () => {
    getUserSubscriptionMock.mockResolvedValue(null);
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.klingTextToVideo({
        prompt: "x",
        duration: "5",
        aspectRatio: "16:9",
        cfgScale: 0.5,
        outputSpec: { resolution: "4K", fps: 30, codec: "h264" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("4K + 付費方案 → 放行（Veo3 降級 1080p），且回傳 output_spec_downgrades 告知降級（不無聲謊報）", async () => {
    getUserSubscriptionMock.mockResolvedValue({ planId: "ultra", status: "active" });
    const caller = videoStudioRouter.createCaller(ctx);
    const res = await caller.veo3TextToVideo({
      prompt: "hi",
      aspectRatio: "16:9",
      generateAudio: true,
      enhancePrompt: true,
      outputSpec: { resolution: "4K", fps: 30, codec: "h264" },
    });
    expect(dispatchSpy).toHaveBeenCalled();
    expect(lastInput().resolution).toBe("1080p"); // 4K 降級
    // 付費使用者明確選 4K、過了 paywall，但實際送 1080p → 必須回報降級。
    expect((res as any).output_spec_downgrades).toEqual({
      resolution: { requested: "4K", applied: "1080p" },
    });
  });
});

describe("不支援模型帶 outputSpec → mapper no-op", () => {
  it("klingTextToVideo 帶合法 outputSpec → 不注入 resolution/fps/codec", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.klingTextToVideo({
      prompt: "k",
      duration: "5",
      aspectRatio: "16:9",
      cfgScale: 0.5,
      outputSpec: { resolution: "1080p", fps: 60, codec: "vp9" },
    });
    const input = lastInput();
    expect(input).not.toHaveProperty("resolution");
    expect(input).not.toHaveProperty("frames_per_second");
    expect(input).not.toHaveProperty("codec");
  });
});

describe("支援模型帶 outputSpec → 正確注入", () => {
  it("veo3 帶 outputSpec 720p → 注入 resolution=720p，無 codec/fps", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await caller.veo3TextToVideo({
      prompt: "v",
      aspectRatio: "16:9",
      generateAudio: true,
      enhancePrompt: true,
      outputSpec: { resolution: "720p", fps: 24, codec: "h265" },
    });
    const input = lastInput();
    expect(input.resolution).toBe("720p");
    expect(input).not.toHaveProperty("frames_per_second");
    expect(input).not.toHaveProperty("codec");
  });
});
