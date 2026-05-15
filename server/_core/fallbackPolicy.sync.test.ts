/**
 * fallbackPolicy.sync.test.ts
 *
 * 守住「fallback 鏈裡的每個模型 ID 都是 catalog 認得的」這條不變式。
 * 歷史上 brainContext.ts 與 falDispatcher.ts 各自維護 fallback 表,容易
 * 在重構模型 catalog 後出現「fallback 指向一個已被刪掉的 ID」的漏網
 * 之魚 — 結果是 dispatcher 在主引擎掛掉時降級到一個 404 的下游。
 *
 * 統一遷到 _core/fallbackPolicy.ts 之後仍需要這層測試 — 因為 catalog
 * 是另一個檔案 (modelRegistry.ts), 兩者是同 module 的不同來源。
 */

import { describe, expect, it } from "vitest";

import {
  PER_MODEL_FALLBACK,
  PER_CATEGORY_FALLBACK,
  resolveFallbackChain,
} from "./fallbackPolicy";
import {
  getKnownModelIds,
  normalizeEngineModelId,
} from "./modelRegistry";

describe("fallbackPolicy ↔ modelRegistry 同步", () => {
  const known = getKnownModelIds();

  it("PER_MODEL_FALLBACK 的所有 key 都是 catalog 認得的 ID", () => {
    const unknownKeys = Object.keys(PER_MODEL_FALLBACK).filter(
      id => !known.has(id) && !known.has(normalizeEngineModelId(id))
    );
    expect(unknownKeys).toEqual([]);
  });

  it("PER_MODEL_FALLBACK 的所有降級目標都是 catalog 認得的 ID", () => {
    const offenders: Array<{ from: string; to: string }> = [];
    for (const [from, chain] of Object.entries(PER_MODEL_FALLBACK)) {
      for (const to of chain) {
        if (!known.has(to) && !known.has(normalizeEngineModelId(to))) {
          offenders.push({ from, to });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("PER_CATEGORY_FALLBACK 的所有候選都是 catalog 認得的 ID", () => {
    const offenders: Array<{ category: string; id: string }> = [];
    for (const [category, chain] of Object.entries(PER_CATEGORY_FALLBACK)) {
      for (const id of chain) {
        if (!known.has(id) && !known.has(normalizeEngineModelId(id))) {
          offenders.push({ category, id });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("PER_MODEL_FALLBACK 每個 key 透過 resolveFallbackChain 都拿得到非空鏈", () => {
    const empties: string[] = [];
    for (const key of Object.keys(PER_MODEL_FALLBACK)) {
      const chain = resolveFallbackChain(key);
      if (chain.length === 0) empties.push(key);
    }
    expect(empties).toEqual([]);
  });

  it("PER_MODEL_FALLBACK 鏈中不會把自己當降級對象", () => {
    const selfRefs: string[] = [];
    for (const [from, chain] of Object.entries(PER_MODEL_FALLBACK)) {
      if (chain.includes(from)) selfRefs.push(from);
    }
    expect(selfRefs).toEqual([]);
  });

  it("PER_CATEGORY_FALLBACK 同個 category 的候選不會重複", () => {
    const dupes: Array<{ category: string; id: string }> = [];
    for (const [category, chain] of Object.entries(PER_CATEGORY_FALLBACK)) {
      const seen = new Set<string>();
      for (const id of chain) {
        if (seen.has(id)) dupes.push({ category, id });
        seen.add(id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("resolveFallbackChain(model, category) 合併兩端、去除自己、保持去重", () => {
    const chain = resolveFallbackChain(
      "fal-ai/flux-pro/v1.1",
      "text-to-image"
    );
    expect(chain.length).toBeGreaterThan(0);
    expect(chain).not.toContain("fal-ai/flux-pro/v1.1");
    expect(new Set(chain).size).toBe(chain.length);
  });
});
