/**
 * creator-dashboard-quota.test.ts — AIDV-277 配額透明層純函式測試
 *
 * 錨定 server/lib/quotaConfig.ts 的真實計算：方案解析、配額百分比、剩餘、預警門檻、
 * 重置時間、預生成估算、生成後投影。斷言用精確數值 → 任何算式突變即紅。
 */

import { describe, it, expect } from "vitest";
import {
  PLAN_QUOTAS,
  DEFAULT_ALERT_THRESHOLD_PCT,
  ESTIMATED_USD_PER_VIDEO,
  CREDITS_PER_VIDEO,
  resolvePlanTier,
  resolveSubscriptionTier,
  startOfMonthUtc,
  firstDayOfNextMonthUtc,
  computeQuotaStatus,
  estimateGenerationCost,
  projectQuotaAfter,
} from "./lib/quotaConfig";

describe("PLAN_QUOTAS 配額定義（AIDV-273 收斂設計）", () => {
  it("四個層級的每月配額與月費估算符合卡上設計", () => {
    expect(PLAN_QUOTAS.free).toEqual({ videosPerMonth: 5, costEstimateUsd: 0 });
    expect(PLAN_QUOTAS.starter).toEqual({ videosPerMonth: 20, costEstimateUsd: 9.99 });
    expect(PLAN_QUOTAS.pro).toEqual({ videosPerMonth: 100, costEstimateUsd: 39.99 });
    expect(PLAN_QUOTAS.unlimited.videosPerMonth).toBe(Infinity);
    expect(PLAN_QUOTAS.unlimited.costEstimateUsd).toBeNull();
  });

  it("預設預警門檻為 80%", () => {
    expect(DEFAULT_ALERT_THRESHOLD_PCT).toBe(80);
  });
});

describe("resolvePlanTier — 訂閱 planId 正規化", () => {
  it("明確層級原樣對應", () => {
    expect(resolvePlanTier("free")).toBe("free");
    expect(resolvePlanTier("starter")).toBe("starter");
    expect(resolvePlanTier("pro")).toBe("pro");
  });

  it("enterprise / unlimited 皆對應 unlimited", () => {
    expect(resolvePlanTier("enterprise")).toBe("unlimited");
    expect(resolvePlanTier("unlimited")).toBe("unlimited");
  });

  it("大小寫與空白不敏感", () => {
    expect(resolvePlanTier("  PRO ")).toBe("pro");
    expect(resolvePlanTier("Starter")).toBe("starter");
  });

  it("premium / ultra（既有 4K 付費守門詞彙）對應付費層級", () => {
    expect(resolvePlanTier("premium")).toBe("pro");
    expect(resolvePlanTier("ultra")).toBe("unlimited");
  });

  it("null / 空字串 / free 對應 free", () => {
    expect(resolvePlanTier(null)).toBe("free");
    expect(resolvePlanTier(undefined)).toBe("free");
    expect(resolvePlanTier("")).toBe("free");
    expect(resolvePlanTier("free")).toBe("free");
  });

  it("未知且非 free 的 planId（如 stripe price id）有意識映射到最低付費層級 starter", () => {
    expect(resolvePlanTier("price_1QxyzStripeId")).toBe("starter");
  });
});

describe("resolveSubscriptionTier — 訂閱列（planId + status）解析（鏡像 isPaidPlan 語意）", () => {
  it("查不到訂閱 → free（fail-closed）", () => {
    expect(resolveSubscriptionTier(null)).toBe("free");
    expect(resolveSubscriptionTier(undefined)).toBe("free");
  });

  it("cancelled 的 pro → free（不顯示已取消方案的配額）", () => {
    expect(resolveSubscriptionTier({ planId: "pro", status: "cancelled" })).toBe("free");
  });

  it("past_due / null status → free", () => {
    expect(resolveSubscriptionTier({ planId: "premium", status: "past_due" })).toBe("free");
    expect(resolveSubscriptionTier({ planId: "pro", status: null })).toBe("free");
  });

  it("active / trialing 依 planId 對應層級", () => {
    expect(resolveSubscriptionTier({ planId: "pro", status: "active" })).toBe("pro");
    expect(resolveSubscriptionTier({ planId: "premium", status: "active" })).toBe("pro");
    expect(resolveSubscriptionTier({ planId: "ultra", status: "trialing" })).toBe("unlimited");
    expect(resolveSubscriptionTier({ planId: "starter", status: "trialing" })).toBe("starter");
  });

  it("active 的未知付費 planId → starter（最低付費層級，不誤報配額用盡）", () => {
    expect(resolveSubscriptionTier({ planId: "price_1QxyzStripeId", status: "active" })).toBe(
      "starter"
    );
  });
});

