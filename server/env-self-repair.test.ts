import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Env Self-Repair Tests
 * ────────────────────────────────────────────────────────────────────────
 * Lock in the behaviour that env.validated.ts mutates process.env in place
 * when it detects common operator mistakes (typo'd var names, illegal
 * characters in identifiers, non-numeric durations, malformed JSON).
 *
 * The module is intentionally re-imported per-test via `vi.resetModules`
 * so each scenario runs with a fresh process.env snapshot.
 */

import { vi } from "vitest";

const ENV_KEYS_TO_RESET = [
  "NTHROPIC_API_KEY",
  "ANTROPIC_API_KEY",
  "NVIDA_API",
  "FAL_KEY",
  "ANTHROPIC_API_KEY",
  "NVIDIA_API",
  "FAL_API_KEY",
  "PINECONE_API_KEY",
  "PINECONE_INDEX_NAME",
  "PERPLEXITY_API_KEY",
  "OPENPOSE_API_KEY",
  "VITE_POSTHOG_KEY",
  "POSTHOG_API_KEY",
  "GITHUB_TOKEN",
  "DISCORD_WEBHOOK_URL",
  "REDIS_URL",
  "LANGSMITH_API_KEY",
  "JWT_ACCESS_TOKEN_EXPIRES_IN",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  "DATABASE_URL",
  "AUTH_SECRET",
  "JWT_SECRET",
];

