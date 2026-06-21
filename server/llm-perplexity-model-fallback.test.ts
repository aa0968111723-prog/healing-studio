/**
 * llm-perplexity-model-fallback.test.ts — AIDV-165 根因修回歸測試
 *
 * 生產事故：文字生成（director.chat Step-1 研究 / generateVideoScript）走
 * Perplexity 時，把 catalog canonical id "perplexity/sonar-pro"（帶前綴）直送
 * 原生 Perplexity API（https://api.perplexity.ai），原生 API 只接受裸名
 * "sonar-pro"，於是回 400 invalid_model；而 400 invalid_model 過去被歸類為
 * transient，導致整個功能 500 而不是降級到次選 provider。
 *
 * 本檔守護三層修復：
 *   1. normalizeModelForEngine 對原生 Perplexity 引擎會把 "perplexity/" 前綴
 *      剝掉，並把無效 / 已停用名稱安全降級到現行 sonar-pro。
 *   2. classifyLLMError 把 4xx invalid_model 標成 permanent_model（跳過重試）。
 *   3. invokeLLM 在 Perplexity 回 invalid_model 時：①不在主引擎重試；②不開
 *      斷路器（引擎本身健康）；③立刻 fallback 到次選 provider 成功，不 500；
 *      ④全部 provider 都失敗才回明確錯誤、且不吞掉原始錯誤。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  // 只設 Perplexity + Gemini：讓 Perplexity 當主路徑、Gemini 當次選 fallback。
  // 不設 OPENROUTER / ANTHROPIC，避免 fallback 鏈太長、聚焦驗證交棒行為。
  process.env.PERPLEXITY_API_KEY =
    process.env.PERPLEXITY_API_KEY || "test-pplx-key";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gem-key";
});

import {
  classifyLLMError,
  invokeLLM,
  normalizeModelForEngine,
  LLMPermanentError,
} from "./_core/llm";
import {
  __unsafeResetCircuitForTests,
  getCircuitBreakerStatus,
  isEngineAvailable,
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

// 原生 Perplexity 引擎名稱（見 llmRouter resolveSpecificEngine case "perplexity"）
const PERPLEXITY_ENGINE_NAME = "Perplexity (Sonar)";

describe("normalizeModelForEngine — 原生 Perplexity 模型名稱正規化", () => {
  it("剝掉 perplexity/ 前綴（catalog canonical id → 原生裸名）", () => {
    expect(
      normalizeModelForEngine("perplexity/sonar-pro", PERPLEXITY_ENGINE_NAME)
    ).toBe("sonar-pro");
    expect(
      normalizeModelForEngine(
        "perplexity/sonar-reasoning-pro",
        PERPLEXITY_ENGINE_NAME
      )
    ).toBe("sonar-reasoning-pro");
    expect(
      normalizeModelForEngine("perplexity/sonar", PERPLEXITY_ENGINE_NAME)
    ).toBe("sonar");
    expect(
      normalizeModelForEngine(
        "perplexity/sonar-deep-research",
        PERPLEXITY_ENGINE_NAME
      )
    ).toBe("sonar-deep-research");
  });

  it("已是裸名的現行模型原樣放行", () => {
    for (const m of [
      "sonar",
      "sonar-pro",
      "sonar-reasoning",
      "sonar-reasoning-pro",
      "sonar-deep-research",
    ]) {
      expect(normalizeModelForEngine(m, PERPLEXITY_ENGINE_NAME)).toBe(m);
    }
  });

  it("無效 / 已停用名稱安全降級到 sonar-pro（不把無效 id 直送原生 API）", () => {
    // 已停用的舊 Perplexity 模型名
    expect(
      normalizeModelForEngine("sonar-medium-online", PERPLEXITY_ENGINE_NAME)
    ).toBe("sonar-pro");
    expect(
      normalizeModelForEngine(
        "perplexity/pplx-70b-online",
        PERPLEXITY_ENGINE_NAME
      )
    ).toBe("sonar-pro");
    // 完全無關的模型誤路由到 Perplexity 引擎 → 仍給安全裸名
    expect(
      normalizeModelForEngine("claude-opus-4-7", PERPLEXITY_ENGINE_NAME)
    ).toBe("sonar-pro");
  });

  it("不影響 OpenRouter 路徑：perplexity/ 前綴在 OpenRouter 上保留", () => {
    // OpenRouter 引擎名含 "OpenRouter"，sonar 裸名要被加上 perplexity/ 前綴。
    expect(normalizeModelForEngine("sonar-pro", "OpenRouter")).toBe(
      "perplexity/sonar-pro"
    );
    // 帶前綴的含 "/" → 原樣放行（OpenRouter 接受 perplexity/sonar-pro）
    expect(normalizeModelForEngine("perplexity/sonar-pro", "OpenRouter")).toBe(
      "perplexity/sonar-pro"
    );
  });
});

describe("classifyLLMError — invalid_model 4xx → permanent_model", () => {
  it("Perplexity 原生 400 invalid_model → permanent_model", () => {
    const body = JSON.stringify({
      error: { type: "invalid_model", message: "Invalid model 'perplexity/sonar-pro'" },
    });
    expect(classifyLLMError(400, body)).toEqual({
      permanent: true,
      reason: "permanent_model",
    });
  });

  it("OpenRouter 'is not a valid model id' (400) → permanent_model", () => {
    const body =
      '{"error":{"message":"perplexity/sonar-pro is not a valid model id"}}';
    expect(classifyLLMError(400, body).reason).toBe("permanent_model");
    expect(classifyLLMError(400, body).permanent).toBe(true);
  });

  it("OpenAI-style 'The model does not exist' (404) → permanent_model", () => {
    const body =
      '{"error":{"message":"The model `foo` does not exist","code":"model_not_found"}}';
    expect(classifyLLMError(404, body).reason).toBe("permanent_model");
  });

  it("5xx 即使 body 含 model 字眼仍歸 transient（不誤殺 server 暫時故障）", () => {
    expect(
      classifyLLMError(503, "model service temporarily unavailable").permanent
    ).toBe(false);
    expect(
      classifyLLMError(500, "unknown model error on backend").reason
    ).toBe("transient");
  });

  it("auth / quota 仍優先於 model 分類", () => {
    // 401 即使 body 帶 invalid model 也應是 auth
    expect(
      classifyLLMError(401, "invalid_model and unauthorized").reason
    ).toBe("permanent_auth");
    // 402 → quota
    expect(classifyLLMError(402, "invalid model").reason).toBe(
      "permanent_quota"
    );
  });
});

describe("invokeLLM — Perplexity invalid_model 自動回退到次選 provider", () => {
  beforeEach(() => {
    resetAll();
    vi.unstubAllGlobals();
  });

  it("Perplexity 回 400 invalid_model → 不重試、不斷路、fallback 到 Gemini 成功（不 500）", async () => {
    let perplexityCalls = 0;
    let perplexityModelSeen = "";
    let geminiCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("api.perplexity.ai")) {
        perplexityCalls++;
        try {
          perplexityModelSeen = JSON.parse(String(init?.body)).model;
        } catch {
          /* ignore */
        }
        return new Response(
          JSON.stringify({
            error: {
              type: "invalid_model",
              message: "Invalid model. Permitted models: sonar, sonar-pro, ...",
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
            model: "gemini-2.5-flash",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok from gemini" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 模擬 director.chat Step-1：傳 catalog canonical id perplexity/sonar-pro。
    const result = await invokeLLM({
      model: "perplexity/sonar-pro",
      messages: [{ role: "user", content: "今天有什麼流行趨勢？" }],
    });

    // ① 根因修：原生 API 看到的是裸名 sonar-pro（前綴已被剝掉）
    expect(perplexityModelSeen).toBe("sonar-pro");
    // ② 主引擎只被打 1 次（permanent_model → 不重試）
    expect(perplexityCalls).toBe(1);
    // ③ fallback 到 Gemini 成功，不 500
    expect(geminiCalls).toBeGreaterThanOrEqual(1);
    expect(result.choices[0].message.content).toContain("ok from gemini");
    // ④ Perplexity 引擎健康（不因模型名問題被錯誤斷路 10 分鐘）
    expect(isEngineAvailable("perplexity")).toBe(true);
    const cb = getCircuitBreakerStatus().perplexity;
    expect(cb.state).not.toBe("OPEN");
  });

  it("全部 provider 都失敗 → 拋出明確錯誤，且不吞掉原始錯誤訊息", async () => {
    // Perplexity invalid_model + Gemini 也壞（500）→ 鏈全失敗
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("api.perplexity.ai")) {
        return new Response(
          JSON.stringify({
            error: { type: "invalid_model", message: "Invalid model xyz" },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      // Gemini 持續 500
      return new Response("upstream boom", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    let captured: unknown = null;
    try {
      await invokeLLM({
        model: "perplexity/sonar-pro",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    // 原始錯誤（500 / boom）必須出現在最終訊息中（不被遮蔽）
    expect(String((captured as Error).message).toLowerCase()).toMatch(
      /boom|500|gemini/
    );
  });

  it("單一強制 Perplexity 引擎（無 fallback）invalid_model → 拋 LLMPermanentError(permanent_model)", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { type: "invalid_model", message: "Invalid model abc" },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    let captured: unknown = null;
    try {
      // engine: 'perplexity' 強制、不開 fallback → 驗證錯誤型別
      await invokeLLM({
        engine: "perplexity",
        model: "perplexity/sonar-pro",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LLMPermanentError);
    expect((captured as LLMPermanentError).reason).toBe("permanent_model");
    expect((captured as LLMPermanentError).status).toBe(400);
    // permanent_model 不開斷路器（引擎健康，只是這次模型名對它無效）
    expect(getCircuitBreakerStatus().perplexity.state).not.toBe("OPEN");
  });
});
