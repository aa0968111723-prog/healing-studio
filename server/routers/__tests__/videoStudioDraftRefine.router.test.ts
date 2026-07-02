/**
 * videoStudioDraftRefine.router.test.ts — AIDV-16 雙層生影片接線層驗收
 *
 * 驗收矩陣：
 *  #2   未核准 take 送精修 → 拒 UNPROCESSABLE_CONTENT（422），且不 dispatch、不扣點
 *  #2b  缺 takeId / 偽造 status:"approved"（無有效核准憑證）→ 同樣拒 422
 *  #2c  跨使用者盜用他人核准憑證 → 422
 *  完整鏈：草稿（server 鑄 takeId＋draft_token）→ approveDraftTake → 精修放行
 *  精修不得降級：dispatcher 回報換模 → PRECONDITION_FAILED（寧缺勿替）
 *  60s 冪等窗：同一 take 連點 → TOO_MANY_REQUESTS，只 dispatch 一次
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 攔截 fal 派發以確認「拒絕先於 dispatch」。
const dispatchSpy = vi.fn(async (_args?: unknown) => ({ request_id: "req-draftrefine" }));
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

function makeCtx(userId: number): any {
  return {
    user: {
      id: userId,
      openId: `u${userId}`,
      role: "user",
      email: `u${userId}@example.com`,
      name: `U${userId}`,
      loginMethod: "manus",
      remainingGenerations: 99,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  };
}

const ctx = makeCtx(7);

function lastDispatch(): {
  modelId: string;
  input: Record<string, unknown>;
  allowFallback?: boolean;
} {
  const call = dispatchSpy.mock.calls.at(-1);
  return call?.[0] as {
    modelId: string;
    input: Record<string, unknown>;
    allowFallback?: boolean;
  };
}

/** 走完整「草稿 → 核准」鏈，回傳可送精修的 takeId + approvalToken。 */
async function draftAndApprove(caller: ReturnType<typeof videoStudioRouter.createCaller>) {
  const draft: any = await caller.seedanceTextToVideo({
    prompt: "quick draft",
    duration: "5",
    aspectRatio: "16:9",
  });
  const approved: any = await caller.approveDraftTake({
    takeId: draft.take.take_id,
    draftToken: draft.take.draft_token,
  });
  return {
    takeId: approved.take_id as string,
    approvalToken: approved.approval_token as string,
  };
}

beforeEach(() => {
  dispatchSpy.mockClear();
  dispatchSpy.mockImplementation(async () => ({ request_id: "req-draftrefine" }));
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

describe("AIDV-16 精修守門 server 端可強制（客戶端自報 approved 不可繞過）", () => {
  it("偽造 status=approved 但無核准憑證 → 422 且不 dispatch", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.veo31RefineSegment({
        prompt: "bypass attempt",
        approvedTake: { takeId: "take-forged", status: "approved" },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("偽造 status=approved＋偽造憑證字串 → 422 且不 dispatch", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.veo31RefineSegment({
        prompt: "bypass attempt",
        approvedTake: {
          takeId: "take-forged-2",
          status: "approved",
          approvalToken: `${Date.now() + 3_600_000}.deadbeefdeadbeefdeadbeefdeadbeef`,
        },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("盜用他人的核准憑證（跨使用者）→ 422 且不 dispatch", async () => {
    const ownerCaller = videoStudioRouter.createCaller(makeCtx(7));
    const { takeId, approvalToken } = await draftAndApprove(ownerCaller);
    dispatchSpy.mockClear();

    const thiefCaller = videoStudioRouter.createCaller(makeCtx(8));
    await expect(
      thiefCaller.veo31RefineSegment({
        prompt: "steal approval",
        approvedTake: { takeId, status: "approved", approvalToken },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("approveDraftTake 拿偽造 draftToken → 422（takeId 非本伺服器鑄造）", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    await expect(
      caller.approveDraftTake({
        takeId: "take-not-minted-by-server",
        draftToken: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      })
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
  });
});

describe("AIDV-16 完整鏈（草稿 → 核准 → 精修放行）", () => {
  it("draft→approve→refine：派發到 fal-ai/veo3.1、allowFallback=false、tier=refine", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    const { takeId, approvalToken } = await draftAndApprove(caller);
    dispatchSpy.mockClear();

    const res: any = await caller.veo31RefineSegment({
      prompt: "hero shot",
      approvedTake: { takeId, status: "approved", approvalToken },
      aspectRatio: "16:9",
      generateAudio: true,
      enhancePrompt: true,
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(lastDispatch().modelId).toBe("fal-ai/veo3.1");
    expect(lastDispatch().input.prompt).toBe("hero shot");
    // 精修寧缺勿替：派發必須明確禁止降級換模。
    expect(lastDispatch().allowFallback).toBe(false);
    expect(res.tier).toBe("refine");
    expect(res.refined_take_id).toBe(takeId);
  });

  it("60s 冪等窗：同一 take 連點兩次 → 第二次 TOO_MANY_REQUESTS，只 dispatch 一次", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    const { takeId, approvalToken } = await draftAndApprove(caller);
    dispatchSpy.mockClear();

    const refineInput = {
      prompt: "double click",
      approvedTake: { takeId, status: "approved" as const, approvalToken },
      aspectRatio: "16:9" as const,
      generateAudio: true,
      enhancePrompt: true,
    };
    await caller.veo31RefineSegment(refineInput);
    await expect(caller.veo31RefineSegment(refineInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AIDV-16 精修不得降級（refine ≠ 任意換模）", () => {
  it("dispatcher 回報降級到非精修模型 → PRECONDITION_FAILED（寧缺勿替）", async () => {
    const caller = videoStudioRouter.createCaller(ctx);
    const { takeId, approvalToken } = await draftAndApprove(caller);
    dispatchSpy.mockClear();
    dispatchSpy.mockImplementation(async () => ({
      request_id: "req-degraded",
      modelId: "fal-ai/kling-video/v2.1/pro/text-to-video",
      degraded: true,
      originalModel: "fal-ai/veo3.1",
    }));

    await expect(
      caller.veo31RefineSegment({
        prompt: "should not ship on kling",
        approvedTake: { takeId, status: "approved", approvalToken },
        aspectRatio: "16:9",
        generateAudio: true,
        enhancePrompt: true,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("AIDV-16 草稿層（seedanceTextToVideo）", () => {
  it("派發到 Seedance Lite 草稿層並回傳 tier=draft＋server 鑄造的 take", async () => {
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
    // 誠實客戶端可核准的 take 身分由 server 回傳（takeId＋draft_token）。
    expect(typeof res.take?.take_id).toBe("string");
    expect(res.take.take_id.length).toBeGreaterThan(0);
    expect(res.take.status).toBe("draft");
    expect(typeof res.take.draft_token).toBe("string");
    expect(res.take.draft_token.length).toBeGreaterThanOrEqual(32);
  });
});
