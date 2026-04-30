/**
 * llm-fallback.test.ts — 驗證 LLM 引擎降級鏈與斷路器邏輯
 *
 * 主要驗證：
 *   1. getEngineFallbackChain 會排除主引擎，並跳過斷路中的引擎
 *   2. recordEngineFailure × N 次後斷路器會 OPEN，isEngineAvailable 回 false
 *   3. recordEngineSuccess 會立刻重置斷路器
 *   4. preferEngine / engine 兩種路由參數邏輯正確（不 fetch 實際 API）
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// 先設定假的環境變數讓 llmRouter 的 resolveSpecificEngine 不會報錯
// （只是取得設定，不發請求）vi.hoisted 確保在 import 前執行
vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY =
    process.env.OPENROUTER_API_KEY || "test-openrouter-key";
  process.env.ANTHROPIC_API_KEY =
    process.env.ANTHROPIC_API_KEY || "test-anthropic-key";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
  process.env.NVIDIA_API = process.env.NVIDIA_API || "test-nvidia-key";
  process.env.BUILT_IN_FORGE_API_KEY =
    process.env.BUILT_IN_FORGE_API_KEY || "test-forge-key";
  process.env.BUILT_IN_FORGE_API_URL =
    process.env.BUILT_IN_FORGE_API_URL || "https://forge.example.com";
});

import {
  getEngineFallbackChain,
  recordEngineFailure,
  recordEngineSuccess,
  isEngineAvailable,
  resolveEngineConfig,
  type LLMEngine,
} from "./_core/llmRouter";

function resetCircuit(engine: LLMEngine): void {
  // 連續 success reset 會把 failures 歸零並轉 CLOSED
  recordEngineSuccess(engine);
}

describe("llm-fallback: 引擎降級鏈", () => {
  beforeEach(() => {
    // 每個 test 前重置所有引擎斷路器
    (
      [
        "openrouter",
        "anthropic",
        "gemini",
        "nvidia",
        "vertex",
        "forge",
      ] as LLMEngine[]
    ).forEach(resetCircuit);
  });

  it("getEngineFallbackChain 會排除主引擎", () => {
    const chain = getEngineFallbackChain("nvidia");
    const engines = chain.map(c => c.engine);
    expect(engines).not.toContain("nvidia");
  });

  it("斷路的引擎會從降級鏈中被剔除", () => {
    // 讓 gemini 連三次失敗 → 斷路
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    expect(isEngineAvailable("gemini")).toBe(false);

    const chain = getEngineFallbackChain("nvidia");
    const engines = chain.map(c => c.engine);
    expect(engines).not.toContain("gemini");
  });

  it("recordEngineSuccess 會重置斷路器", () => {
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");
    recordEngineFailure("nvidia");
    expect(isEngineAvailable("nvidia")).toBe(false);

    recordEngineSuccess("nvidia");
    expect(isEngineAvailable("nvidia")).toBe(true);
  });

  it("強制指定引擎仍可取得設定（不受斷路器影響）", () => {
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    // resolveEngineConfig('gemini') 直接回設定，斷路只在 auto 模式檢查
    const cfg = resolveEngineConfig("gemini");
    expect(cfg.engine).toBe("gemini");
  });

  it("auto 模式會跳過不健康的引擎", () => {
    // 讓 openrouter、anthropic、gemini 都斷路
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    recordEngineFailure("anthropic");
    recordEngineFailure("anthropic");
    recordEngineFailure("anthropic");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");

    const cfg = resolveEngineConfig("auto");
    // auto 優先序：openrouter > anthropic > gemini > nvidia > vertex > forge
    expect(cfg.engine).not.toBe("openrouter");
    expect(cfg.engine).not.toBe("anthropic");
    expect(cfg.engine).not.toBe("gemini");
  });

  it("auto 模式優先選 openrouter（統一閘道首選）", () => {
    const cfg = resolveEngineConfig("auto");
    expect(cfg.engine).toBe("openrouter");
  });

  it("openrouter 斷路時 auto 模式會降級到 anthropic", () => {
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    recordEngineFailure("openrouter");
    const cfg = resolveEngineConfig("auto");
    expect(cfg.engine).toBe("anthropic");
  });

  it("anthropic 引擎設定包含 Claude Haiku 4.5 預設模型", () => {
    const cfg = resolveEngineConfig("anthropic");
    expect(cfg.engine).toBe("anthropic");
    expect(cfg.model).toContain("claude-haiku");
    expect(cfg.url).toBe("https://api.anthropic.com/v1/messages");
    expect(cfg.supportsToolCalling).toBe(true);
    expect(cfg.supportsLongContext).toBe(true);
  });

  it("anthropic 會被納入 fallback 鏈（從非 anthropic 主引擎觸發降級時）", () => {
    const chain = getEngineFallbackChain("nvidia");
    const engines = chain.map(c => c.engine);
    expect(engines).toContain("anthropic");
  });

  it("openrouter 引擎設定使用 OpenAI-compatible chat completions endpoint", () => {
    const cfg = resolveEngineConfig("openrouter");
    expect(cfg.engine).toBe("openrouter");
    expect(cfg.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(cfg.model).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+/i); // <provider>/<model>
    expect(cfg.supportsToolCalling).toBe(true);
    expect(cfg.supportsLongContext).toBe(true);
  });

  it("openrouter 會被納入 fallback 鏈（從非 openrouter 主引擎觸發降級時）", () => {
    const chain = getEngineFallbackChain("anthropic");
    const engines = chain.map(c => c.engine);
    expect(engines).toContain("openrouter");
  });
});
