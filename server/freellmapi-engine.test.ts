/**
 * freellmapi-engine.test.ts — FreeLLMAPI 引擎接入（AIDV ⑪）
 *
 * FreeLLMAPI＝16 供應商免費額度的單一 OpenAI 相容端點（自架 Docker）。
 * 本檔守住「採用但不傷 prod」的兩條鐵則：
 *   1. 三重門檻齊備（ENABLE_FREELLMAPI ＋ FREELLMAPI_BASE_URL ＋ FREELLMAPI_API_KEY）
 *      時，顯式選用（forceEngine / LLM_ENGINE）才解析得到一個 OpenAI 相容引擎設定。
 *   2. **永不進 auto 路由**：即使啟用，auto 模式在沒有其他引擎時仍應拋錯，
 *      證明 freellmapi 不在 autoOrder——dev/test 限定，prod 絕不誤把流量送進免費聚合器。
 *
 * vi.hoisted 在 import 前佈置 process.env（serverEnv 於模組載入時快照一次）：
 * 啟用 freellmapi、並清掉其他供應商金鑰，讓 auto 沒有任何後路、結果可決定。
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ENABLE_FREELLMAPI = "true";
  process.env.FREELLMAPI_BASE_URL = "http://aggregator.local:8000/v1";
  process.env.FREELLMAPI_API_KEY = "test-freellmapi-key";
  process.env.FREELLMAPI_MODEL = "gemini-2.5-flash";
  // 清掉其他引擎金鑰，確保 auto 模式無後路（驗證 freellmapi 不在 autoOrder）。
  for (const k of [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "PERPLEXITY_API_KEY",
    "GEMINI_API_KEY",
    "NVIDIA_API",
    "NVIDA_API",
    "BUILT_IN_FORGE_API_KEY",
    "BUILT_IN_FORGE_API_URL",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "GOOGLE_CLOUD_PROJECT_ID",
    "LLM_ENGINE",
  ]) {
    delete process.env[k];
  }
});

import {
  detectAvailableEngines,
  isFreeLlmApiEnabled,
  resolveEngineConfig,
} from "./_core/llmRouter";

describe("FreeLLMAPI 引擎 — 啟用後顯式選用（AIDV ⑪）", () => {
  it("reports enabled once flag + base + key are all set", () => {
    expect(isFreeLlmApiEnabled()).toBe(true);
  });

  it("resolves an OpenAI-compatible engine config when explicitly forced", () => {
    const cfg = resolveEngineConfig("freellmapi");
    expect(cfg.engine).toBe("freellmapi");
    // 透過 providerFacade 解析的自架底址 + OpenAI 相容路徑。
    expect(cfg.url).toBe("http://aggregator.local:8000/v1/chat/completions");
    expect(cfg.apiKey).toBe("test-freellmapi-key");
    expect(cfg.model).toBe("gemini-2.5-flash");
    expect(cfg.name).toMatch(/FreeLLMAPI/);
  });

  it("surfaces in detectAvailableEngines for debug/health display", () => {
    const engines = detectAvailableEngines().map(e => e.engine);
    expect(engines).toContain("freellmapi");
  });

  it("is NOT in the auto order — auto throws when freellmapi is the only thing enabled", () => {
    // 若 freellmapi 在 autoOrder，這裡會回傳它的設定而非拋錯。
    // 拋錯＝證明它被刻意排除於 auto／fallback 路由之外（prod 安全）。
    expect(() => resolveEngineConfig()).toThrow(/沒有可用的 LLM 引擎/);
  });
});
