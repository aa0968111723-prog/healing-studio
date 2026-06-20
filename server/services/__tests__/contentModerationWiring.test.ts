/**
 * contentModerationWiring.test.ts — AIDV-65 production wiring 測試
 *
 * 為何需要這檔（對照姊妹卡 AIDV-69 ragGuardSidedoorWiring.test.ts）：
 *  contentModeration.test.ts 只孤立驗了三個 helper 的 on/off 行為，「helper 對」
 *  不代表「呼叫端接對」。本檔以**真旗標** ENABLE_STRICT_CONTENT_MODERATION 跨過
 *  helper、直接斷言 production 呼叫端真的接到 fail-closed：
 *
 *   (1) routers.ts checkSafety 的 catch 分支（invokeLLM 拋錯／逾時）：
 *       ON  → checkSafety 回 {safe:false}，generate.multimodal 丟 TRPCError(BAD_REQUEST)。
 *       OFF → fail-open，不因安全檢查擋下（不丟「小兔子提醒你」）。
 *   (2) routers.ts checkSafety 的 parse-fail 分支（invokeLLM 回可解析但缺 safe boolean，
 *       例如 `{}`／`{"reason":"..."}`）：
 *       ON  → fail-closed 丟 TRPCError；OFF → fail-open，不因安全檢查擋下。
 *   (3) videoStudio.wanTextToVideo payload：旗標 ON 時送給 fal 的
 *       enable_safety_checker===true（即使 input.enableSafety=false）；OFF 時維持現值。
 *
 *  若日後有人把 checkSafety 的 fallback 改回硬寫 `return {safe:true}`、把 wan payload
 *  的 resolveFalSafetyChecker 拿掉、或把 gate 接到錯的旗標，本檔會紅。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";
import type { User } from "../../../drizzle/schema";

const FLAG = "ENABLE_STRICT_CONTENT_MODERATION";

function setFlag(v: string | undefined) {
  if (v === undefined) delete process.env[FLAG];
  else process.env[FLAG] = v;
}

afterEach(() => {
  delete process.env[FLAG];
  vi.restoreAllMocks();
});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 4242,
    openId: "test-moderation-wiring-user",
    email: "moderation-wiring@test.com",
    name: "Moderation Wiring Tester",
    loginMethod: "manus",
    role: "user",
    quotaJson: null,
    remainingGenerations: 5,
    onboardingDone: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeCtx(user: User): TrpcContext {
  return {
    user,
    req: {} as any,
    res: { clearCookie: vi.fn() } as any,
  } as TrpcContext;
}

// ─── (1)+(2) checkSafety fail-closed wiring（透過 generate.multimodal）─────────
//
// 共用：把 generate.multimodal 阻擋路徑會碰到的 DB 寫入 mock 掉（退款 / 用量 log /
// 背景 job），讓我們能聚焦在「安全檢查到底擋不擋」。demoMode 視 DB 而定；無 DB 時
// refundUserPoints/createApiUsageLog 不一定被呼叫，故僅 mock 之、不強制次數。

async function mockBlockSidePaths() {
  const dbModule = await import("../../db");
  vi.spyOn(dbModule, "refundUserPoints").mockResolvedValue(undefined as any);
  vi.spyOn(dbModule, "createApiUsageLog").mockResolvedValue(1 as any);
  vi.spyOn(dbModule, "updateBackgroundJob").mockResolvedValue(undefined as any);
}

const SAFETY_BLOCK_MARKER = "小兔子提醒你";

async function callMultimodal() {
  const caller = appRouter.createCaller(makeCtx(makeUser()));
  return caller.generate.multimodal({
    jobId: 770,
    prompt: "wiring test prompt",
    generationType: "image",
    mode: "lightning",
    vibeCardIds: [],
    temperature: 0.5,
  } as any);
}

describe("AIDV-65 wiring — checkSafety catch 分支（invokeLLM 拋錯/逾時）", () => {
  beforeEach(async () => {
    await mockBlockSidePaths();
    const llm = await import("../../_core/llm");
    // 模擬逾時／provider 錯誤：invokeLLM 直接 reject → 走 checkSafety catch 分支。
    vi.spyOn(llm, "invokeLLM").mockRejectedValue(new Error("simulated LLM timeout"));
  });

  it("ON → fail-closed：generate.multimodal 丟 TRPCError(BAD_REQUEST) 安全擋下", async () => {
    setFlag("1");
    await expect(callMultimodal()).rejects.toThrow(SAFETY_BLOCK_MARKER);
  });

  it("OFF → fail-open：不因安全檢查擋下（不丟「小兔子提醒你」）", async () => {
    setFlag(undefined);
    // OFF 時安全檢查放行；後續真正生成會因 mock 環境而以其他原因失敗，
    // 但「絕不是」安全攔截訊息 —— 這正是 fail-open 的證明。
    let blockedBySafety = false;
    try {
      await callMultimodal();
    } catch (e) {
      if (e instanceof Error && e.message.includes(SAFETY_BLOCK_MARKER)) {
        blockedBySafety = true;
      }
    }
    expect(blockedBySafety).toBe(false);
  });
});

describe("AIDV-65 wiring — checkSafety parse-fail 分支（缺 safe boolean）", () => {
  beforeEach(async () => {
    await mockBlockSidePaths();
    const llm = await import("../../_core/llm");
    // 可解析的 object 但**缺 safe 欄位** → 形狀不符 → 走 fail-closed gate。
    // 這正是 fix 的核心：先前 `parsed.safe !== false` 會把 `{}` 誤判為 safe:true。
    vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ reason: "no safe field" }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
  });

  it("ON → fail-closed：缺 safe 欄位視同無法解析，丟 TRPCError 擋下", async () => {
    setFlag("on");
    await expect(callMultimodal()).rejects.toThrow(SAFETY_BLOCK_MARKER);
  });

  it("OFF → fail-open：缺 safe 欄位仍放行（不因安全檢查擋下）", async () => {
    setFlag(undefined);
    let blockedBySafety = false;
    try {
      await callMultimodal();
    } catch (e) {
      if (e instanceof Error && e.message.includes(SAFETY_BLOCK_MARKER)) {
        blockedBySafety = true;
      }
    }
    expect(blockedBySafety).toBe(false);
  });
});

// ─── (3) videoStudio.wanTextToVideo payload wiring ──────────────────────────
//
// 斷言旗標 ON 時 wanTextToVideo 送給 fal 的 enable_safety_checker===true。
// falQueueRun → falQueueSubmit → dispatchFalQueueTask({ modelId, input, ... })，
// input 即送往 fal 的 payload。spy dispatchFalQueueTask 即可攔到 payload。

describe("AIDV-65 wiring — videoStudio.wanTextToVideo fal payload", () => {
  async function spyDispatch() {
    const dispatcher = await import("../../services/falDispatcher");
    return vi
      .spyOn(dispatcher, "dispatchFalQueueTask")
      .mockResolvedValue({ request_id: "wiring-test-req" } as any);
  }

  it("ON → payload.enable_safety_checker===true（即使 input.enableSafety=false）", async () => {
    setFlag("1");
    const dispatchSpy = await spyDispatch();
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await caller.videoStudio.wanTextToVideo({
      prompt: "wiring video prompt",
      enableSafety: false,
    } as any);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(arg.input.enable_safety_checker).toBe(true);
  });

  it("OFF → payload.enable_safety_checker 維持現行值（input.enableSafety=false → false）", async () => {
    setFlag(undefined);
    const dispatchSpy = await spyDispatch();
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await caller.videoStudio.wanTextToVideo({
      prompt: "wiring video prompt off",
      enableSafety: false,
    } as any);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(arg.input.enable_safety_checker).toBe(false);
  });
});
