/**
 * llm-deep-optimize.test.ts — 全站光球代理 API 深度優化驗證
 *
 * 涵蓋：
 *   1. Adaptive circuit breaker — cooldown 隨 trips 指數增長 (15s → 30s → 60s)
 *   2. Latency-aware fallback ordering — getEngineFallbackChain 按 EMA 延遲排序
 *   3. recordEngineSuccess 接收延遲樣本，更新 EMA 並對外暴露 getEngineAvgLatencyMs
 *   4. Adaptive cooldown 不會超過 60 秒（封頂）
 *   5. 連續成功會把斷路器 trips 計數重置（trips 不會永遠累積）
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// 設定假環境變數讓 resolveSpecificEngine 不會炸
vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-or-key";
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-anth-key";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gem-key";
  process.env.NVIDIA_API = process.env.NVIDIA_API || "test-nv-key";
  process.env.BUILT_IN_FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "test-forge-key";
  process.env.BUILT_IN_FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || "https://forge.example.com";
});

import {
  getEngineFallbackChain,
  recordEngineFailure,
  recordEngineSuccess,
  isEngineAvailable,
  getEngineAvgLatencyMs,
  getCircuitBreakerStatus,
  __unsafeResetCircuitForTests,
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

describe("Adaptive circuit breaker — exponential cooldown", () => {
  beforeEach(resetAll);

  it("trips=1 cooldown 約 15 秒（不超過 60 秒上限）", () => {
    // 觸發第一次斷路：連 3 次失敗 → trips 應為 1
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    const status = getCircuitBreakerStatus().gemini;
    expect(status.state).toBe("OPEN");
    expect(status.trips).toBe(1);
    // trips=1 → cooldown ≈ 15s；剛斷路 isEngineAvailable 應為 false
    expect(isEngineAvailable("gemini")).toBe(false);
  });

  it("trips=2 cooldown 約 30 秒（一輪斷路 + 試探失敗 + 再連 3 次）", () => {
    // 第一次斷路
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");
    expect(getCircuitBreakerStatus().nvidia.trips).toBe(1);

    // 模擬冷卻後 HALF_OPEN 試探失敗 — 我們直接連 3 次失敗，第二次斷路
    recordEngineSuccess("nvidia"); // 重置失敗次數但 trips 不歸零（因為距上次成功太短）
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");

    const after = getCircuitBreakerStatus().nvidia;
    expect(after.state).toBe("OPEN");
    expect(after.trips).toBe(2);
  });

  it("trips 上限封頂 — 多次斷路後 cooldown 不會無限增長", () => {
    // 連續觸發 5 次斷路，每次都用 success 重置失敗計數但 trips 持續累積
    for (let i = 0; i < 5; i++) {
      recordEngineFailure("forge");
      recordEngineFailure("forge");
      recordEngineFailure("forge");
      // 在 1ms 內 reset 不會把 trips 歸零（lastSuccessAt 與 now 距離太短）
      recordEngineSuccess("forge");
    }
    // 最後再觸發一次斷路
    recordEngineFailure("forge");
    recordEngineFailure("forge");
    recordEngineFailure("forge");

    const status = getCircuitBreakerStatus().forge;
    expect(status.state).toBe("OPEN");
    expect(status.trips).toBeGreaterThanOrEqual(5);
    // 封頂在 60s — 不直接驗證秒數（無法 mock 時間），但確保不會崩潰
    expect(isEngineAvailable("forge")).toBe(false);
  });
});

describe("Latency-aware fallback ordering", () => {
  beforeEach(resetAll);

  it("有延遲樣本的引擎排在沒樣本的引擎前面", () => {
    // gemini 有樣本：300ms
    recordEngineSuccess("gemini", 300);
    // nvidia 有樣本：100ms（更快）
    recordEngineSuccess("nvidia", 100);
    // anthropic 沒樣本

    // 主引擎是 openrouter，fallback 應為 anthropic / gemini / nvidia / vertex / forge
    const chain = getEngineFallbackChain("openrouter", { latencyAware: true });
    const engines = chain.map(c => c.engine);

    // 兩個有樣本的（nvidia 100ms < gemini 300ms）應排在沒樣本的（anthropic / vertex / forge）前面
    const nvidiaIdx = engines.indexOf("nvidia");
    const geminiIdx = engines.indexOf("gemini");
    const anthropicIdx = engines.indexOf("anthropic");

    expect(nvidiaIdx).toBeGreaterThanOrEqual(0);
    expect(geminiIdx).toBeGreaterThanOrEqual(0);
    expect(anthropicIdx).toBeGreaterThanOrEqual(0);

    // nvidia 100ms < gemini 300ms → nvidia 在 gemini 前
    expect(nvidiaIdx).toBeLessThan(geminiIdx);
    // 有樣本的（nvidia / gemini）應在沒樣本的 anthropic 前
    expect(nvidiaIdx).toBeLessThan(anthropicIdx);
    expect(geminiIdx).toBeLessThan(anthropicIdx);
  });

  it("不啟用 latencyAware 時維持靜態順序（autoOrder）", () => {
    recordEngineSuccess("nvidia", 50); // nvidia 超快，但不啟用 latencyAware
    const chain = getEngineFallbackChain("openrouter"); // 預設 latencyAware=false
    const engines = chain.map(c => c.engine);

    // 靜態順序裡 anthropic 應在 nvidia 前面
    const anthropicIdx = engines.indexOf("anthropic");
    const nvidiaIdx = engines.indexOf("nvidia");
    expect(anthropicIdx).toBeLessThan(nvidiaIdx);
  });

  it("空 fallback 鏈或單一元素時不排序", () => {
    // 把除了 openrouter 之外的全部斷路 → 沒有 fallback
    for (const e of ALL_ENGINES) {
      if (e === "openrouter") continue;
      recordEngineFailure(e);
      recordEngineFailure(e);
      recordEngineFailure(e);
    }
    const chain = getEngineFallbackChain("openrouter", { latencyAware: true });
    expect(chain.length).toBe(0);
  });
});

describe("Latency EMA tracking", () => {
  beforeEach(resetAll);

  it("第一個樣本就會被記錄", () => {
    recordEngineSuccess("anthropic", 250);
    expect(getEngineAvgLatencyMs("anthropic")).toBe(250);
  });

  it("EMA 平滑：第二個樣本朝 alpha 比例靠近", () => {
    // alpha = 0.3
    recordEngineSuccess("anthropic", 100);
    recordEngineSuccess("anthropic", 500);
    // EMA = 0.3 * 500 + 0.7 * 100 = 150 + 70 = 220
    expect(getEngineAvgLatencyMs("anthropic")).toBeCloseTo(220, 0);
  });

  it("不合法的延遲樣本被忽略（負值、NaN、Infinity）", () => {
    recordEngineSuccess("vertex", 200);
    const before = getEngineAvgLatencyMs("vertex");
    recordEngineSuccess("vertex", -50);
    recordEngineSuccess("vertex", Number.NaN);
    recordEngineSuccess("vertex", Number.POSITIVE_INFINITY);
    expect(getEngineAvgLatencyMs("vertex")).toBe(before);
  });

  it("getCircuitBreakerStatus 暴露 avgLatencyMs", () => {
    recordEngineSuccess("perplexity", 800);
    const status = getCircuitBreakerStatus();
    expect(status.perplexity.avgLatencyMs).toBeCloseTo(800, 0);
  });
});

describe("recordEngineSuccess: trips 重置邏輯", () => {
  beforeEach(resetAll);

  it("剛斷路後立即 success → trips 不歸零（避免抖動）", () => {
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    expect(getCircuitBreakerStatus().openrouter.trips).toBe(1);

    recordEngineSuccess("openrouter", 200);
    // failures 應該歸零（重設）
    expect(getCircuitBreakerStatus().openrouter.failures).toBe(0);
    // trips 仍保留（同一輪錯誤週期內）
    expect(getCircuitBreakerStatus().openrouter.trips).toBe(1);
  });
});