describe("env.validated self-repair", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS_TO_RESET) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS_TO_RESET) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("renames NTHROPIC_API_KEY to ANTHROPIC_API_KEY (missing leading A)", async () => {
    process.env.NTHROPIC_API_KEY = "sk-ant-test-typo-1";
    const mod = await import("./_core/env.validated");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-typo-1");
    expect(mod.serverEnv.ANTHROPIC_API_KEY).toBe("sk-ant-test-typo-1");
    const log = mod.getEnvSelfRepairLog();
    expect(log.some(l => l.varName === "NTHROPIC_API_KEY" && l.action === "renamed")).toBe(true);
  });

  it("does not overwrite the canonical name when both are present", async () => {
    process.env.NTHROPIC_API_KEY = "sk-ant-typo";
    process.env.ANTHROPIC_API_KEY = "sk-ant-canonical";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.ANTHROPIC_API_KEY).toBe("sk-ant-canonical");
  });

  it("renames NVIDA_API to NVIDIA_API", async () => {
    process.env.NVIDA_API = "nvapi-test";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.NVIDIA_API).toBe("nvapi-test");
  });

  it("renames FAL_KEY to FAL_API_KEY", async () => {
    process.env.FAL_KEY = "fal-test-key";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.FAL_API_KEY).toBe("fal-test-key");
  });

  it("sanitises PINECONE_INDEX_NAME with illegal characters", async () => {
    process.env.PINECONE_INDEX_NAME = "fQ3B8g|hZ:2x0F>[B3.CZ";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.PINECONE_INDEX_NAME).toBe("ai-director-memories");
    const log = mod.getEnvSelfRepairLog();
    expect(log.some(l => l.varName === "PINECONE_INDEX_NAME" && l.action === "sanitized")).toBe(true);
  });

  it("keeps a clean PINECONE_INDEX_NAME untouched", async () => {
    process.env.PINECONE_INDEX_NAME = "my-clean-index";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.PINECONE_INDEX_NAME).toBe("my-clean-index");
    const log = mod.getEnvSelfRepairLog();
    expect(log.find(l => l.varName === "PINECONE_INDEX_NAME")).toBeUndefined();
  });

  it("resets non-numeric JWT_ACCESS_TOKEN_EXPIRES_IN to default", async () => {
    process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = "di36v2fgooyicr4yx80ec6po82jw1blj";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.JWT_ACCESS_TOKEN_EXPIRES_IN).toBe("2592000");
    const log = mod.getEnvSelfRepairLog();
    expect(log.some(l => l.varName === "JWT_ACCESS_TOKEN_EXPIRES_IN" && l.action === "reset_to_default")).toBe(true);
  });

  it("preserves a numeric JWT_ACCESS_TOKEN_EXPIRES_IN", async () => {
    process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = "3600";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.JWT_ACCESS_TOKEN_EXPIRES_IN).toBe("3600");
  });

  // AIDV-59（H4 JWT 硬化）：AUTH_SECRET → JWT_SECRET 別名解析
  it("maps AUTH_SECRET alias to JWT_SECRET when JWT_SECRET is unset", async () => {
    delete process.env.JWT_SECRET;
    process.env.AUTH_SECRET = "alias-strong-secret-0123456789";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.JWT_SECRET).toBe("alias-strong-secret-0123456789");
    const log = mod.getEnvSelfRepairLog();
    expect(
      log.some(l => l.varName === "AUTH_SECRET" && l.action === "renamed")
    ).toBe(true);
  });

  it("keeps explicit JWT_SECRET and ignores AUTH_SECRET when both set", async () => {
    process.env.JWT_SECRET = "canonical-strong-secret-0123456789";
    process.env.AUTH_SECRET = "alias-should-be-ignored-0123456789";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.JWT_SECRET).toBe("canonical-strong-secret-0123456789");
  });

  it("clears GOOGLE_APPLICATION_CREDENTIALS_JSON when value is not JSON", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = "68tivglhydtud3psfqfapybcg33eu2v2";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBe("");
    const log = mod.getEnvSelfRepairLog();
    expect(log.some(l => l.varName === "GOOGLE_APPLICATION_CREDENTIALS_JSON" && l.action === "ignored_invalid")).toBe(true);
  });

  it("preserves valid GOOGLE_APPLICATION_CREDENTIALS_JSON", async () => {
    const validJson = JSON.stringify({ type: "service_account", project_id: "x" });
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = validJson;
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBe(validJson);
  });

  it("ignores common placeholder values (your-xxx-api-key)", async () => {
    process.env.PINECONE_API_KEY = "your-pinecone-api-key";
    process.env.PERPLEXITY_API_KEY = "your-perplexity-api-key";
    process.env.OPENPOSE_API_KEY = "your-openpose-api-key";
    process.env.VITE_POSTHOG_KEY = "your-posthog-project-key";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.PINECONE_API_KEY).toBe("");
    expect(mod.serverEnv.PERPLEXITY_API_KEY).toBe("");
    expect(mod.serverEnv.OPENPOSE_API_KEY).toBe("");
    const log = mod.getEnvSelfRepairLog();
    expect(
      log.filter(l => l.action === "ignored_placeholder").length
    ).toBeGreaterThanOrEqual(3);
  });

  it("preserves real-looking API keys (does not match placeholder pattern)", async () => {
    process.env.PINECONE_API_KEY = "pcsk_abc123_realKey456";
    process.env.PERPLEXITY_API_KEY = "pplx-abcdef0123456789";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.PINECONE_API_KEY).toBe("pcsk_abc123_realKey456");
    expect(mod.serverEnv.PERPLEXITY_API_KEY).toBe("pplx-abcdef0123456789");
  });

  it("clears LANGSMITH_API_KEY when format is wrong (not lsv2_pt_/lsv2_sk_)", async () => {
    process.env.LANGSMITH_API_KEY = "id:69a15d7c-5305-425e-8eb0-8e7c8130a023";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.LANGSMITH_API_KEY).toBe("");
    const log = mod.getEnvSelfRepairLog();
    expect(
      log.some(
        l => l.varName === "LANGSMITH_API_KEY" && l.action === "ignored_invalid"
      )
    ).toBe(true);
  });

  it("preserves a properly formatted LangSmith key", async () => {
    process.env.LANGSMITH_API_KEY = "lsv2_pt_abcdef0123456789";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.LANGSMITH_API_KEY).toBe("lsv2_pt_abcdef0123456789");
  });

  it("clears unresolved Railway DATABASE_URL template syntax", async () => {
    process.env.DATABASE_URL = "${{MySQL.MYSQL_URL}}";
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.DATABASE_URL).toBe("");
    const log = mod.getEnvSelfRepairLog();
    expect(
      log.some(l => l.varName === "DATABASE_URL" && l.action === "ignored_invalid")
    ).toBe(true);
  });

  it("exposes new schema entries (POSTHOG, DISCORD, REDIS) with sensible defaults", async () => {
    const mod = await import("./_core/env.validated");
    expect(mod.serverEnv.POSTHOG_HOST).toBe("https://us.i.posthog.com");
    expect(mod.serverEnv.REDIS_KEY_PREFIX).toBe("healing-studio:");
    expect(mod.serverEnv.DISCORD_WEBHOOK_URL).toBe("");
    expect(mod.serverEnv.REDIS_URL).toBe("");
  });
});
