// ============================================================================
// generation.contract.test.ts — AIDV-959 前後端契約回歸守門
// ----------------------------------------------------------------------------
// 真人走查 director.today 發現 generate.estimateCost / submitStudioJob 的前端
// payload 與後端 zod schema 欄位名不符（kind vs generationType/studioType，
// 缺必填 requestId）→ 所有 provider 在送出前就被 schema 擋下回 400，創作者完全
// 拿不到任何主視覺。本測試鎖死 adapter 實際送出的欄位形狀，避免日後改名漂移
// 又無人察覺（卡描述「期望修法 3：補上前後端契約測試」）。
//
// 與後端 schema 對照（server/routers/generate.ts）：
//   estimateCost      input: { generationType: "image"|"video"|"audio"|"voice", durationSec?, charCount? }
//   submitStudioJob   input: { studioType: "image"|"video"|"audio"|"voice", requestId: string,
//                               modelId: string, label?, prompt? }
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterDeps, GenRequest } from "./types";
import type { ProviderId } from "@/spine/types";

const estimateCalls: unknown[] = [];
const submitCalls: unknown[] = [];

vi.mock("./trpcClient", () => ({
  getTrpcClient: () => ({
    generate: {
      estimateCost: {
        query: async (input: unknown) => {
          estimateCalls.push(input);
          return { pointsCost: 5 };
        },
      },
      submitStudioJob: {
        mutate: async (input: unknown) => {
          submitCalls.push(input);
          return { jobId: "job-1" };
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

import { makeGenerationTrpc } from "./generation.trpc";

function makeDeps(provider: ProviderId): AdapterDeps {
  return { getProvider: () => provider, getFaults: () => ({}) };
}

beforeEach(() => {
  estimateCalls.length = 0;
  submitCalls.length = 0;
});

describe("AIDV-959 前後端契約：generate.estimateCost / submitStudioJob", () => {
  it("estimateCost 送 generationType（不送 kind），值是 image|video|audio|voice 之一", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf"));
    const req: GenRequest = { kind: "image", prompt: "p", seed: 1, provider: "hf" };
    await gen.generate(req, () => {});

    expect(estimateCalls).toHaveLength(1);
    const sent = estimateCalls[0] as Record<string, unknown>;
    expect(sent.generationType).toBe("image");
    expect(sent.kind).toBeUndefined();
  });

  it("keyframe 比照 submitStudioJob 既有映射，estimateCost 也歸類為 image（伺服器無 keyframe 這個 generationType）", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf"));
    const req: GenRequest = { kind: "keyframe", prompt: "p", seed: 1, provider: "hf" };
    await gen.generate(req, () => {});

    expect((estimateCalls[0] as Record<string, unknown>).generationType).toBe("image");
  });

  it("submitStudioJob 送 studioType + requestId(string) + modelId(string)，不送 kind/seed/provider/shotNo/projectId", async () => {
    const gen = makeGenerationTrpc(makeDeps("hf"));
    const req: GenRequest = { kind: "image", prompt: "p", seed: 9809, provider: "hf", shotNo: "s1", projectId: 1 };
    await gen.generate(req, () => {});

    expect(submitCalls).toHaveLength(1);
    const sent = submitCalls[0] as Record<string, unknown>;
    expect(sent.studioType).toBe("image");
    expect(typeof sent.requestId).toBe("string");
    expect((sent.requestId as string).length).toBeGreaterThan(0);
    expect(typeof sent.modelId).toBe("string");
    expect(sent.kind).toBeUndefined();
    expect(sent.seed).toBeUndefined();
    expect(sent.provider).toBeUndefined();
    expect(sent.shotNo).toBeUndefined();
    expect(sent.projectId).toBeUndefined();
  });
});
