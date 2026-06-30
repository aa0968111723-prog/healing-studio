// ============================================================================
// generation.costConsent.test.ts — AIDV-160 成本同意守門測試
// ----------------------------------------------------------------------------
// 驗證「免費/使用者選定的引擎，絕不無聲自動跨界回退到付費引擎並扣點」：
//   1. 選 mock（免費）+ mock 不可用 → cost-blocked、丟 AdapterCostBlockedError、
//      **不無聲改用 hf 生成**（runJob 完全沒被付費 provider 呼叫到）。
//   2. 選付費引擎（hf）照常生成（不回歸）；同付費層回退（hf→gemini）仍可。
//   3. 扣點/成本估算不亂改：成功回傳的 provider/cost 與實際生成 provider 一致。
//   4. buildProviderChain 的成本層級過濾正確（免費只回退免費、付費只回退付費）。
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterDeps, GenEvent, GenRequest } from "./types";
import { AdapterCostBlockedError } from "./types";
import type { ProviderId } from "@/spine/types";

// ── 假 tRPC client：記錄每個 provider 被 submitStudioJob 呼叫幾次，可注入每-provider 失敗 ──
// AIDV-959 修復後，submitStudioJob 的真實 payload 是 {studioType, requestId, modelId, prompt}，
// 不再帶 provider 欄位（伺服器 schema 本就沒有這個欄位）。provider 只能從 adapter 對外發出的
// "attempt" 事件取得，故用 track() 包一層 onEvent，在送出前先記下目前嘗試的 provider。
const submitCalls: ProviderId[] = [];
let failProviders: Set<ProviderId> = new Set();
let currentProvider: ProviderId | undefined;

function track(onEvent: (e: GenEvent) => void = () => {}) {
  return (e: GenEvent) => {
    if (e.type === "attempt") currentProvider = e.provider;
    onEvent(e);
  };
}

vi.mock("./trpcClient", () => {
  return {
    getTrpcClient: () => ({
      generate: {
        estimateCost: { query: async () => ({ costUsd: 0.012 }) },
        submitStudioJob: {
          mutate: async () => {
            const provider = currentProvider as ProviderId;
            submitCalls.push(provider);
            if (failProviders.has(provider)) {
              const e: any = new Error(`${provider} upstream fail`);
              e.data = { httpStatus: 503 };
              throw e;
            }
            return { jobId: `job-${provider}` };
          },
        },
        jobStatus: {
          query: async (input: { jobId: string }) => ({
            jobId: input.jobId,
            status: "done",
            costUsd: 0.012,
            model: "imageStudio",
            seed: 1234,
            assetUrl: "https://example/asset.png",
          }),
        },
        recordGenResult: { mutate: async () => ({ ok: true }) },
      },
    }),
  };
});

// 縮短輪詢，避免測試等待真實 1.5s。
vi.mock("./costTier", async (orig) => {
  const real = await (orig() as Promise<typeof import("./costTier")>);
  return { ...real, ENABLE_COST_CONSENT_GUARD: true };
});

import { makeGenerationTrpc, buildProviderChain } from "./generation.trpc";

function makeDeps(provider: ProviderId, faults: Record<string, boolean> = {}): AdapterDeps {
  return { getProvider: () => provider, getFaults: () => faults };
}

const baseReq = (provider: ProviderId): GenRequest => ({
  kind: "image",
  prompt: "test prompt",
  seed: 1234,
  provider,
  model: "nano-banana-2",
});

beforeEach(() => {
  submitCalls.length = 0;
  failProviders = new Set();
  currentProvider = undefined;
});

describe("buildProviderChain — 成本層級過濾", () => {
  it("免費 preferred（mock）→ 鏈內只有免費 provider，不含任何付費", () => {
    const chain = buildProviderChain("mock", ["hf", "gemini", "fal", "mock"]);
    expect(chain[0]).toBe("mock");
    expect(chain).not.toContain("hf");
    expect(chain).not.toContain("gemini");
    expect(chain).not.toContain("fal");
  });

  it("付費 preferred（hf）→ 同付費層回退保留（gemini/fal），剔除免費 mock", () => {
    const chain = buildProviderChain("hf", ["hf", "gemini", "fal", "mock"]);
    expect(chain[0]).toBe("hf");
    expect(chain).toContain("gemini");
    expect(chain).toContain("fal");
    expect(chain).not.toContain("mock");
  });
});

describe("免費引擎不可用 → 不無聲跨付費扣點", () => {
  it("選 mock + mock 故障 → cost-blocked、丟 AdapterCostBlockedError、付費 provider 完全沒被呼叫", async () => {
    const gen = makeGenerationTrpc(makeDeps("mock", { mock: true }));
    const events: GenEvent[] = [];

    await expect(
      gen.generate(baseReq("mock"), track((e) => events.push(e))),
    ).rejects.toBeInstanceOf(AdapterCostBlockedError);

    // 關鍵佐證：沒有任何付費 provider 被送去生成（submitStudioJob 從未被呼叫）。
    expect(submitCalls).toHaveLength(0);
    expect(events.some((e) => e.type === "cost-blocked")).toBe(true);
    // 不該出現「回退到付費」的 fallback 事件。
    expect(events.some((e) => e.type === "fallback")).toBe(false);
  });

  it("選 mock + mock 生成失敗（真實上游錯誤）→ 同樣 cost-blocked、不跨付費", async () => {
    failProviders = new Set<ProviderId>(["mock"]);
    const gen = makeGenerationTrpc(makeDeps("mock"));
    const events: GenEvent[] = [];

    await expect(
      gen.generate(baseReq("mock"), track((e) => events.push(e))),
    ).rejects.toBeInstanceOf(AdapterCostBlockedError);

    // mock 嘗試過一次（失敗），但沒有任何付費 provider 接手。
    expect(submitCalls).toEqual(["mock"]);
    expect(submitCalls).not.toContain("hf");
    expect(events.some((e) => e.type === "cost-blocked")).toBe(true);
  });
});

describe("付費生成不回歸", () => {
  it("選 hf（付費）→ 照常生成，回傳 provider=hf，成本如實", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf"));
    const events: GenEvent[] = [];
    const res = await gen.generate(baseReq("hf"), track((e) => events.push(e)));

    expect(res.provider).toBe("hf");
    expect(submitCalls).toEqual(["hf"]);
    expect(res.costUsd).toBe(0.012);
    expect(events.some((e) => e.type === "cost-blocked")).toBe(false);
  });

  it("選 hf + hf 故障 → 同付費層回退到 gemini（既有便利維持）、成功且不跨免費", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf", { hf: true }));
    const events: GenEvent[] = [];
    const res = await gen.generate(baseReq("hf"), track((e) => events.push(e)));

    // hf 被故障跳過 → gemini 接手成功（同付費層）。
    expect(res.provider).toBe("gemini");
    expect(submitCalls).toEqual(["gemini"]);
    // fallback 事件存在，且不是跨付費（gemini 也是付費）。
    const fb = events.find((e) => e.type === "fallback");
    expect(fb).toBeTruthy();
    if (fb && fb.type === "fallback") expect(fb.crossesToPaid).toBeFalsy();
  });

  it("選 hf + hf/gemini 皆故障 → fal 接手；mock 不在付費鏈中故不會被當成兜底", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf", { hf: true, gemini: true }));
    const res = await gen.generate(baseReq("hf"), track());
    expect(res.provider).toBe("fal");
    expect(submitCalls).toEqual(["fal"]);
  });
});
