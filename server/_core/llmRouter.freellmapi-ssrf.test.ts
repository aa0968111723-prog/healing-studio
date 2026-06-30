/**
 * AIDV-863: freellmapi 引擎的 FREE_LLM_API_URL 必須過 SSRF 防護
 * （assertSafeExternalUrl），避免操作者/環境變數注入把後端導向私網/IMDS。
 *
 * 驗證「真的接線」（非僅 import）：私網/IMDS URL 解析引擎時應丟錯，正常 https 放行。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({
  ENV: { freeLlmApiEnabled: "true", freeLlmApiUrl: "https://api.freellmapi.com" } as Record<
    string,
    unknown
  >,
}));

vi.mock("./env", async importOriginal => {
  const actual = await importOriginal<typeof import("./env")>();
  return { ...actual, ENV: envMock.ENV };
});

import { resolveEngineConfig } from "./llmRouter";

beforeEach(() => {
  // 生產模式 → 嚴格（不放寬 localhost/私網）。
  process.env.NODE_ENV = "production";
  envMock.ENV.freeLlmApiEnabled = "true";
  envMock.ENV.freeLlmApiUrl = "https://api.freellmapi.com";
});

describe("freellmapi SSRF guard (AIDV-863)", () => {
  it("正常 https FREE_LLM_API_URL → 解析出 freellmapi 引擎設定（不丟錯）", () => {
    envMock.ENV.freeLlmApiUrl = "https://api.freellmapi.com";
    const cfg = resolveEngineConfig("freellmapi");
    expect(cfg.engine).toBe("freellmapi");
    expect(cfg.url).toContain("https://api.freellmapi.com");
  });

  it("FREE_LLM_API_URL 指向 IMDS（169.254.169.254）→ 擋下（SSRF）", () => {
    envMock.ENV.freeLlmApiUrl = "http://169.254.169.254/latest/meta-data/";
    expect(() => resolveEngineConfig("freellmapi")).toThrow();
  });

  it("FREE_LLM_API_URL 指向私網（10.x）→ 擋下", () => {
    envMock.ENV.freeLlmApiUrl = "http://10.0.0.5:8080";
    expect(() => resolveEngineConfig("freellmapi")).toThrow();
  });
});
