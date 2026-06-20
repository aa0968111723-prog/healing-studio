/**
 * Unit tests for modelResearcher — auto-research / fact-check service.
 *
 * 涵蓋之前會靜默失敗導致前端「64 個模型全部驗證失敗」的場景：
 *   - 兩個 API key 都沒設定時，bulk run 必須一次回報「都未設定」，
 *     而不是對 64 個模型各寫一筆 "All research providers failed"。
 *   - 單一模型的 researchAndFactCheckModel 在 key 缺失時，reason 必須點明
 *     是哪個 key 缺失（不是含糊的「All research providers failed」）。
 *
 * 這些測試刻意做成「hermetic」：provider 金鑰可能存在於開發者本機的 .env，
 * 而 serverEnv 是 import 時就從 process.env 凍結的單例，所以單純 delete
 * process.env.* 並不足以隔離（getConfiguredProviders 會優先讀 serverEnv）。
 * 我們在 beforeEach 同時清掉 process.env 與 serverEnv 上的金鑰，並把 fetch
 * 換成不連網的 stub，讓行為與本機 .env／網路狀態無關、結果完全可重現。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  researchAndFactCheckAllModels,
  researchAndFactCheckModel,
  discoverNewAIReleases,
  getDiscoveries,
  __resetEnrichmentStore,
  __seedDiscovery,
} from "../../../server/services/modelResearcher";
import { serverEnv } from "../../../server/_core/env.validated";
import { resetPerplexityThrottleForTest } from "../../../server/services/perplexityThrottle";

/** 會影響 discovery / research 走哪條 provider 路徑的金鑰。 */
const PROVIDER_KEYS = [
  "PERPLEXITY_API_KEY",
  "OPENROUTER_API_KEY",
  "BRAVE_SEARCH_API_KEY",
] as const;

const ORIGINAL_PROCESS_ENV: Record<string, string | undefined> = {};
const ORIGINAL_SERVER_ENV: Record<string, string | undefined> = {};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetEnrichmentStore();
  resetPerplexityThrottleForTest();

  // 同時清掉 process.env 與 serverEnv 上的 provider 金鑰，讓「未設定」這條路徑
  // 在「本機 .env 有金鑰」的機器上也成立（getConfiguredProviders 兩邊都讀）。
  for (const key of PROVIDER_KEYS) {
    ORIGINAL_PROCESS_ENV[key] = process.env[key];
    delete process.env[key];
    ORIGINAL_SERVER_ENV[key] = (serverEnv as Record<string, string | undefined>)[key];
    (serverEnv as Record<string, string | undefined>)[key] = "";
  }

  // 預設不連網：任何 provider / 公開來源的 fetch 都確定性失敗，避免測試結果
  // 受真實網路（HN / Reddit / Perplexity）影響。個別測試可覆寫此 mock。
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("network disabled in test"));
});

afterEach(() => {
  for (const key of PROVIDER_KEYS) {
    if (ORIGINAL_PROCESS_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_PROCESS_ENV[key];
    (serverEnv as Record<string, string | undefined>)[key] = ORIGINAL_SERVER_ENV[key];
  }
  vi.restoreAllMocks();
});

describe("researchAndFactCheckAllModels — provider preflight", () => {
  it("aborts the whole bulk run with a single explanatory error when neither API key is set", async () => {
    const result = await researchAndFactCheckAllModels({
      concurrency: 2,
      userId: null,
    });

    expect(result.modelsTried).toBe(0);
    expect(result.modelsSucceeded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ modelId: "*" });
    expect(result.errors[0].reason).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.errors[0].reason).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("researchAndFactCheckModel — provider failure surfacing", () => {
  it("returns an actionable reason naming the missing keys (not the generic 'All research providers failed')", async () => {
    const result = await researchAndFactCheckModel(
      "claude-opus-4-7", // any real id from the catalog
      { force: true, userId: null }
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).not.toBe("All research providers failed");
    expect(result.reason).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.reason).toMatch(/OPENROUTER_API_KEY/);
  });

  it("respects the 7-day failure backoff — does not retry a recently-failed model", async () => {
    // 兩支金鑰都設好以越過「未設定」的 preflight；接著用「HTTP 200 但 body 無法
    // 解析」強制 *非暫時性* 的 provider 失敗（empty payload，不是 401/節流/網路）。
    // 唯有非暫時性失敗會把 factCheck.status 記成 "error" 並寫 checkedAt，這正是
    // 觸發 7 天 backoff 的狀態；兩支都得失敗，否則含「未設定」會被歸為暫時性。
    (serverEnv as Record<string, string | undefined>).PERPLEXITY_API_KEY =
      "test-perplexity-key";
    (serverEnv as Record<string, string | undefined>).OPENROUTER_API_KEY =
      "test-openrouter-key";
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    } as unknown as Response);

    // First call: hard failure (no usable provider payload) → recorded as error.
    const first = await researchAndFactCheckModel("gpt-4o", {
      userId: null,
    });
    expect(first.ok).toBe(false);

    // Second call (no force): should be skipped due to backoff.
    const second = await researchAndFactCheckModel("gpt-4o", {
      userId: null,
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/backoff/);
  });
});

describe("discoverNewAIReleases", () => {
  it("returns a clear error naming the missing keys when neither provider key is set", async () => {
    // 金鑰已在 beforeEach 清空，公開來源 fallback 的網路也被停用 → 整輪失敗，
    // 錯誤訊息必須點名缺少的兩支金鑰（而非含糊的 "All discovery providers failed"）。
    const result = await discoverNewAIReleases({ userId: null, days: 7 });
    expect(result.found).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("getDiscoveries", () => {
  it("returns seeded discoveries sorted by discoveredAt desc", () => {
    __seedDiscovery({
      id: "disc_a",
      kind: "new-model",
      title: "Test Model A",
      summary: "synthetic",
      url: "https://example.com/a",
      date: "2026-05-01",
      discoveredAt: "2026-05-01T00:00:00.000Z",
      provider: "TestLab",
    });
    __seedDiscovery({
      id: "disc_b",
      kind: "new-paper",
      title: "Test Paper B",
      summary: "synthetic",
      url: "https://example.com/b",
      date: "2026-05-15",
      discoveredAt: "2026-05-15T00:00:00.000Z",
    });
    const { items, stats } = getDiscoveries(10);
    expect(items.map(i => i.id)).toEqual(["disc_b", "disc_a"]);
    expect(stats.totalRunsCompleted).toBe(0);
  });
});
