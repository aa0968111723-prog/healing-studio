/**
 * four-modality-pipeline.test.ts
 *
 * 創作工作室四模態路由管道驗證
 *
 * 此測試針對「創作工作室」的四個模態（影像 / 影片 / 音訊 / 語音）逐一驗證：
 *  1. providerRouter.selectProvider() 能依 intent 選出正確 provider
 *  2. 對應 provider 在 catalog 中啟用、且必要 env keys 已配置時被視為 healthy
 *  3. brainContext 的 DEFAULT_GENERATION_ENGINES 預設模型 ID 存在於 falModels catalog
 *  4. falDispatcher 的每個模態派發函式都能組出合法 FALLBACK_CHAINS
 *  5. 每個模態的 fallback 鏈中至少首選模型可被 catalog 解析（無 typo）
 *
 * 注意：此測試**不**呼叫實際 fal.ai / gemini API，僅驗證路由邏輯與目錄一致性。
 * 實際線上連線測試見 docs/reports/API_PIPELINE_TEST_REPORT_2026-04-30.md。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getProviderCatalog,
  selectProvider,
  getProviderStatus,
  type ProviderRouteIntent,
} from "./services/providerRouter";
import { __unsafe_resetProviderHealthForTests } from "./services/providerHealth";
import { FALLBACK_CHAINS } from "./services/falDispatcher";
import { getFalModelById } from "./services/falModels";
import { DEFAULT_GENERATION_ENGINES } from "./middleware/brainContext";

const OLD_ENV = { ...process.env };

interface ModalityCase {
  label: string;
  intent: ProviderRouteIntent;
  expectedProviderId: string;
  defaultEngineSlot: "imageEngine" | "videoEngine" | "audioEngine" | "voiceEngine";
  fallbackChainKey: keyof typeof FALLBACK_CHAINS;
}

const FOUR_MODALITIES: ModalityCase[] = [
  {
    label: "影像 (image)",
    intent: "generate_image",
    expectedProviderId: "fal",
    defaultEngineSlot: "imageEngine",
    fallbackChainKey: "text-to-image",
  },
  {
    label: "影片 (video)",
    intent: "generate_video",
    expectedProviderId: "fal",
    defaultEngineSlot: "videoEngine",
    fallbackChainKey: "text-to-video",
  },
  {
    label: "音訊 (audio/music)",
    intent: "generate_audio",
    expectedProviderId: "suno",
    defaultEngineSlot: "audioEngine",
    fallbackChainKey: "text-to-audio",
  },
  {
    label: "語音 (voice TTS)",
    intent: "voice_tts",
    expectedProviderId: "elevenlabs",
    defaultEngineSlot: "voiceEngine",
    fallbackChainKey: "text-to-speech",
  },
];

describe("創作工作室四模態 AI 模型路由管道", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    __unsafe_resetProviderHealthForTests();
    process.env.GEMINI_API_KEY = "test-key";
    process.env.FAL_KEY = "test-key";
    process.env.FAL_API_KEY = "test-key";
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.SUNO_API_KEY = "test-key";
    process.env.NVIDIA_API = "test-key";
  });

  describe.each(FOUR_MODALITIES)("$label", (modality) => {
    it("selectProvider 命中預期 provider", () => {
      const selection = selectProvider({ intent: modality.intent });
      expect(selection.provider).not.toBeNull();
      expect(selection.provider?.id).toBe(modality.expectedProviderId);
      expect(selection.reason).toMatch(/^selected:|^fallback:/);
    });

    it("provider 在所有 env keys 配置後狀態為 healthy", () => {
      const provider = getProviderCatalog().find(
        (p) => p.id === modality.expectedProviderId,
      );
      expect(provider, `${modality.expectedProviderId} 必須在 catalog 中`).toBeDefined();
      expect(getProviderStatus(provider!)).toBe("healthy");
    });

    it("DEFAULT_GENERATION_ENGINES 預設模型在 falModels catalog 中可解析", () => {
      const defaultEngine = DEFAULT_GENERATION_ENGINES[modality.defaultEngineSlot].engine;
      expect(defaultEngine).toMatch(/^fal-ai\//);
      const config = getFalModelById(defaultEngine);
      expect(
        config,
        `${modality.defaultEngineSlot} 的預設引擎 ${defaultEngine} 必須註冊於 FAL_MODEL_CATALOG`,
      ).toBeDefined();
    });

    it("FALLBACK_CHAINS 提供有效降級鏈且首選模型已註冊", () => {
      const chain = FALLBACK_CHAINS[modality.fallbackChainKey];
      expect(chain, `${modality.fallbackChainKey} 必須有降級鏈`).toBeDefined();
      expect(chain!.length).toBeGreaterThan(0);
      const firstChoice = chain![0];
      expect(getFalModelById(firstChoice)).toBeDefined();
    });

    it("provider fallbackChain 結構合法（IDs 都能解析回 catalog）", () => {
      const selection = selectProvider({ intent: modality.intent });
      expect(selection.fallbackChain).toBeDefined();
      const catalog = getProviderCatalog();
      for (const fallback of selection.fallbackChain) {
        expect(catalog.find((p) => p.id === fallback.id)).toBeDefined();
      }
    });
  });

  it("fallback chain 內每個 fal-ai 候選 ID 都能在 catalog 找到 (no typos)", () => {
    // 防止 fallback chain 出現拼錯的 model id (例如 "fal-ai/minimax/video-01"
    // 而非正確的 "fal-ai/minimax-video/text-to-video") — 這類 typo 會讓
    // dispatcher 試降級時拿到 null config 直接放棄整條鏈,使用者覺得「降級
    // 沒救我」。每個進到 PER_CATEGORY_FALLBACK 的 fal-ai ID 都必須對應 catalog
    // 真實條目。
    const allFallbackIds = new Set<string>();
    for (const chain of Object.values(FALLBACK_CHAINS)) {
      for (const id of chain) {
        if (id.startsWith("fal-ai/")) allFallbackIds.add(id);
      }
    }
    const missing = [...allFallbackIds].filter(
      (id) => getFalModelById(id) === undefined
    );
    expect(
      missing,
      `Fallback chain references not in catalog: ${missing.join(", ")}`
    ).toHaveLength(0);
  });

  it("四模態合併摘要：所有模態都能成功路由", () => {
    const results = FOUR_MODALITIES.map((modality) => {
      const selection = selectProvider({ intent: modality.intent });
      const defaultEngine = DEFAULT_GENERATION_ENGINES[modality.defaultEngineSlot].engine;
      const modelInCatalog = getFalModelById(defaultEngine) !== undefined;
      return {
        modality: modality.label,
        provider: selection.provider?.id ?? null,
        defaultEngine,
        modelInCatalog,
        ok:
          selection.provider?.id === modality.expectedProviderId &&
          modelInCatalog,
      };
    });

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("[four-modality-pipeline] 失敗模態：", failed);
    }
    expect(failed).toHaveLength(0);
    expect(results).toHaveLength(4);
  });
});
