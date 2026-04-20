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
    (["gemini", "nvidia", "vertex", "forge"] as LLMEngine[]).forEach(
      resetCircuit
    );
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
    // 讓 gemini 斷路
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");
    recordEngineFailure("gemini");

    const cfg = resolveEngineConfig("auto");
    // auto 優先序：gemini > nvidia > vertex > forge，gemini 斷路後應該回 nvidia
    expect(cfg.engine).not.toBe("gemini");
  });
});
