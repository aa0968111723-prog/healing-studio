/**
 * llm-engine-inference.test.ts — 驗證從 model id 推斷正確引擎的路由邏輯
 *
 * 防護的回歸場景:
 *   1. brain config 中 director 模型設為 "nvidia/minimax-m2.7" 時,
 *      auto 模式不應把它送進 OpenRouter(會 400 "is not a valid model")。
 *   2. "vertex/..." prefix 必須走 vertex engine,不可走 OpenRouter。
 *   3. "anthropic/...","google/...","minimax/..." 等 OpenRouter
 *      原生路徑應該走 openrouter engine。
 *   4. 萬一降級鏈仍把 nvidia/、vertex/ 路徑送進 OpenRouter,
 *      normalizeModelForEngine 會把它們重寫成 OpenRouter 支援的等效 ID,
 *      避免斷路器連環跳閘。
 */

import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY =
    process.env.OPENROUTER_API_KEY || "test-openrouter-key";
  process.env.ANTHROPIC_API_KEY =
    process.env.ANTHROPIC_API_KEY || "test-anthropic-key";
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
  process.env.NVIDIA_API = process.env.NVIDIA_API || "test-nvidia-key";
});

import {
  inferEngineFromModelId,
  inferEngineFromModelIdSafe,
} from "./_core/llmRouter";

describe("inferEngineFromModelId — model id prefix → engine routing", () => {
  it("nvidia/* prefix routes to nvidia engine (NVIDIA NIM)", () => {
    expect(inferEngineFromModelId("nvidia/minimax-m2.7")).toBe("nvidia");
    expect(inferEngineFromModelId("minimaxai/minimax-m2.7")).toBe("nvidia");
    // Nemotron 系列也走 NIM（catalog 與 OpenRouter 共用 nvidia/* 命名）
    expect(
      inferEngineFromModelId("nvidia/llama-3.1-nemotron-ultra-253b-v1")
    ).toBe("nvidia");
    expect(
      inferEngineFromModelId("nvidia/llama-3.3-nemotron-super-49b-v1.5")
    ).toBe("nvidia");
  });

  it("vertex/* prefix routes to vertex engine, not OpenRouter", () => {
    expect(inferEngineFromModelId("vertex/gemini-2.5-pro")).toBe("vertex");
    expect(inferEngineFromModelId("vertex/llama-3.1-405b")).toBe("vertex");
    expect(inferEngineFromModelId("vertex/mistral-nemo")).toBe("vertex");
  });

  it("OpenRouter native paths route to openrouter engine", () => {
    expect(inferEngineFromModelId("anthropic/claude-sonnet-4.5")).toBe(
      "openrouter"
    );
    expect(inferEngineFromModelId("google/gemini-2.5-pro")).toBe("openrouter");
    expect(inferEngineFromModelId("minimax/minimax-m2")).toBe("openrouter");
    expect(inferEngineFromModelId("meta-llama/llama-3.1-405b-instruct")).toBe(
      "openrouter"
    );
    expect(inferEngineFromModelId("mistralai/mistral-nemo")).toBe("openrouter");
  });

  it("bare claude-* routes to anthropic native API", () => {
    expect(inferEngineFromModelId("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferEngineFromModelId("claude-haiku-4-5-20251001")).toBe(
      "anthropic"
    );
  });

  it("bare gemini-* routes to gemini native API", () => {
    expect(inferEngineFromModelId("gemini-2.5-pro")).toBe("gemini");
    expect(inferEngineFromModelId("gemini-2.5-flash")).toBe("gemini");
  });

  it("explicit openrouter/ prefix routes to openrouter", () => {
    expect(inferEngineFromModelId("openrouter/anthropic/claude-sonnet-4.5"))
      .toBe("openrouter");
  });

  it("returns null for unknown / empty / non-string input", () => {
    expect(inferEngineFromModelId(null)).toBeNull();
    expect(inferEngineFromModelId(undefined)).toBeNull();
    expect(inferEngineFromModelId("")).toBeNull();
    expect(inferEngineFromModelId("totally-unknown-model")).toBeNull();
  });

  it("inferEngineFromModelIdSafe returns engine when configured", () => {
    expect(inferEngineFromModelIdSafe("anthropic/claude-sonnet-4.5")).toBe(
      "openrouter"
    );
    expect(inferEngineFromModelIdSafe("nvidia/minimax-m2.7")).toBe("nvidia");
  });
});
