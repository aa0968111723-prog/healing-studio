/**
 * tests/unit/server/communityManagerTools.test.ts
 *
 * Unit tests for the community-manager (群群) spirit tools. These verify
 * the post-plan generator, clarification engine, hashtag recommendations,
 * weekly schedule, hook critique and caption formatting all behave per
 * the role's system prompt slice (`shared/orb-agent-roles.ts:1368`).
 *
 * The tools are pure functions — no LLM, no DB, no fal.ai — so the tests
 * can run synchronously and deterministically.
 */
import { describe, expect, it } from "vitest";
import {
  buildPostPlan,
  nextClarificationQuestion,
  recommendHashtags,
  planWeeklySchedule,
  critiqueHook,
  formatCaption,
  listSupportedPlatforms,
  type SocialPlatform,
} from "../../../server/services/spiritTools/communityManagerTools";

describe("buildPostPlan", () => {
  it("returns the full four-stage post formula for Instagram Reels", () => {
    const result = buildPostPlan({
      platform: "instagram",
      audienceAge: "25-34",
      theme: "減脂飲食",
      assetType: "short-video",
      goal: "engagement",
    });
    expect(result.success).toBe(true);
    expect(result.platform).toBe("instagram");
    expect(result.structure.hook).toMatch(/減脂飲食/);
    expect(result.structure.conflict.length).toBeGreaterThan(0);
    expect(result.structure.reveal.length).toBeGreaterThan(0);
    expect(result.structure.cta).toMatch(/留言|私訊/);
    expect(result.spec.aspectRatio).toBe("9:16");
    expect(result.spec.lengthSeconds).toBeDefined();
    expect(result.hashtags.length).toBeGreaterThan(0);
    expect(result.recommendedTimes.length).toBeGreaterThan(0);
    expect(result.weeklyCadence).toBeGreaterThan(0);
  });

  it("returns lengthSeconds for short-video and long-video only", () => {
    const imagePost = buildPostPlan({
      platform: "instagram",
      audienceAge: "25-34",
      theme: "開箱",
      assetType: "image-post",
    });
    expect(imagePost.spec.lengthSeconds).toBeUndefined();

    const textOnly = buildPostPlan({
      platform: "linkedin",
      audienceAge: "35-44",
      theme: "轉職心得",
      assetType: "text-only",
    });
    expect(textOnly.spec.lengthSeconds).toBeUndefined();

    const shortVid = buildPostPlan({
      platform: "tiktok",
      audienceAge: "18-24",
      theme: "搞笑",
      assetType: "short-video",
    });
    expect(shortVid.spec.lengthSeconds).toEqual({ min: 7, max: 21 });
  });

  it("warns when audience age does not match the platform's primary audience", () => {
    const mismatch = buildPostPlan({
      platform: "linkedin",
      audienceAge: "13-17",
      theme: "新工具",
      assetType: "text-only",
    });
    expect(mismatch.spec.notes).toMatch(/主要受眾/);
    expect(mismatch.spec.notes).toMatch(/13-17/);
  });

  it("respects platform hashtag budget (TikTok ≤5, IG ≤15)", () => {
    const tiktok = buildPostPlan({
      platform: "tiktok",
      audienceAge: "18-24",
      theme: "舞蹈",
      assetType: "short-video",
    });
    expect(tiktok.hashtags.length).toBeLessThanOrEqual(5);

    const ig = buildPostPlan({
      platform: "instagram",
      audienceAge: "25-34",
      theme: "穿搭",
      assetType: "image-post",
    });
    expect(ig.hashtags.length).toBeLessThanOrEqual(15);
  });

  it("varies CTA wording by goal", () => {
    const reach = buildPostPlan({
      platform: "instagram", audienceAge: "25-34", theme: "X", assetType: "image-post", goal: "reach",
    });
    const conversion = buildPostPlan({
      platform: "instagram", audienceAge: "25-34", theme: "X", assetType: "image-post", goal: "conversion",
    });
    const branding = buildPostPlan({
      platform: "instagram", audienceAge: "25-34", theme: "X", assetType: "image-post", goal: "branding",
    });
    expect(reach.structure.cta).not.toBe(conversion.structure.cta);
    expect(branding.structure.cta).toMatch(/追蹤/);
    expect(conversion.structure.cta).toMatch(/bio|連結/);
  });
});

