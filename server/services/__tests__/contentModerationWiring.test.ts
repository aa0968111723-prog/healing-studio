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

// ─── (1c) fail-closed 的「真實影響面」迴歸：駁斥「無新增負面影響」誤導論述 ─────
//
// 背景（為何這個 case 必須存在）：先前卡片/PR/Jira 與多處註解宣稱「fail-closed 對
// 使用者無新增負面影響，因為生成關鍵路徑本就依賴同一 LLM、LLM 壞時也跑不動」。
// 這與程式碼事實不符：checkSafety **下游**的 compileElitePrompt（routers.ts ~1138）
// 對 LLM 故障是**刻意 graceful fallback**——catch 後回退原始 prompt 並**繼續走
// 生成**。也就是說，在「LLM 無額度/金鑰失效」環境下：
//   - 舊行為（fail-open / 旗標 OFF）：checkSafety 放行 → pipeline 推進到「提示詞編譯」
//     步驟（compileElitePrompt 跑 graceful fallback）→ 照樣嘗試產圖。
//   - 新行為（fail-closed / 旗標 ON）：在安全門就擋死，**根本到不了**編譯步驟。
// 故 fail-closed 在 LLM 不可用時**確實新增**擋下這兩個端點的生成（刻意安全取捨，
// 非「無影響」）。本 case 用 generationBus 的 thought-update 事件把這個「行為差」釘住：
// 同樣「LLM 全程 reject」下，OFF 會 emit "compile" 節點、ON 不會。
// 若日後有人又把論述改回「無新增負面影響」並順手讓 fail-closed 也放行到編譯，本檔會紅。

describe("AIDV-65 wiring — fail-closed 真實影響面（compileElitePrompt graceful fallback 對照）", () => {
  // 捕捉某個 job 上「安全」節點的最終狀態。安全節點的 passed/error 兩個 emit 都發生
  // 在 ensureFalApiKeyConfigured 之前（routers.ts safety gate ~1940），故此判斷
  // **不依賴**測試環境有無 FAL_API_KEY，純粹反映「安全門放不放行」。
  async function collectSafetyOutcome(): Promise<{
    safetyBlocked: boolean;
    safetyNodeStatus: string | undefined;
  }> {
    const { generationBus } = await import("../../generationEvents");
    let safetyNodeStatus: string | undefined;
    const unsubscribe = generationBus.subscribe(770, event => {
      if (event.type === "thought-update" && event.node.id === "safety") {
        // 取「終態」（passed / error），忽略中途的 processing。
        if (event.node.status === "passed" || event.node.status === "error") {
          safetyNodeStatus = event.node.status;
        }
      }
    });
    let safetyBlocked = false;
    try {
      await callMultimodal();
    } catch (e) {
      if (e instanceof Error && e.message.includes(SAFETY_BLOCK_MARKER)) {
        safetyBlocked = true;
      }
      // 其他錯誤（OFF 時因環境無 FAL_API_KEY 等下游因素失敗）忽略——本 case 只關心
      // 「安全門放不放行」，不關心安全門之後的生成在 mock 環境能否真的跑完。
    } finally {
      unsubscribe();
    }
    return { safetyBlocked, safetyNodeStatus };
  }

  beforeEach(async () => {
    await mockBlockSidePaths();
    const llm = await import("../../_core/llm");
    // 模擬 LLM 無額度/金鑰失效：每次 invokeLLM 都 reject。checkSafety 與下游
    // compileElitePrompt 共用此 mock；前者走 fail-closed gate、後者走 graceful fallback。
    vi.spyOn(llm, "invokeLLM").mockRejectedValue(new Error("simulated LLM down (no quota)"));
  });

  it("ON（預設）→ 安全門擋下（safety 節點 error），生成被新增擋住（fail-closed 確有影響）", async () => {
    setFlag(undefined);
    const { safetyBlocked, safetyNodeStatus } = await collectSafetyOutcome();
    expect(safetyBlocked).toBe(true);
    expect(safetyNodeStatus).toBe("error");
  });

  it("OFF（緊急回退）→ 安全門放行（safety 節點 passed），pipeline 越過安全門續跑（駁斥「LLM 壞時生成本就跑不動」）", async () => {
    setFlag("false");
    const { safetyBlocked, safetyNodeStatus } = await collectSafetyOutcome();
    // 關鍵反證：同樣 LLM 全程 reject，唯一差別是旗標。OFF 時安全門放行、越過安全門，
    // 後續 compileElitePrompt 對同一個壞掉的 LLM 走 graceful fallback（回退原始 prompt）
    // 仍會推進生成。證明「生成關鍵路徑在 LLM 壞時也跑不動、故 fail-closed 無新增影響」
    // 為誤導：差別正是 fail-closed 在安全門新增的擋下。
    expect(safetyBlocked).toBe(false);
    expect(safetyNodeStatus).toBe("passed");
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
