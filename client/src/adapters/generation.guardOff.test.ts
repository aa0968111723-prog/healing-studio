// ============================================================================
// generation.guardOff.test.ts — AIDV-160 守門 OFF（回滾退路）行為
// ----------------------------------------------------------------------------
// 旗標 ENABLE_COST_CONSENT_GUARD=OFF 時，回到舊的「跨層全鏈回退」行為：
//   選 mock + mock 故障 → 仍會沿 hf→gemini→fal 全鏈回退（舊行為，保留可回滾性）。
// 這證明本次改動是「旗標可回退」的（fail 方向預設不扣費；關閉旗標才回舊行為）。
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterDeps, GenEvent, GenRequest } from "./types";
import type { ProviderId } from "@/spine/types";

// AIDV-959：submitStudioJob 真實 payload 不帶 provider 欄位，provider 改從 "attempt"
// 事件取得（見 generation.costConsent.test.ts 同款 track() 寫法）。
const submitCalls: ProviderId[] = [];
let currentProvider: ProviderId | undefined;

function track(onEvent: (e: GenEvent) => void = () => {}) {
  return (e: GenEvent) => {
    if (e.type === "attempt") currentProvider = e.provider;
    onEvent(e);
  };
}

vi.mock("./trpcClient", () => ({
  getTrpcClient: () => ({
    generate: {
      estimateCost: { query: async () => ({ costUsd: 0.012 }) },
      submitStudioJob: {
        mutate: async () => {
          const provider = currentProvider as ProviderId;
          submitCalls.push(provider);
          return { jobId: `job-${provider}` };
        },
      },
      jobStatus: {
        query: async (input: { jobId: string }) => ({
          jobId: input.jobId, status: "done", costUsd: 0.012, model: "imageStudio", seed: 1, assetUrl: "x",
        }),
      },
      recordGenResult: { mutate: async () => ({ ok: true }) },
    },
  }),
}));

// 守門 OFF：模擬部署環境設 VITE_ENABLE_COST_CONSENT_GUARD=0 後的行為。
vi.mock("./costTier", async (orig) => {
  const real = await (orig() as Promise<typeof import("./costTier")>);
  return { ...real, ENABLE_COST_CONSENT_GUARD: false };
});

import { makeGenerationTrpc, buildProviderChain } from "./generation.trpc";

function makeDeps(provider: ProviderId, faults: Record<string, boolean> = {}): AdapterDeps {
  return { getProvider: () => provider, getFaults: () => faults };
}
const req = (provider: ProviderId): GenRequest => ({ kind: "image", prompt: "p", seed: 1, provider });

beforeEach(() => { submitCalls.length = 0; currentProvider = undefined; });

describe("守門 OFF → 舊跨層全鏈回退", () => {
  it("buildProviderChain 回到全鏈（mock 後接付費 provider）", () => {
    const chain = buildProviderChain("mock", ["hf", "gemini", "fal", "mock"]);
    expect(chain).toEqual(["mock", "hf", "gemini", "fal"]);
  });

  it("選 mock + mock 故障 → 沿付費鏈回退到 hf（舊行為）", async () => {
    const gen = makeGenerationTrpc(makeDeps("mock", { mock: true }));
    const res = await gen.generate(req("mock"), track());
    expect(res.provider).toBe("hf");
    expect(submitCalls).toEqual(["hf"]);
  });
});
