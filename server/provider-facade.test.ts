/**
 * provider-facade.test.ts — 統一供應商門面（W1-2／AIDV-11）
 *
 * 守住門面的三條鐵則：
 *   1. 未設 CF_AI_GATEWAY_BASE_URL（線上現況）＝所有供應商直連，行為零變化。
 *   2. 設了閘道＝有 CF slug 的供應商換軌（純 host 置換）；fal／suno 無 slug
 *      永遠直連。
 *   3. 操作者的明確自訂 base（如 OPENROUTER_BASE_URL）優先於閘道。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FAL_QUEUE_BASE,
  FAL_RUN_BASE,
  engineGatewayProvider,
  isRoutedViaGateway,
  providerGatewayHeaders,
  resolveProviderBaseUrl,
} from "./_core/providerFacade";
import {
  isFreeLlmApiEnabled,
  resolveEngineConfig,
} from "./_core/llmRouter";

const GW = "https://gateway.ai.cloudflare.com/v1/acct-123/my-gateway";

afterEach(() => {
  delete process.env.CF_AI_GATEWAY_BASE_URL;
  delete process.env.CF_AI_GATEWAY_TOKEN;
  delete process.env.CF_AI_GATEWAY_PROVIDERS;
});

describe("providerFacade — 直連（預設，線上現況）", () => {
  it("resolves every provider to its direct base URL when the gateway is unset", () => {
    expect(resolveProviderBaseUrl("fal_ai")).toBe("https://fal.run");
    expect(resolveProviderBaseUrl("fal_queue")).toBe("https://queue.fal.run");
    expect(resolveProviderBaseUrl("gemini")).toBe(
      "https://generativelanguage.googleapis.com"
    );
    expect(resolveProviderBaseUrl("elevenlabs")).toBe(
      "https://api.elevenlabs.io"
    );
    expect(resolveProviderBaseUrl("suno")).toBe("https://api.sunoapi.org");
    expect(resolveProviderBaseUrl("openrouter")).toBe(
      "https://openrouter.ai/api/v1"
    );
    expect(resolveProviderBaseUrl("anthropic")).toBe(
      "https://api.anthropic.com"
    );
    expect(resolveProviderBaseUrl("perplexity")).toBe(
      "https://api.perplexity.ai"
    );
    // FreeLLMAPI（AIDV ⑪）：自架 Docker 預設底址。
    expect(resolveProviderBaseUrl("freellmapi")).toBe(
      "http://localhost:8000/v1"
    );
  });

  it("lets FREELLMAPI_BASE_URL override the self-host default (explicit base wins)", () => {
    expect(
      resolveProviderBaseUrl("freellmapi", "https://my-aggregator.example.com/v1")
    ).toBe("https://my-aggregator.example.com/v1");
  });

  it("exports the fal base constants (single source for studios/dispatcher)", () => {
    expect(FAL_RUN_BASE).toBe("https://fal.run");
    expect(FAL_QUEUE_BASE).toBe("https://queue.fal.run");
  });

  it("emits no gateway headers when direct", () => {
    process.env.CF_AI_GATEWAY_TOKEN = "secret";
    expect(providerGatewayHeaders("gemini")).toEqual({});
  });
});

describe("providerFacade — CF AI Gateway 換軌", () => {
  it("host-swaps providers that have a CF slug", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    expect(resolveProviderBaseUrl("gemini")).toBe(`${GW}/google-ai-studio`);
    expect(resolveProviderBaseUrl("elevenlabs")).toBe(`${GW}/elevenlabs`);
    expect(resolveProviderBaseUrl("anthropic")).toBe(`${GW}/anthropic`);
    expect(resolveProviderBaseUrl("openrouter")).toBe(`${GW}/openrouter`);
    expect(resolveProviderBaseUrl("perplexity")).toBe(`${GW}/perplexity-ai`);
  });

  it("keeps slug-less providers direct even with the gateway on (fal/suno/freellmapi unsupported by CF)", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    expect(resolveProviderBaseUrl("fal_ai")).toBe("https://fal.run");
    expect(resolveProviderBaseUrl("fal_queue")).toBe("https://queue.fal.run");
    expect(resolveProviderBaseUrl("suno")).toBe("https://api.sunoapi.org");
    expect(isRoutedViaGateway("fal_ai")).toBe(false);
    // FreeLLMAPI 本身就是聚合閘道，不掛 CF——即使閘道開著也直連。
    expect(resolveProviderBaseUrl("freellmapi")).toBe("http://localhost:8000/v1");
    expect(isRoutedViaGateway("freellmapi")).toBe(false);
  });

  it("tolerates a trailing slash on the gateway base", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = `${GW}/`;
    expect(resolveProviderBaseUrl("anthropic")).toBe(`${GW}/anthropic`);
  });

  it("lets an explicit custom base (e.g. OPENROUTER_BASE_URL) win over the gateway", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    expect(
      resolveProviderBaseUrl("openrouter", "https://custom.example.com/v1")
    ).toBe("https://custom.example.com/v1");
    // 自訂值＝預設直連值 → 視為未自訂，照走閘道。
    expect(
      resolveProviderBaseUrl("openrouter", "https://openrouter.ai/api/v1")
    ).toBe(`${GW}/openrouter`);
  });

  it("honours the CF_AI_GATEWAY_PROVIDERS allowlist (escape hatch per provider)", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    process.env.CF_AI_GATEWAY_PROVIDERS = "gemini, elevenlabs";
    expect(resolveProviderBaseUrl("gemini")).toBe(`${GW}/google-ai-studio`);
    expect(resolveProviderBaseUrl("elevenlabs")).toBe(`${GW}/elevenlabs`);
    // 不在白名單 → 踢回直連。
    expect(resolveProviderBaseUrl("anthropic")).toBe(
      "https://api.anthropic.com"
    );
  });

  it("adds cf-aig-authorization only when routed via gateway AND a token is set", () => {
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    expect(providerGatewayHeaders("gemini")).toEqual({});

    process.env.CF_AI_GATEWAY_TOKEN = "secret";
    expect(providerGatewayHeaders("gemini")).toEqual({
      "cf-aig-authorization": "Bearer secret",
    });
    // 無 slug 的供應商即使有 token 也不附標頭。
    expect(providerGatewayHeaders("suno")).toEqual({});
  });
});

describe("providerFacade — LLM 引擎對照", () => {
  it("maps gateway-capable engines and returns null for the rest", () => {
    expect(engineGatewayProvider("openrouter")).toBe("openrouter");
    expect(engineGatewayProvider("anthropic")).toBe("anthropic");
    expect(engineGatewayProvider("gemini")).toBe("gemini");
    expect(engineGatewayProvider("perplexity")).toBe("perplexity");
    expect(engineGatewayProvider("vertex")).toBeNull();
    expect(engineGatewayProvider("nvidia")).toBeNull();
    expect(engineGatewayProvider("forge")).toBeNull();
  });

  it("maps freellmapi to its own facade key (no-op gateway headers since slug is null)", () => {
    expect(engineGatewayProvider("freellmapi")).toBe("freellmapi");
    // 無 CF slug → 即使有 token 也不附閘道標頭。
    process.env.CF_AI_GATEWAY_BASE_URL = GW;
    process.env.CF_AI_GATEWAY_TOKEN = "secret";
    expect(providerGatewayHeaders("freellmapi")).toEqual({});
  });
});

describe("FreeLLMAPI 引擎 — 預設關閉時的安全閘（AIDV ⑪）", () => {
  it("is disabled by default (flag/base/key all unset) — 未設＝零變化", () => {
    expect(isFreeLlmApiEnabled()).toBe(false);
  });

  it("refuses to resolve when explicitly selected but not enabled (never silently routes)", () => {
    expect(() => resolveEngineConfig("freellmapi")).toThrow(/未啟用/);
  });
});