describe("nextClarificationQuestion", () => {
  it("asks for platform first when partial is empty", () => {
    const q = nextClarificationQuestion({});
    expect(q).not.toBeNull();
    expect(q!.field).toBe("platform");
    expect(q!.options.length).toBeGreaterThanOrEqual(6);
  });

  it("asks for audienceAge once platform is known", () => {
    const q = nextClarificationQuestion({ platform: "tiktok" });
    expect(q!.field).toBe("audienceAge");
  });

  it("asks for theme once platform + age are known", () => {
    const q = nextClarificationQuestion({ platform: "tiktok", audienceAge: "18-24" });
    expect(q!.field).toBe("theme");
  });

  it("asks for assetType then goal then returns null", () => {
    const base = { platform: "tiktok" as const, audienceAge: "18-24" as const, theme: "搞笑" };
    expect(nextClarificationQuestion(base)!.field).toBe("assetType");
    expect(nextClarificationQuestion({ ...base, assetType: "short-video" as const })!.field).toBe("goal");
    expect(
      nextClarificationQuestion({ ...base, assetType: "short-video" as const, goal: "reach" as const }),
    ).toBeNull();
  });
});

describe("recommendHashtags", () => {
  it("returns hashtags with platform-specific budget note", () => {
    const result = recommendHashtags({ platform: "xiaohongshu", theme: "保養" });
    expect(result.success).toBe(true);
    expect(result.hashtags.length).toBeGreaterThan(0);
    expect(result.budgetNote).toMatch(/小紅書/);
    expect(result.budgetNote).toMatch(/演算法訊號/);
  });

  it("respects maxCount override", () => {
    const result = recommendHashtags({ platform: "instagram", theme: "穿搭", maxCount: 3 });
    expect(result.hashtags.length).toBeLessThanOrEqual(3);
  });

  it("returns 0-3 hashtags for Facebook (low-tag platform)", () => {
    const result = recommendHashtags({ platform: "facebook", theme: "新店開幕" });
    expect(result.hashtags.length).toBeLessThanOrEqual(3);
  });
});

