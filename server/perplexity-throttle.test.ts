/**
 * perplexity-throttle.test.ts
 *
 * 驗證 server/services/perplexityThrottle.ts 的開關 / 節流邏輯：
 *   - 主 / 子 feature flag 各自能獨立關閉
 *   - per-user per-hour / per-day 上限正確生效
 *   - 全站 per-minute 上限正確生效
 *   - getStatus 報告與實際 counter 一致
 *   - reason 翻譯能對應到所有可能的拒絕原因
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAndConsumePerplexity,
  checkPerplexityThrottle,
  describeThrottleReason,
  getPerplexityThrottleStatus,
  recordPerplexityCall,
  resetPerplexityThrottleForTest,
  type PerplexityFeature,
  type ThrottleDenyReason,
} from "./services/perplexityThrottle";

const ALL_FEATURES: PerplexityFeature[] = [
  "director_research",
  "inspiration",
  "web_search",
  "news_fallback",
  "learn_fallback",
];

const ENV_KEYS_TO_RESET = [
  "ENABLE_PERPLEXITY",
  "ENABLE_PERPLEXITY_DIRECTOR_RESEARCH",
  "ENABLE_PERPLEXITY_INSPIRATION",
  "ENABLE_PERPLEXITY_WEB_SEARCH",
  "ENABLE_PERPLEXITY_NEWS_FALLBACK",
  "ENABLE_PERPLEXITY_LEARN_FALLBACK",
  "PERPLEXITY_PER_USER_PER_HOUR",
  "PERPLEXITY_PER_USER_PER_DAY",
  "PERPLEXITY_GLOBAL_PER_MINUTE",
] as const;

beforeEach(() => {
  resetPerplexityThrottleForTest();
  for (const key of ENV_KEYS_TO_RESET) {
    delete process.env[key];
  }
});

afterEach(() => {
  resetPerplexityThrottleForTest();
  for (const key of ENV_KEYS_TO_RESET) {
    delete process.env[key];
  }
});

describe("Perplexity Throttle — 主開關", () => {
  it("ENABLE_PERPLEXITY=false 時所有 feature 一律拒絕", () => {
    process.env.ENABLE_PERPLEXITY = "false";
    for (const feature of ALL_FEATURES) {
      const result = checkPerplexityThrottle({ feature, userId: 1 });
      expect(result.allowed, `feature ${feature} 應被主開關擋下`).toBe(false);
      expect(result.reason).toBe("feature_disabled");
    }
  });

  it("ENABLE_PERPLEXITY 預設為 true（沒設環境變數時）", () => {
    const result = checkPerplexityThrottle({
      feature: "inspiration",
      userId: 1,
    });
    expect(result.allowed).toBe(true);
  });

  it("'off' / '0' / 'no' / 'disabled' 都視為關閉", () => {
    for (const offValue of ["off", "0", "no", "disabled", "FALSE"]) {
      process.env.ENABLE_PERPLEXITY = offValue;
      const result = checkPerplexityThrottle({
        feature: "inspiration",
        userId: 1,
      });
      expect(result.allowed, `value="${offValue}" 應被視為關閉`).toBe(false);
    }
  });
});

describe("Perplexity Throttle — 子開關", () => {
  it("子開關可以獨立關閉而不影響其他 feature", () => {
    process.env.ENABLE_PERPLEXITY_INSPIRATION = "false";
    expect(
      checkPerplexityThrottle({ feature: "inspiration", userId: 1 }).allowed
    ).toBe(false);
    expect(
      checkPerplexityThrottle({ feature: "director_research", userId: 1 })
        .allowed
    ).toBe(true);
    expect(
      checkPerplexityThrottle({ feature: "news_fallback", userId: null })
        .allowed
    ).toBe(true);
  });

  it("主開關關閉時，子開關開著也沒用", () => {
    process.env.ENABLE_PERPLEXITY = "false";
    process.env.ENABLE_PERPLEXITY_INSPIRATION = "true";
    const result = checkPerplexityThrottle({
      feature: "inspiration",
      userId: 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("feature_disabled");
  });
});

describe("Perplexity Throttle — Per-user per-hour", () => {
  it("超過 PERPLEXITY_PER_USER_PER_HOUR 時拒絕並回 retryAfterSec", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "3";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "100";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0"; // 不限制全站

    // 第 1-3 次允許
    for (let i = 0; i < 3; i++) {
      const r = checkAndConsumePerplexity({
        feature: "inspiration",
        userId: 42,
      });
      expect(r.allowed, `第 ${i + 1} 次應允許`).toBe(true);
    }
    // 第 4 次擋
    const fourth = checkPerplexityThrottle({
      feature: "inspiration",
      userId: 42,
    });
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe("user_hour_limit");
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it("不同 user 的配額互相獨立", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "2";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";

    expect(
      checkAndConsumePerplexity({ feature: "inspiration", userId: 1 }).allowed
    ).toBe(true);
    expect(
      checkAndConsumePerplexity({ feature: "inspiration", userId: 1 }).allowed
    ).toBe(true);
    // user 1 額度用完
    expect(
      checkPerplexityThrottle({ feature: "inspiration", userId: 1 }).allowed
    ).toBe(false);
    // user 2 仍可用
    expect(
      checkAndConsumePerplexity({ feature: "inspiration", userId: 2 }).allowed
    ).toBe(true);
    expect(
      checkAndConsumePerplexity({ feature: "inspiration", userId: 2 }).allowed
    ).toBe(true);
    expect(
      checkPerplexityThrottle({ feature: "inspiration", userId: 2 }).allowed
    ).toBe(false);
  });

  it("PERPLEXITY_PER_USER_PER_HOUR=0 表示不限制", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "0";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "0";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";
    for (let i = 0; i < 50; i++) {
      const r = checkAndConsumePerplexity({
        feature: "inspiration",
        userId: 1,
      });
      expect(r.allowed, `第 ${i + 1} 次應允許（不限制）`).toBe(true);
    }
  });
});

describe("Perplexity Throttle — Per-user per-day", () => {
  it("超過 day limit 時即使 hour limit 還有都會被擋", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "1000";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "5";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";

    for (let i = 0; i < 5; i++) {
      checkAndConsumePerplexity({ feature: "inspiration", userId: 7 });
    }
    const next = checkPerplexityThrottle({
      feature: "inspiration",
      userId: 7,
    });
    expect(next.allowed).toBe(false);
    expect(next.reason).toBe("user_day_limit");
  });
});

describe("Perplexity Throttle — Global per-minute", () => {
  it("全站每分鐘上限會擋住所有 user", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "1000";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "1000";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "5";

    for (let i = 0; i < 5; i++) {
      checkAndConsumePerplexity({
        feature: "inspiration",
        userId: i + 1, // 5 個不同 user
      });
    }
    // 第 6 個 user 還是被擋（全站爆）
    const blocked = checkPerplexityThrottle({
      feature: "inspiration",
      userId: 999,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("global_minute_limit");
  });

  it("Cron / 系統呼叫（userId=null）只受全站節流，不算 per-user 配額", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "1";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "5";

    for (let i = 0; i < 5; i++) {
      const r = checkAndConsumePerplexity({
        feature: "news_fallback",
        userId: null,
      });
      expect(r.allowed, `第 ${i + 1} 次系統呼叫應允許`).toBe(true);
    }
    // 第 6 次撞到全站節流
    const sixth = checkPerplexityThrottle({
      feature: "news_fallback",
      userId: null,
    });
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe("global_minute_limit");
  });
});

describe("Perplexity Throttle — checkPerplexityThrottle vs checkAndConsumePerplexity", () => {
  it("checkPerplexityThrottle 不會修改 counter", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "2";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";

    // 只 check 不 consume：100 次都應該允許
    for (let i = 0; i < 100; i++) {
      const r = checkPerplexityThrottle({
        feature: "inspiration",
        userId: 1,
      });
      expect(r.allowed, `check 第 ${i + 1} 次不應消耗配額`).toBe(true);
    }
  });

  it("recordPerplexityCall 在 feature 關閉時不會累計", () => {
    process.env.ENABLE_PERPLEXITY_INSPIRATION = "false";
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "2";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";

    // 即使硬呼叫 record，feature 關閉時不會吃配額
    for (let i = 0; i < 10; i++) {
      recordPerplexityCall({ feature: "inspiration", userId: 1 });
    }
    // 切換到別的 feature 應該還有完整配額
    expect(
      checkAndConsumePerplexity({ feature: "director_research", userId: 1 })
        .allowed
    ).toBe(true);
  });
});

describe("Perplexity Throttle — getPerplexityThrottleStatus", () => {
  it("回傳 features map 反映實際開關狀態", () => {
    process.env.ENABLE_PERPLEXITY_NEWS_FALLBACK = "false";
    process.env.ENABLE_PERPLEXITY_LEARN_FALLBACK = "off";
    const status = getPerplexityThrottleStatus(1);
    expect(status.features.news_fallback).toBe(false);
    expect(status.features.learn_fallback).toBe(false);
    expect(status.features.inspiration).toBe(true);
    expect(status.features.director_research).toBe(true);
    expect(status.features.web_search).toBe(true);
  });

  it("user.remainingHour / remainingDay 反映即時用量", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "10";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "100";
    process.env.PERPLEXITY_GLOBAL_PER_MINUTE = "0";

    for (let i = 0; i < 3; i++) {
      checkAndConsumePerplexity({ feature: "inspiration", userId: 99 });
    }
    const status = getPerplexityThrottleStatus(99);
    expect(status.user).not.toBeNull();
    expect(status.user!.usedLastHour).toBe(3);
    expect(status.user!.usedLastDay).toBe(3);
    expect(status.user!.remainingHour).toBe(7);
    expect(status.user!.remainingDay).toBe(97);
  });

  it("userId=null 時 user 欄位為 null（只回全站狀態）", () => {
    const status = getPerplexityThrottleStatus(null);
    expect(status.user).toBeNull();
    expect(typeof status.globalUsedLastMinute).toBe("number");
  });

  it("limits=0 時回 Infinity（不限制）", () => {
    process.env.PERPLEXITY_PER_USER_PER_HOUR = "0";
    process.env.PERPLEXITY_PER_USER_PER_DAY = "0";
    const status = getPerplexityThrottleStatus(1);
    expect(status.user!.remainingHour).toBe(Number.POSITIVE_INFINITY);
    expect(status.user!.remainingDay).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("Perplexity Throttle — describeThrottleReason", () => {
  it("所有可能的 reason 都有對應的繁中訊息", () => {
    const reasons: ThrottleDenyReason[] = [
      "feature_disabled",
      "user_hour_limit",
      "user_day_limit",
      "global_minute_limit",
      "no_api_key",
    ];
    for (const reason of reasons) {
      const msg = describeThrottleReason(reason);
      expect(msg, `reason=${reason} 應有訊息`).toBeTruthy();
      expect(msg.length).toBeGreaterThan(2);
    }
  });
});