describe("月份邊界工具（UTC）", () => {
  it("startOfMonthUtc 取當月 1 號 00:00 UTC", () => {
    const d = startOfMonthUtc(new Date("2026-07-02T13:45:00Z"));
    expect(d.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("firstDayOfNextMonthUtc 跨年正確進位", () => {
    const d = firstDayOfNextMonthUtc(new Date("2026-12-15T10:00:00Z"));
    expect(d.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("computeQuotaStatus — 當月配額狀態", () => {
  const now = new Date("2026-07-02T00:00:00Z");

  it("free 方案用 2/5 → 40%、剩 3、未觸發預警", () => {
    const s = computeQuotaStatus({ tier: "free", videosGenerated: 2, costUsdSoFar: 0, now });
    expect(s.quotaLimit).toBe(5);
    expect(s.quotaUsedPct).toBe(40);
    expect(s.remaining).toBe(3);
    expect(s.quotaExceeded).toBe(false);
    expect(s.alertActive).toBe(false);
    expect(s.isUnlimited).toBe(false);
    // 剩 3 部 × $0.15 = $0.45
    expect(s.costEstimateRemaining).toBe(0.45);
    expect(s.quotaResetsAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("達 80% 門檻觸發 alertActive（free 4/5 = 80%）", () => {
    const s = computeQuotaStatus({ tier: "free", videosGenerated: 4, costUsdSoFar: 0, now });
    expect(s.quotaUsedPct).toBe(80);
    expect(s.alertActive).toBe(true);
    expect(s.quotaExceeded).toBe(false);
  });

  it("用滿即 quotaExceeded，百分比封頂 100、剩餘不為負", () => {
    const s = computeQuotaStatus({ tier: "free", videosGenerated: 7, costUsdSoFar: 0, now });
    expect(s.quotaExceeded).toBe(true);
    expect(s.quotaUsedPct).toBe(100);
    expect(s.remaining).toBe(0);
    expect(s.costEstimateRemaining).toBe(0);
  });

  it("unlimited：百分比 0、不預警、不超限、剩餘為 Infinity", () => {
    const s = computeQuotaStatus({
      tier: "unlimited",
      videosGenerated: 500,
      costUsdSoFar: 12.5,
      now,
    });
    expect(s.isUnlimited).toBe(true);
    expect(s.quotaUsedPct).toBe(0);
    expect(s.alertActive).toBe(false);
    expect(s.quotaExceeded).toBe(false);
    expect(s.remaining).toBe(Infinity);
    expect(s.costEstimateRemaining).toBe(0);
    expect(s.costUsdSoFar).toBe(12.5);
  });

  it("自訂預警門檻可覆寫預設", () => {
    const s = computeQuotaStatus({
      tier: "pro",
      videosGenerated: 60,
      costUsdSoFar: 0,
      now,
      alertThresholdPct: 50,
    });
    expect(s.quotaUsedPct).toBe(60);
    expect(s.alertThresholdPct).toBe(50);
    expect(s.alertActive).toBe(true);
  });

  it("負數與小數輸入被夾正（videosGenerated floor、非負；cost 非負）", () => {
    const s = computeQuotaStatus({ tier: "free", videosGenerated: -3, costUsdSoFar: -5, now });
    expect(s.videosGenerated).toBe(0);
    expect(s.quotaUsedPct).toBe(0);
    expect(s.costUsdSoFar).toBe(0);
  });
});

describe("estimateGenerationCost — 預生成估算（透明化，非扣款）", () => {
  it("固定回 1 點 / $0.15，與常數一致", () => {
    const e = estimateGenerationCost({ aspectRatio: "9:16" });
    expect(e.credits).toBe(CREDITS_PER_VIDEO);
    expect(e.credits).toBe(1);
    expect(e.costUsdEstimate).toBe(ESTIMATED_USD_PER_VIDEO);
    expect(e.costUsdEstimate).toBe(0.15);
  });

  it("無參數亦可呼叫", () => {
    expect(estimateGenerationCost()).toEqual({ credits: 1, costUsdEstimate: 0.15 });
  });
});

describe("projectQuotaAfter — 生成後配額投影", () => {
  it("free 已用 4、再生成 1 → 剩 0、未超限（正好用滿）", () => {
    const r = projectQuotaAfter({ tier: "free", videosGenerated: 4, credits: 1 });
    expect(r.remaining).toBe(0);
    expect(r.willExceed).toBe(false);
  });

  it("free 已用 5、再生成 1 → willExceed", () => {
    const r = projectQuotaAfter({ tier: "free", videosGenerated: 5, credits: 1 });
    expect(r.remaining).toBe(0);
    expect(r.willExceed).toBe(true);
  });

  it("free 已用 2、再生成 1 → 剩 2、未超限", () => {
    const r = projectQuotaAfter({ tier: "free", videosGenerated: 2, credits: 1 });
    expect(r.remaining).toBe(2);
    expect(r.willExceed).toBe(false);
  });

  it("unlimited 永不超限、剩餘為 Infinity", () => {
    const r = projectQuotaAfter({ tier: "unlimited", videosGenerated: 9999, credits: 1 });
    expect(r.remaining).toBe(Infinity);
    expect(r.willExceed).toBe(false);
  });
});
