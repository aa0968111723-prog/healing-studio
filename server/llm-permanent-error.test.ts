/**
 * llm-permanent-error.test.ts — 永久錯誤分類與斷路器立即跳閘
 *
 * Railway 上看到的失敗序列：
 *   [CircuitBreaker] 🔴 openrouter 試探失敗，重新斷路（冷卻 15s）
 *   [Anthropic Claude API] LLM invoke failed: 400 Bad Request –
 *     {"type":"error","error":{"type":"invalid_request_error",
 *      "message":"Your credit balance is too low to access the Anthropic API..."}}
 *
 * 這類「金鑰失效 / 額度耗盡」屬於不會自動恢復的永久錯誤。如果讓 fallback 鏈
 * 每次都重新撞一次主引擎，就會：
 *   1. 浪費單次呼叫 5-10 秒等 timeout；
 *   2. 在 LangSmith 累積一堆假的 error trace，蓋住真正的問題；
 *   3. 對 Anthropic / OpenRouter 提交大量會被計費的失敗請求。
 *
 * 此檔驗證的合約：
 *   1. classifyLLMError 能從 status + body 判斷 permanent_quota / permanent_auth；
 *   2. invokeSingleEngine 收到 permanent 錯誤時不會重試；
 *   3. recordEngineFailure({ permanent: true }) 立刻把斷路器 OPEN，cooldown
 *      切換成 PERMANENT_FAILURE_COOLDOWN_MS（10 分鐘），不再受 trips 影響；
 *   4. recordEngineSuccess 一次後清掉 override，恢復正常 transient 行為。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY =
    process.env.OPENROUTER_API_KEY || "test-or-key";
  process.env.ANTHROPIC_API_KEY =
    process.env.ANTHROPIC_API_KEY || "test-anth-key";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gem-key";
});

import { classifyLLMError, invokeLLM, LLMPermanentError } from "./_core/llm";
import {
  __unsafeResetCircuitForTests,
  isEngineAvailable,
  recordEngineFailure,
  recordEngineSuccess,
  getCircuitBreakerStatus,
  type LLMEngine,
} from "./_core/llmRouter";

const ALL_ENGINES: LLMEngine[] = [
  "openrouter",
  "anthropic",
  "perplexity",
  "gemini",
  "nvidia",
  "vertex",
  "forge",
];

function resetAll() {
  for (const e of ALL_ENGINES) __unsafeResetCircuitForTests(e);
}

describe("classifyLLMError — 從 status + body 判斷錯誤性質", () => {
  it("Anthropic 400 'credit balance is too low' → permanent_quota", () => {
    const body = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API.",
      },
    });
    expect(classifyLLMError(400, body)).toEqual({
      permanent: true,
      reason: "permanent_quota",
    });
  });

  it("OpenAI-style 'You exceeded your current quota' → permanent_quota", () => {
    const body =
      '{"error":{"message":"You exceeded your current quota, please check your plan and billing details."}}';
    expect(classifyLLMError(429, body).reason).toBe("permanent_quota");
    expect(classifyLLMError(429, body).permanent).toBe(true);
  });

  it("HTTP 402 Payment Required → permanent_quota（不論 body 內容）", () => {
    expect(classifyLLMError(402, "")).toEqual({
      permanent: true,
      reason: "permanent_quota",
    });
  });

  it("HTTP 401 Unauthorized → permanent_auth", () => {
    expect(classifyLLMError(401, '{"error":"missing api key"}')).toEqual({
      permanent: true,
      reason: "permanent_auth",
    });
  });

  it("HTTP 403 Forbidden → permanent_auth", () => {
    expect(classifyLLMError(403, "")).toEqual({
      permanent: true,
      reason: "permanent_auth",
    });
  });

  it("Body 'Invalid API Key' → permanent_auth（即使 status 是 400）", () => {
    expect(
      classifyLLMError(400, '{"error":{"message":"Invalid API key provided"}}')
        .reason
    ).toBe("permanent_auth");
  });

  it("HTTP 500 Internal Server Error → transient", () => {
    expect(classifyLLMError(500, "Internal server error")).toEqual({
      permanent: false,
      reason: "transient",
    });
  });

  it("HTTP 429 純粹 rate limit（沒帶 quota 字眼）→ transient", () => {
    expect(classifyLLMError(429, "Rate limit exceeded, retry later")).toEqual({
      permanent: false,
      reason: "transient",
    });
  });

  it("HTTP 503 Service Unavailable → transient", () => {
    expect(classifyLLMError(503, "service unavailable").permanent).toBe(false);
  });
});

describe("recordEngineFailure({ permanent: true }) — 立即斷路 + 長冷卻", () => {
  beforeEach(resetAll);

  it("permanent 錯誤一次就 OPEN（不需要累積 3 次）", () => {
    expect(isEngineAvailable("anthropic")).toBe(true);
    recordEngineFailure("anthropic", {
      permanent: true,
      reason: "permanent_quota",
    });
    expect(isEngineAvailable("anthropic")).toBe(false);
    const status = getCircuitBreakerStatus().anthropic;
    expect(status.state).toBe("OPEN");
    expect(status.lastFailureReason).toBe("permanent_quota");
    // 永久錯誤的 cooldown 是 10 分鐘 = 600_000ms
    expect(status.cooldownMs).toBeGreaterThanOrEqual(600_000);
  });

  it("permanent 錯誤的 cooldown 比 trips-based 退避長很多", () => {
    // 先用 transient 失敗讓 trips 升到 1（cooldown 15s）
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    const transientCooldown = getCircuitBreakerStatus().gemini.cooldownMs;
    expect(transientCooldown).toBeLessThanOrEqual(60_000);

    // 換成 permanent → cooldown 應跳到 10 分鐘
    recordEngineFailure("openrouter", {
      permanent: true,
      reason: "permanent_auth",
    });
    expect(getCircuitBreakerStatus().openrouter.cooldownMs).toBeGreaterThanOrEqual(
      600_000
    );
  });

  it("recordEngineSuccess 會清除 permanent override，恢復 transient 行為", () => {
    recordEngineFailure("anthropic", {
      permanent: true,
      reason: "permanent_quota",
    });
    expect(getCircuitBreakerStatus().anthropic.cooldownMs).toBeGreaterThanOrEqual(
      600_000
    );

    recordEngineSuccess("anthropic", 250);
    const after = getCircuitBreakerStatus().anthropic;
    expect(after.state).toBe("CLOSED");
    expect(after.lastFailureReason).toBeUndefined();
    // override 清除後再失敗，cooldown 應走 trips-based 退避（≤60s），不再是 10 分鐘
    recordEngineFailure("anthropic");
    recordEngineFailure("anthropic");
    recordEngineFailure("anthropic");
    expect(getCircuitBreakerStatus().anthropic.cooldownMs).toBeLessThanOrEqual(
      60_000
    );
  });
});

describe("invokeLLM — 永久錯誤路由到 fallback、不重試", () => {
  beforeEach(() => {
    resetAll();
    vi.unstubAllGlobals();
  });

  it("Anthropic 400 'credit balance' 會立刻交棒給 fallback、不在主引擎重試", async () => {
    let anthropicCalls = 0;
    let geminiCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) {
        anthropicCalls++;
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "Your credit balance is too low to access the Anthropic API.",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      if (u.includes("generativelanguage.googleapis.com")) {
        geminiCalls++;
        return new Response(
          JSON.stringify({
            id: "gen_1",
            created: Date.now(),
            model: "gemini-2.5-flash",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok from gemini" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 3,
              total_tokens: 7,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      // 其他引擎一律回 500（不該被選中當主路徑或實際成功）
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLM({
      engine: "anthropic", // 強制走 anthropic 主路徑
      preferEngine: "anthropic", // 但也允許 fallback
      messages: [{ role: "user", content: "hi" }],
    });

    // 主引擎只被打 1 次（permanent → 不重試）
    expect(anthropicCalls).toBe(1);
    // fallback 至少被嘗試過一次成功
    expect(geminiCalls).toBeGreaterThanOrEqual(1);
    expect(result.choices[0].message.content).toContain("ok from gemini");

    // 主引擎斷路器立即打開（permanent path）
    const cb = getCircuitBreakerStatus().anthropic;
    expect(cb.state).toBe("OPEN");
    expect(cb.lastFailureReason).toBe("permanent_quota");
    expect(cb.cooldownMs).toBeGreaterThanOrEqual(600_000);
  });

  it("丟出的錯誤是 LLMPermanentError，attribute permanent=true", async () => {
    // 把所有引擎都設為 permanent 失敗 → 用 OpenRouter 確認
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Invalid API key" } }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    let captured: unknown = null;
    try {
      // engine: 'anthropic' 不開 fallback，這樣可以驗證單引擎錯誤類型
      await invokeLLM({
        engine: "anthropic",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LLMPermanentError);
    expect((captured as LLMPermanentError).reason).toBe("permanent_auth");
    expect((captured as LLMPermanentError).status).toBe(401);
  });
});
