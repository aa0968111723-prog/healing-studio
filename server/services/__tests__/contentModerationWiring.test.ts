/**
 * contentModerationWiring.test.ts — AIDV-65 production wiring 測試
 *
 * 為何需要這檔（對照姊妹卡 AIDV-69 ragGuardSidedoorWiring.test.ts）：
 *  contentModeration.test.ts 只孤立驗了三個 helper 的 on/off 行為，「helper 對」
 *  不代表「呼叫端接對」。本檔以**真 wiring**（透過 appRouter caller）斷言 production
 *  呼叫端真的接到 fail-closed：
 *
 *   (1) routers.ts checkSafety 的 catch 分支（invokeLLM 拋錯／逾時）：
 *       預設 ON  → checkSafety 回 {safe:false}，generate.multimodal 丟 TRPCError(BAD_REQUEST)。
 *       回退 OFF → fail-open，不因安全檢查擋下（不丟「小兔子提醒你」）。
 *   (2) routers.ts checkSafety 的 parse-fail 分支（invokeLLM 回可解析但缺 safe boolean，
 *       例如 `{}`／`{"reason":"..."}`）：
 *       預設 ON  → fail-closed 丟 TRPCError；回退 OFF → fail-open，不因安全檢查擋下。
 *   (3) videoStudio.wanTextToVideo payload：預設 ON 時送給 fal 的
 *       enable_safety_checker===true（即使 input.enableSafety=false）；回退 OFF 維持現值。
 *
 *  若日後有人把 checkSafety 的 fallback 改回硬寫 `return {safe:true}`、把 wan payload
 *  的 resolveFalSafetyChecker 拿掉、或把 gate 接到錯的旗標／改錯預設，本檔會紅。
 *
 * 旗標機制：CONTENT_SAFETY_FAIL_CLOSED 走 env.validated（serverEnv，import-time singleton）。
 *  本檔 mock env.validated，spread 真實 serverEnv 後只覆寫該鍵為可變值，逐案切換。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.validated mock：保留真實 serverEnv 全部鍵（appRouter 依賴樹會讀很多鍵），
// 只把 CONTENT_SAFETY_FAIL_CLOSED 換成可變值。vi.hoisted 讓工廠提升後仍可引用。
const { envOverride } = vi.hoisted(() => ({
  envOverride: { value: "true" as string | undefined },
}));
vi.mock("../../_core/env.validated", async () => {
  const actual = await vi.importActual<typeof import("../../_core/env.validated")>(
    "../../_core/env.validated"
  );
  return {
    ...actual,
    serverEnv: new Proxy(actual.serverEnv as Record<string, unknown>, {
      get(target, prop) {
        if (prop === "CONTENT_SAFETY_FAIL_CLOSED") return envOverride.value;
        return target[prop as string];
      },
    }),
  };
});

import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";
import type { User } from "../../../drizzle/schema";

function setFlag(v: string | undefined) {
  envOverride.value = v;
}

beforeEach(() => {
  envOverride.value = "true"; // schema default＝ON＝fail-closed
});

afterEach(() => {
  envOverride.value = "true";
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
    // 模擬逾時／provider 錯誤：invokeLLM 直接 reject → 走 checkSafety catch 分支
    // （每次嘗試皆 reject，含重試）。
    vi.spyOn(llm, "invokeLLM").mockRejectedValue(new Error("simulated LLM timeout"));
  });

  it("預設 ON → fail-closed：generate.multimodal 丟 TRPCError(BAD_REQUEST) 安全擋下", async () => {
    setFlag(undefined); // 未設＝預設 fail-closed
    await expect(callMultimodal()).rejects.toThrow(SAFETY_BLOCK_MARKER);
  });

  it("明確回退 OFF（false）→ fail-open：不因安全檢查擋下（不丟「小兔子提醒你」）", async () => {
    setFlag("false");
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
    // 可解析的 object 但**缺 safe 欄位** → 形狀不符 → unparseable → 重試耗盡後
    // 走 fail-closed gate。這正是 fix 的核心：先前 `parsed.safe !== false` 會把
    // `{}` 誤判為 safe:true。
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

  it("預設 ON → fail-closed：缺 safe 欄位視同無法解析，丟 TRPCError 擋下", async () => {
    setFlag(undefined);
    await expect(callMultimodal()).rejects.toThrow(SAFETY_BLOCK_MARKER);
  });

  it("明確回退 OFF（off）→ fail-open：缺 safe 欄位仍放行（不因安全檢查擋下）", async () => {
    setFlag("off");
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

// ─── (1b) checkSafety 正常通過：不誤擋（旗標 ON 時 safe 內容仍放行）──────────
//
// fail-closed 只擋「逾時/錯誤/無法解析」；LLM 明確回 {safe:true} 時必須放行。

describe("AIDV-65 wiring — checkSafety 正常 safe 判定（不誤擋）", () => {
  beforeEach(async () => {
    await mockBlockSidePaths();
    const llm = await import("../../_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ safe: true, reason: "" }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
  });

  it("ON（預設）＋LLM 回 safe:true → 不因安全檢查擋下（不丟「小兔子提醒你」）", async () => {
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
// 斷言旗標 ON（預設）時 wanTextToVideo 送給 fal 的 enable_safety_checker===true。
// falQueueRun → falQueueSubmit → dispatchFalQueueTask({ modelId, input, ... })，
// input 即送往 fal 的 payload。spy dispatchFalQueueTask 即可攔到 payload。

describe("AIDV-65 wiring — videoStudio.wanTextToVideo fal payload", () => {
  async function spyDispatch() {
    const dispatcher = await import("../../services/falDispatcher");
    return vi
      .spyOn(dispatcher, "dispatchFalQueueTask")
      .mockResolvedValue({ request_id: "wiring-test-req" } as any);
  }

  it("預設 ON → payload.enable_safety_checker===true（即使 input.enableSafety=false）", async () => {
    setFlag(undefined);
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

  it("明確回退 OFF（false）→ payload.enable_safety_checker 維持現值（input.enableSafety=false → false）", async () => {
    setFlag("false");
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
