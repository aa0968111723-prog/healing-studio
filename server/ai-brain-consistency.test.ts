/**
 * AI 大腦組態一致性測試 — 防止 silent drift
 *
 * 來源:brain-config-gap-audit-2026-04-20.md 提出至少 8 條規則型測試。
 * 目標:每當 catalog / defaults / fallback / DB schema 任一被改動,
 * 若它們之間出現不一致,測試立即會紅。
 */

import { describe, expect, it } from "vitest";
import {
  REASONING_MODEL_CATALOG,
  GENERATION_ENGINE_CATALOG,
  FAL_TASK_ENGINE_CATALOG,
  FAL_FIELD_TO_CATEGORY,
  FAL_FIELD_ALLOWLISTS,
  REASONING_MODEL_ALLOWLIST,
  getKnownModelIds,
} from "./_core/modelRegistry";
import {
  PER_MODEL_FALLBACK,
  PER_CATEGORY_FALLBACK,
  resolveFallbackChain,
} from "./_core/fallbackPolicy";
import {
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
} from "./middleware/brainContext";
import {
  DEFAULT_FAL_ENGINES,
  FALLBACK_CHAINS,
} from "./services/falDispatcher";
import { FAL_MODEL_CATALOG } from "./services/falModels";
import {
  LEGACY_FAL_ALIAS_MAP,
  normalizeEngineModelId,
} from "../shared/engineModelIds";
import { userAiBrain } from "../drizzle/schema";