describe("planWeeklySchedule", () => {
  it("generates slots for each platform per its cadence", () => {
    const result = planWeeklySchedule({
      platforms: ["instagram", "tiktok"],
      startDate: "2026-05-15",
    });
    expect(result.success).toBe(true);
    expect(result.startDate).toBe("2026-05-15");
    expect(result.perPlatformCounts.instagram).toBe(4);   // IG weeklyCadence=4
    expect(result.perPlatformCounts.tiktok).toBe(5);      // TikTok weeklyCadence=5
    expect(result.slots.length).toBe(9);
  });

  it("sorts slots by day of week", () => {
    const result = planWeeklySchedule({ platforms: ["instagram", "youtube"] });
    const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (let i = 1; i < result.slots.length; i += 1) {
      expect(dayOrder.indexOf(result.slots[i]!.dayOfWeek)).toBeGreaterThanOrEqual(
        dayOrder.indexOf(result.slots[i - 1]!.dayOfWeek),
      );
    }
  });

  it("defaults startDate to today when not given", () => {
    const result = planWeeklySchedule({ platforms: ["linkedin"] });
    expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("critiqueHook", () => {
  it("scores a weak hook low and gives a rewrite", () => {
    const result = critiqueHook({ hook: "今天好棒", platform: "tiktok" });
    expect(result.success).toBe(true);
    expect(result.scores.attention).toBeLessThan(60);
    expect(result.suggestedRewrite.length).toBeGreaterThan(0);
    expect(result.verdict.length).toBeGreaterThan(0);
  });

  it("scores a strong, specific hook with CTA higher than a weak one", () => {
    const strong = critiqueHook({
      hook: "3 天瘦 2 公斤？你以為的減脂方法其實在害你 — 留言 +1 我私訊你完整版",
      platform: "tiktok",
    });
    const weak = critiqueHook({ hook: "今天好棒", platform: "tiktok" });
    const strongAvg = (strong.scores.attention + strong.scores.specificity + strong.scores.cta + strong.scores.platformFit) / 4;
    const weakAvg = (weak.scores.attention + weak.scores.specificity + weak.scores.cta + weak.scores.platformFit) / 4;
    expect(strongAvg).toBeGreaterThan(weakAvg);
  });

  it("penalises TikTok hook that is too long", () => {
    const longHook = "今天我要跟大家分享一個很久以前我就想跟你們講但一直沒有時間講的關於我的人生故事和我學到的很多事情";
    const result = critiqueHook({ hook: longHook, platform: "tiktok" });
    expect(result.scores.platformFit).toBeLessThan(50);
  });

  it("rewards xiaohongshu hooks that use emoji + bracket title style", () => {
    const goodXhs = critiqueHook({ hook: "【新手必看】3 步驟搞定 ✨", platform: "xiaohongshu" });
    const plainXhs = critiqueHook({ hook: "新手必看三步驟搞定", platform: "xiaohongshu" });
    expect(goodXhs.scores.platformFit).toBeGreaterThanOrEqual(plainXhs.scores.platformFit);
  });
});

describe("formatCaption", () => {
  it("formats IG with paragraph breaks and hashtags at tail", () => {
    const result = formatCaption({
      rawText: "第一句話。第二句話。第三句話。",
      platform: "instagram",
      hashtags: ["#test", "#example"],
    });
    expect(result.success).toBe(true);
    expect(result.formatted).toMatch(/\n\n/);
    expect(result.formatted).toMatch(/#test/);
    // IG separator dots between content and hashtag block
    expect(result.formatted).toMatch(/\.\n\./);
  });

  it("formats TikTok as single-line with inline hashtags", () => {
    const result = formatCaption({
      rawText: "短句一。\n短句二。",
      platform: "tiktok",
      hashtags: ["#fyp", "#test"],
    });
    // TikTok must not contain a paragraph break (single-line style).
    expect(result.formatted).not.toMatch(/\n\n/);
    expect(result.formatted).toMatch(/#fyp/);
  });

  it("formats 小紅書 as bullet-style with emoji prefixes", () => {
    const result = formatCaption({
      rawText: "重點一。重點二。重點三。",
      platform: "xiaohongshu",
    });
    // Each line should start with an emoji bullet.
    const lines = result.formatted.split("\n").filter(l => l.trim());
    for (const line of lines) {
      expect(line).toMatch(/^[✨💡📝🔥🌟]/);
    }
  });

  it("warns when content exceeds platform caption limit", () => {
    const huge = "啦".repeat(1200);
    const result = formatCaption({ rawText: huge, platform: "xiaohongshu" });
    expect(result.notes.some(n => /上限/.test(n))).toBe(true);
  });
});

describe("listSupportedPlatforms", () => {
  it("returns all 6 supported platforms with metadata", () => {
    const platforms = listSupportedPlatforms();
    expect(platforms.length).toBe(6);
    const ids = platforms.map(p => p.id).sort();
    expect(ids).toEqual(["facebook", "instagram", "linkedin", "tiktok", "xiaohongshu", "youtube"]);
    for (const p of platforms) {
      expect(p.displayName.length).toBeGreaterThan(0);
      expect(p.primaryAges.length).toBeGreaterThan(0);
      expect(p.weeklyCadence).toBeGreaterThan(0);
      expect(p.bestTimes.length).toBeGreaterThan(0);
    }
  });

  it("includes Taiwan-timezone best times for each platform", () => {
    const platforms = listSupportedPlatforms();
    for (const p of platforms) {
      for (const t of p.bestTimes) {
        // Best-times strings should contain a time range like "18:00-21:00"
        expect(t).toMatch(/\d{1,2}:\d{2}/);
      }
    }
  });
});

describe("cross-tool consistency", () => {
  it("recommendHashtags result is a subset of buildPostPlan hashtags for same input", () => {
    const platforms: SocialPlatform[] = ["instagram", "tiktok", "youtube", "xiaohongshu", "facebook", "linkedin"];
    for (const platform of platforms) {
      const plan = buildPostPlan({
        platform,
        audienceAge: "25-34",
        theme: "美食",
        assetType: platform === "youtube" ? "long-video" : "short-video",
      });
      const recommend = recommendHashtags({ platform, theme: "美食" });
      // recommendHashtags should pull from the same pool, in same order
      for (let i = 0; i < Math.min(recommend.hashtags.length, plan.hashtags.length); i += 1) {
        expect(plan.hashtags).toContain(recommend.hashtags[i]);
      }
    }
  });
});
