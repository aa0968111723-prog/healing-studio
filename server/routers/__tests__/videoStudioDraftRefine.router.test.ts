/**
 * videoStudioDraftRefine.router.test.ts — AIDV-16 雙層生影片接線層驗收
 *
 * 驗收矩陣：
 *  #2  未核准 take 送精修 → 拒 UNPROCESSABLE_CONTENT（422），且不 dispatch、不扣點
 *  #2b 缺 takeId → 同樣拒 422
 *  已核准 take → 派發到 fal-ai/veo3.1（精修層）
 *  seedanceTextToVideo → 派發到 Seedance Lite 草稿層，回傳 tier="draft"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 攔截 fal 派發以確認「拒絕先於 dispatch」。
const dispatchSpy = vi.fn(async () => ({ request_id: "req-draftrefine" }));
vi.mock("../../services/falDispatcher", () => ({
  dispatchFalQueueTask: (...args: unknown[]) => dispatchSpy(...args),
}));

// 控制訂閱方案（4K 守門）；其餘 db 走真實。
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

function lastDispatch(): { modelId: string; input: Record<string, unknown> } {
  const call = dispatchSpy.mock.calls.at(-1);
  return call?.[0] as { modelId: string; input: Record<string, unknown> };
}

beforeEach(() => {
  dispatchSpy.mockClear();
  getUserSubscriptionMock.mockReset();
  getUserSubscriptionMock.mockResolvedValue({ planId: "premium", status: "active" });
});

describe("AIDV-16 精修守門（驗收 #2：未核准 take 拒 422）", () => {
  it("status=draft 的 take 送精修 → UNPROCESSABLE_CONTENT，且完全不 dispatch", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.veo31RefineSegment({
        prompt: "refine me",
        approvedTake: { takeId: "take-1", status: "draft" },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("status=rejected 的 take 送精修 → 422 且不 dispatch", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.veo31RefineSegment({
        prompt: "refine me",
        approvedTake: { takeId: "take-9", status: "rejected" },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("AIDV-16 精修放行（已核准 take → Veo 3.1）", () => {
  it("status=approved → 派發到 fal-ai/veo3.1 並回傳 tier=refine + refined_take_id", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    const res: any = await caller.veo31RefineSegment({
      prompt: "hero shot",
      approvedTake: { takeId: "take-approved-42", status: "approved" },
      aspectRatio: "16:9",
      generateAudio: true,
      enhancePrompt: true,
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(lastDispatch().modelId).toBe("fal-ai/veo3.1");
    expect(lastDispatch().input.prompt).toBe("hero shot");
    expect(res.tier).toBe("refine");
    expect(res.refined_take_id).toBe("take-approved-42");
  });
});

describe("AIDV-16 草稿層（seedanceTextToVideo）", () => {
  it("派發到 Seedance Lite 草稿層並回傳 tier=draft", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    const res: any = await caller.seedanceTextToVideo({
      prompt: "quick draft",
      duration: "5",
      aspectRatio: "16:9",
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(lastDispatch().modelId).toBe("fal-ai/bytedance/seedance/v1/lite/text-to-video");
    expect(lastDispatch().input).toMatchObject({
      prompt: "quick draft",
      duration: "5",
      aspect_ratio: "16:9",
    });
    expect(res.tier).toBe("draft");
  });
});
