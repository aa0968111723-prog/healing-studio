/**
 * server/services/orbFeatureDiscovery.test.ts
 *
 * AIDV-548 — 功能推薦引擎（方案 A 頻率統計）回歸測試。
 *
 * 錨定真實演算法（非 trivially-passing）：
 *   - computeFeatureRecommendations 的過濾/排序/評分（突變即紅）。
 *   - buildInteractionUpdate 的欄位映射。
 *   - toProficiencyMap 的聚合與跳過規則。
 *   - generateRecommendations 端到端（mocked db）：有歷史→非空＋寫入＋回真實 id；
 *     失敗/DB 未設定→降級回 []。
 *   - recordRecommendationInteraction：有效 id 才寫回、無效 id 不寫。
 *   - getProficiencyMap：唯讀聚合成 featureId→score。
 *
 * DB 於 module 邊界 mock，測純邏輯與路由，不需 live MySQL。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));

// orbFeatureDiscovery 從 "../db" import getDb（此測試檔在 server/services/，
// 同樣解析到 server/db）。
vi.mock("../db", () => ({
  getDb: async () => h.db,
}));

import {
  orbFeatureDiscovery,
  computeFeatureRecommendations,
  buildInteractionUpdate,
  toProficiencyMap,
  type FeatureUsageInput,
  type FeatureGlobalPopularity,
} from "./orbFeatureDiscovery";

// ─── 可控 drizzle-mysql builder mock ─────────────────────────────────────────
function makeDb(opts: {
  selectQueue?: unknown[];
  onInsert?: (values: unknown) => unknown;
  onUpdate?: (set: unknown, where: unknown) => void;
}) {
  const selectQueue = opts.selectQueue ?? [];
  const mkThenable = (getVal: () => unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["from", "where", "groupBy", "orderBy", "limit", "set", "values"]) {
      b[m] = () => b;
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(getVal()).then(res, rej);
    return b;
  };
  return {
    select: () => mkThenable(() => selectQueue.shift()),
    insert: () => ({
      values: (v: unknown) =>
        Promise.resolve(opts.onInsert ? opts.onInsert(v) : [{ insertId: 1 }]),
    }),
    update: () => ({
      set: (s: unknown) => ({
        where: (w: unknown) => {
          opts.onUpdate?.(s, w);
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
  };
}

beforeEach(() => {
  h.db = null;
});

// ─── computeFeatureRecommendations（純函式核心） ─────────────────────────────
describe("computeFeatureRecommendations", () => {
  const userUsage: FeatureUsageInput[] = [
    { featureId: "a", usageCount: 10 },
    { featureId: "b", usageCount: 2 },
  ];
  const global: FeatureGlobalPopularity[] = [
    { featureId: "a", totalUsage: 50, userCount: 5 }, // used → 不推
    { featureId: "b", totalUsage: 20, userCount: 3 }, // used → 不推
    { featureId: "c", totalUsage: 30, userCount: 4 }, // unused 熱門
    { featureId: "d", totalUsage: 5, userCount: 1 }, // unused 較冷
  ];

  it("優先推薦熱門且未使用過的功能，依 userCount 降序，排在自身低頻補額之前", () => {
    const recs = computeFeatureRecommendations(userUsage, global, 5);
    expect(recs.map((r) => r.featureId)).toEqual(["c", "d", "b", "a"]);
    // c/d 為熱門未使用
    expect(recs[0]).toMatchObject({
      featureId: "c",
      reason: "其他使用者常用但你還沒試過的功能",
      relevanceScore: 0.9, // 0.5 + 0.5*(4/5)
      basedOnFeatures: ["a", "b"], // 使用者最常用的功能作為依據
    });
    expect(recs[1].featureId).toBe("d");
    expect(recs[1].relevanceScore).toBe(0.6); // 0.5 + 0.5*(1/5)
  });

  it("補額項為使用者用得最少的既有功能，依 usageCount 升序、低分、無依據", () => {
    const recs = computeFeatureRecommendations(userUsage, global, 5);
    const fallback = recs.filter(
      (r) => r.reason === "你較少使用,值得再深入探索的功能"
    );
    expect(fallback.map((r) => r.featureId)).toEqual(["b", "a"]);
    expect(fallback[0]).toMatchObject({
      featureId: "b",
      relevanceScore: 0.44, // 0.2 + 0.3*(1 - 2/10)
      basedOnFeatures: [],
    });
    expect(fallback[1].relevanceScore).toBe(0.2); // 0.2 + 0.3*(1 - 10/10)
  });

  it("已使用過的功能不會以「熱門未試過」形式被推薦", () => {
    const recs = computeFeatureRecommendations(userUsage, global, 5);
    const popular = recs.filter(
      (r) => r.reason === "其他使用者常用但你還沒試過的功能"
    );
    expect(popular.some((r) => r.featureId === "a" || r.featureId === "b")).toBe(
      false
    );
  });

  it("熱門未試過的分數高於自身低頻補額的分數", () => {
    const recs = computeFeatureRecommendations(userUsage, global, 5);
    const popularMin = Math.min(
      ...recs
        .filter((r) => r.reason === "其他使用者常用但你還沒試過的功能")
        .map((r) => r.relevanceScore)
    );
    const fallbackMax = Math.max(
      ...recs
        .filter((r) => r.reason === "你較少使用,值得再深入探索的功能")
        .map((r) => r.relevanceScore)
    );
    expect(popularMin).toBeGreaterThan(fallbackMax);
  });

  it("尊重 limit", () => {
    expect(computeFeatureRecommendations(userUsage, global, 2).map((r) => r.featureId)).toEqual([
      "c",
      "d",
    ]);
    expect(computeFeatureRecommendations(userUsage, global, 0)).toEqual([]);
  });

  it("無熱門未使用項時，退化為推薦自身用得最少的功能", () => {
    const onlyUsedGlobal: FeatureGlobalPopularity[] = [
      { featureId: "a", totalUsage: 50, userCount: 2 },
    ];
    const recs = computeFeatureRecommendations(userUsage, onlyUsedGlobal, 5);
    expect(recs.map((r) => r.featureId)).toEqual(["b", "a"]);
    expect(recs.every((r) => r.reason === "你較少使用,值得再深入探索的功能")).toBe(
      true
    );
  });

  it("完全無資料時回空清單（失敗安全）", () => {
    expect(computeFeatureRecommendations([], [], 5)).toEqual([]);
  });
});

// ─── buildInteractionUpdate ─────────────────────────────────────────────────
describe("buildInteractionUpdate", () => {
  const now = new Date(1_700_000_000_000);

  it("clicked 只設 clickedAt", () => {
    expect(buildInteractionUpdate("clicked", undefined, now)).toEqual({
      clickedAt: now,
    });
  });

  it("used 設 usedAt，帶 feedbackRating 時一併寫入", () => {
    expect(buildInteractionUpdate("used", 4, now)).toEqual({
      usedAt: now,
      feedbackRating: 4,
    });
  });

  it("dismissed 只設 dismissedAt，無評分時不含 feedbackRating", () => {
    const u = buildInteractionUpdate("dismissed", undefined, now);
    expect(u).toEqual({ dismissedAt: now });
    expect("feedbackRating" in u).toBe(false);
  });
});

// ─── toProficiencyMap ───────────────────────────────────────────────────────
describe("toProficiencyMap", () => {
  it("聚合成 featureId→score，跳過 null 與無法解析者，保留 0", () => {
    const map = toProficiencyMap([
      { featureId: "a", proficiencyScore: "0.75" },
      { featureId: "b", proficiencyScore: null },
      { featureId: "c", proficiencyScore: "not-a-number" },
      { featureId: "d", proficiencyScore: "0" },
    ]);
    expect(map).toEqual({ a: 0.75, d: 0 });
  });
});

// ─── generateRecommendations（端到端，mocked db） ────────────────────────────
describe("orbFeatureDiscovery.generateRecommendations", () => {
  it("對有歷史使用者回非空推薦、寫入 orb_feature_recommendations 並帶回真實 id", async () => {
    let inserted = 0;
    const userRows = [{ featureId: "a", usageCount: 10 }];
    // 注意 sum/count 在 mysql2 常回字串，驗證數值化路徑。
    const globalRows = [
      { featureId: "a", totalUsage: "50", userCount: "2" }, // used
      { featureId: "c", totalUsage: "30", userCount: "3" }, // unused 熱門
    ];
    h.db = makeDb({
      selectQueue: [userRows, globalRows],
      onInsert: () => [{ insertId: 900 + ++inserted }],
    });

    const recs = await orbFeatureDiscovery.generateRecommendations(7, 5);

    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].featureId).toBe("c");
    expect(recs[0].id).toBe("901"); // 來自 insertId 的真實 id
    expect(recs[0].relevanceScore).toBeGreaterThan(0);
    expect(inserted).toBe(recs.length); // 每筆都有寫入
  });

  it("DB 未設定時降級回 []（純加性、失敗安全）", async () => {
    h.db = null;
    expect(await orbFeatureDiscovery.generateRecommendations(7, 5)).toEqual([]);
  });

  it("DB 錯誤時降級回 [] 而非 throw", async () => {
    h.db = {
      select: () => {
        throw new Error("db boom");
      },
    };
    await expect(
      orbFeatureDiscovery.generateRecommendations(7, 5)
    ).resolves.toEqual([]);
  });
});

// ─── recordRecommendationInteraction ────────────────────────────────────────
describe("orbFeatureDiscovery.recordRecommendationInteraction", () => {
  it("有效 id 會以映射後的欄位寫回 DB", async () => {
    const onUpdate = vi.fn();
    h.db = makeDb({ onUpdate });
    await orbFeatureDiscovery.recordRecommendationInteraction(7, "123", "clicked");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [setArg] = onUpdate.mock.calls[0];
    expect(setArg).toHaveProperty("clickedAt");
  });

  it("非數字 id 不觸發任何 DB 寫入", async () => {
    const onUpdate = vi.fn();
    h.db = makeDb({ onUpdate });
    await orbFeatureDiscovery.recordRecommendationInteraction(7, "abc", "used");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("id <= 0 不觸發 DB 寫入", async () => {
    const onUpdate = vi.fn();
    h.db = makeDb({ onUpdate });
    await orbFeatureDiscovery.recordRecommendationInteraction(7, "0", "dismissed");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ─── getProficiencyMap ──────────────────────────────────────────────────────
describe("orbFeatureDiscovery.getProficiencyMap", () => {
  it("唯讀聚合 usage stats 成 featureId→score", async () => {
    h.db = makeDb({
      selectQueue: [
        [
          { featureId: "a", proficiencyScore: "0.5" },
          { featureId: "b", proficiencyScore: null },
        ],
      ],
    });
    expect(await orbFeatureDiscovery.getProficiencyMap(7)).toEqual({ a: 0.5 });
  });

  it("DB 未設定時回 {}（失敗安全）", async () => {
    h.db = null;
    expect(await orbFeatureDiscovery.getProficiencyMap(7)).toEqual({});
  });
});