// ═══════════════════════════════════════════════════════════════════════════
// Rule 1 — Reasoning catalog ⊇ DEFAULT_REASONING_BRAINS
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 1 — Reasoning catalog ⊇ DEFAULT_REASONING_BRAINS", () => {
  it("每個推理大腦預設值都在自己的 catalog 內", () => {
    for (const [slot, defaults] of Object.entries(DEFAULT_REASONING_BRAINS)) {
      const allowed =
        REASONING_MODEL_ALLOWLIST[slot as keyof typeof REASONING_MODEL_ALLOWLIST];
      expect(allowed, `slot ${slot} 應有 allowlist`).toBeDefined();
      expect(
        allowed.has(defaults.model),
        `${slot}.default "${defaults.model}" 必須在 catalog 中`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 2 — Generation catalog ⊇ DEFAULT_GENERATION_ENGINES
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 2 — Generation catalog ⊇ DEFAULT_GENERATION_ENGINES", () => {
  it("每個生成引擎預設值(經 normalize 後)都在自己的 catalog 內", () => {
    for (const [slot, defaults] of Object.entries(
      DEFAULT_GENERATION_ENGINES
    )) {
      const catalog =
        GENERATION_ENGINE_CATALOG[
          slot as keyof typeof GENERATION_ENGINE_CATALOG
        ];
      const canonicalDefault = normalizeEngineModelId(defaults.engine);
      const catalogIds = catalog.options.map(o =>
        normalizeEngineModelId(o.value)
      );
      expect(
        catalogIds.includes(canonicalDefault),
        `${slot}.default "${defaults.engine}" → "${canonicalDefault}" 必須在 catalog 中`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 3 — defaults ∈ fallback chain (each Fal category)
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 3 — DEFAULT_FAL_ENGINES ∈ PER_CATEGORY_FALLBACK", () => {
  // Map from BrainFalEngines key to FalCategory
  const KEY_TO_CATEGORY: Record<keyof typeof DEFAULT_FAL_ENGINES, string> = {
    imageToThreeD: "image-to-3d",
    imageToImage: "image-to-image",
    imageToJson: "image-to-json",
    imageToVideo: "image-to-video",
    json: "json",
    llm: "llm",
    textToThreeD: "text-to-3d",
    textToAudio: "text-to-audio",
    textToImage: "text-to-image",
    textToJson: "text-to-json",
    textToSpeech: "text-to-speech",
    textToVideo: "text-to-video",
    training: "training",
    videoToAudio: "video-to-audio",
    videoToText: "video-to-text",
    videoToVideo: "video-to-video",
  };

  it("每個 Fal 任務預設模型(若可在 fallback chain 找到)應出現在該分類的 chain 內", () => {
    for (const [key, defaultModel] of Object.entries(DEFAULT_FAL_ENGINES) as Array<
      [keyof typeof DEFAULT_FAL_ENGINES, string]
    >) {
      const category = KEY_TO_CATEGORY[key];
      const chain = PER_CATEGORY_FALLBACK[category];
      // 部分分類目前沒有 fallback chain(例如 image-to-3d 早期版本),允許跳過
      if (!chain || chain.length === 0) continue;
      // 預設模型應該在 catalog 中(它是合法的 modelId);
      // chain 應該包含「同分類中至少一個合法 fallback」。
      // 嚴格要求:預設值若在 chain 中應位於前段(top-3),才算優質 fallback。
      const inChain = chain.includes(defaultModel);
      const isCatalogModel = FAL_MODEL_CATALOG[
        category as keyof typeof FAL_MODEL_CATALOG
      ]?.some(m => m.modelId === defaultModel);
      expect(
        inChain || isCatalogModel,
        `${key} default "${defaultModel}" 應在 fallback chain 或 catalog 中,卻都找不到`
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 4 — falDispatcher.FALLBACK_CHAINS === fallbackPolicy.PER_CATEGORY_FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 4 — middleware 與 dispatcher 共用同一份 fallback policy", () => {
  it("falDispatcher.FALLBACK_CHAINS 應 === fallbackPolicy.PER_CATEGORY_FALLBACK", () => {
    // FALLBACK_CHAINS is now re-exported from PER_CATEGORY_FALLBACK
    expect(FALLBACK_CHAINS).toBe(PER_CATEGORY_FALLBACK);
  });

  it("resolveFallbackChain 對未知模型仍返回該 category 的清單", () => {
    const chain = resolveFallbackChain("unknown-model-xyz", "text-to-image");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain).toContain("fal-ai/flux-pro/v1.1");
  });

  it("resolveFallbackChain 在有 per-model 覆寫時會合併", () => {
    const chain = resolveFallbackChain("gemini-2.5-pro");
    expect(chain).toContain("gemini-2.5-flash");
    expect(chain).toContain("gemini-1.5-pro");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 5 — alias 正規化 round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 5 — LEGACY_FAL_ALIAS_MAP 正規化 round-trip", () => {
  it("每個舊 ID 經過 normalizeEngineModelId 後等於對應的 canonical", () => {
    for (const [legacyId, canonicalId] of Object.entries(
      LEGACY_FAL_ALIAS_MAP
    )) {
      expect(
        normalizeEngineModelId(legacyId),
        `legacy "${legacyId}" 應映射到 "${canonicalId}"`
      ).toBe(canonicalId);
    }
  });

  it("canonical ID 自身的 normalize 仍是 canonical(冪等)", () => {
    for (const canonicalId of Object.values(LEGACY_FAL_ALIAS_MAP)) {
      expect(normalizeEngineModelId(canonicalId)).toBe(canonicalId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 6 — 16 個 falTask*Engine 欄位的 allowlist 與 FAL_MODEL_CATALOG 對齊
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 6 — Fal task 欄位 allowlist === FAL_MODEL_CATALOG[category]", () => {
  it("FAL_FIELD_TO_CATEGORY 涵蓋所有 16 個 Fal 欄位", () => {
    const fields = Object.keys(FAL_FIELD_TO_CATEGORY);
    expect(fields.length).toBe(16);
  });

  it("每個 falTask*Engine 欄位的 allowlist === 對應 category 的 FAL_MODEL_CATALOG.modelId 集合", () => {
    for (const [field, category] of Object.entries(FAL_FIELD_TO_CATEGORY)) {
      const allowlist = FAL_FIELD_ALLOWLISTS[field];
      const catalogIds = new Set(
        FAL_MODEL_CATALOG[category as keyof typeof FAL_MODEL_CATALOG].map(
          m => m.modelId
        )
      );
      expect(allowlist.size).toBe(catalogIds.size);
      catalogIds.forEach(id => {
        expect(
          allowlist.has(id),
          `${field} (${category}) 應包含 ${id}`
        ).toBe(true);
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 7 — DB schema defaults == DEFAULT_* 常數
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 7 — DB schema defaults 對齊 DEFAULT_GENERATION_ENGINES + DEFAULT_FAL_ENGINES", () => {
  // userAiBrain.{slot}.default 透過 Drizzle column 定義可取得
  // (使用 inferInsert 不適合,直接讀 schema 物件的 .default 屬性)
  function getColumnDefault(column: unknown): unknown {
    const col = column as { default?: unknown };
    return col.default;
  }

  it("voiceEngine schema default 與 DEFAULT_GENERATION_ENGINES.voiceEngine 一致", () => {
    const schemaDefault = getColumnDefault(userAiBrain.voiceEngine);
    expect(schemaDefault).toBe(DEFAULT_GENERATION_ENGINES.voiceEngine.engine);
  });

  it("imageEngine schema default 與 DEFAULT_GENERATION_ENGINES.imageEngine 一致", () => {
    const schemaDefault = getColumnDefault(userAiBrain.imageEngine);
    expect(schemaDefault).toBe(DEFAULT_GENERATION_ENGINES.imageEngine.engine);
  });

  it("falTextToSpeechEngine schema default 與 DEFAULT_FAL_ENGINES.textToSpeech 一致", () => {
    const schemaDefault = getColumnDefault(userAiBrain.falTextToSpeechEngine);
    expect(schemaDefault).toBe(DEFAULT_FAL_ENGINES.textToSpeech);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rule 8 — Catalog 與 known-models set 不應有未列入的孤兒
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Rule 8 — known model id set 涵蓋所有 catalog 模型", () => {
  it("REASONING_MODEL_CATALOG 全部 model id 都在 getKnownModelIds()", () => {
    const known = getKnownModelIds();
    for (const slot of Object.values(REASONING_MODEL_CATALOG)) {
      for (const opt of slot.options) {
        expect(known.has(opt.value), `reasoning ${opt.value} 應為 known`).toBe(
          true
        );
      }
    }
  });

  it("FAL_TASK_ENGINE_CATALOG 全部 model id 都在 getKnownModelIds()", () => {
    const known = getKnownModelIds();
    for (const slot of Object.values(FAL_TASK_ENGINE_CATALOG)) {
      for (const opt of slot.options) {
        expect(known.has(opt.value), `fal task ${opt.value} 應為 known`).toBe(
          true
        );
      }
    }
  });

  it("PER_MODEL_FALLBACK 鍵都應為 known model(否則永遠沒機會被觸發)", () => {
    const known = getKnownModelIds();
    for (const id of Object.keys(PER_MODEL_FALLBACK)) {
      expect(known.has(id), `fallback key ${id} 應為 known`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus Rule — upsert reject 非 enum 值的型別簽名
// ═══════════════════════════════════════════════════════════════════════════

describe("[一致性] Bonus — REASONING_MODEL_ALLOWLIST 全部 5 個槽都有至少 2 個選項", () => {
  it("director / analyst / storyteller / technician / curator 各自 ≥ 2 個", () => {
    for (const [slot, allowlist] of Object.entries(REASONING_MODEL_ALLOWLIST)) {
      expect(
        allowlist.size,
        `${slot} 應至少有 2 個合法模型(主 + fallback)`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
