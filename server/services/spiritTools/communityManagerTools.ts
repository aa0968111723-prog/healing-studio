/**
 * server/services/spiritTools/communityManagerTools.ts
 *
 * Tools for the community-manager (群群) spirit — 專做社群平台經營：
 * IG / TikTok / 小紅書 / YouTube / Facebook / LinkedIn 各年齡層風格、
 * 貼文公式、hashtag 策略、最佳發文時段、跨平台週節奏。對應
 * `shared/orb-agent-roles.ts:1368-1377` 的角色定位。
 *
 * 設計：純函式 — 不打 LLM、不打 DB、不打 fal.ai。把使用者粗略需求
 * (平台 / 受眾年齡 / 主題 / 素材) 轉成可直接照抄的貼文結構、hashtag
 * 組合與排程建議。實際的圖 / 影 / 文生成仍由 image / video / composer
 * specialist 接手；群群只負責「組對貼文 + 配 hashtag + 排程節奏」。
 *
 * 此檔之前是 templated 占位實作（submitFeedback / announcements /
 * engagement tips），跟 IG/TikTok 經營角色完全無關且 header 誤標為
 * 「社社」。整檔重寫對齊 system prompt slice 的設計意圖。
 */

import { logger } from "../../_core/logger";

export type SocialPlatform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "xiaohongshu"
  | "facebook"
  | "linkedin";

export type AudienceAge =
  | "13-17"
  | "18-24"
  | "25-34"
  | "35-44"
  | "45+";

export type PostGoal =
  | "reach"        // 漲粉 / 觸及
  | "engagement"   // 留言 / 收藏 / 分享
  | "conversion"   // 導購 / 點擊 / 留資
  | "branding";    // 形象 / 品牌敘事

export type AssetType =
  | "short-video"  // Reels / Shorts / TikTok
  | "image-post"   // 單張圖
  | "carousel"     // 多圖輪播 / 圖文
  | "long-video"   // YT 長片
  | "text-only";   // FB / LinkedIn 純文

// ─── 平台知識常數 ──────────────────────────────────────────────────────

interface PlatformProfile {
  /** 顯示用名稱 */
  displayName: string;
  /** 該平台主流受眾年齡層 */
  primaryAges: ReadonlyArray<AudienceAge>;
  /** 推薦短影音長度（秒） */
  shortVideoSeconds: { min: number; max: number };
  /** 推薦長影音長度（秒），無長片則為 null */
  longVideoSeconds: { min: number; max: number } | null;
  /** 推薦比例：vertical (9:16) / square (1:1) / horizontal (16:9) / mixed */
  aspectRatio: "9:16" | "1:1" | "16:9" | "mixed";
  /** 該平台 hashtag 上限（>0 才會輸出 hashtag block） */
  hashtagBudget: { min: number; max: number };
  /** 台灣 timezone 最佳發文時段 */
  bestTimes: ReadonlyArray<string>;
  /** 推薦週發頻率 */
  weeklyCadence: number;
  /** 平台 hook 風格 */
  hookStyle: string;
  /** 平台演算法主要訊號 */
  algorithmSignal: string;
}

const PLATFORM_PROFILES: Record<SocialPlatform, PlatformProfile> = {
  instagram: {
    displayName: "Instagram",
    primaryAges: ["18-24", "25-34"],
    shortVideoSeconds: { min: 7, max: 30 },
    longVideoSeconds: { min: 30, max: 90 },
    aspectRatio: "9:16",
    hashtagBudget: { min: 5, max: 15 },
    bestTimes: ["平日 19:00-21:00", "週末 11:00-13:00"],
    weeklyCadence: 4,
    hookStyle: "視覺強反差 + 1 句問句鉤子",
    algorithmSignal: "完播率 + 儲存率 > 點讚數",
  },
  tiktok: {
    displayName: "TikTok",
    primaryAges: ["13-17", "18-24"],
    shortVideoSeconds: { min: 7, max: 21 },
    longVideoSeconds: { min: 30, max: 60 },
    aspectRatio: "9:16",
    hashtagBudget: { min: 3, max: 5 },
    bestTimes: ["週一 / 週三 18:00-22:00", "週五 19:00-23:00"],
    weeklyCadence: 5,
    hookStyle: "前 1.5 秒衝擊 + 字幕同步",
    algorithmSignal: "完播率 + 重播率 + 評論",
  },
  youtube: {
    displayName: "YouTube",
    primaryAges: ["25-34", "35-44"],
    shortVideoSeconds: { min: 30, max: 60 },
    longVideoSeconds: { min: 480, max: 720 },
    aspectRatio: "mixed",
    hashtagBudget: { min: 3, max: 8 },
    bestTimes: ["週四 / 週日 20:00-22:00"],
    weeklyCadence: 2,
    hookStyle: "標題 + 縮圖決勝；前 8 秒講結論",
    algorithmSignal: "點擊率 (CTR) + 平均觀看時長",
  },
  xiaohongshu: {
    displayName: "小紅書",
    primaryAges: ["18-24", "25-34"],
    shortVideoSeconds: { min: 15, max: 45 },
    longVideoSeconds: null,
    aspectRatio: "1:1",
    hashtagBudget: { min: 6, max: 10 },
    bestTimes: ["午休 12:00-13:00", "晚間 21:00-23:00"],
    weeklyCadence: 4,
    hookStyle: "標題式 emoji + 條列乾貨",
    algorithmSignal: "收藏率 + 評論率 > 點讚",
  },
  facebook: {
    displayName: "Facebook",
    primaryAges: ["35-44", "45+"],
    shortVideoSeconds: { min: 30, max: 90 },
    longVideoSeconds: { min: 120, max: 600 },
    aspectRatio: "1:1",
    hashtagBudget: { min: 0, max: 3 },
    bestTimes: ["平日 18:00-21:00", "週日 10:00-12:00"],
    weeklyCadence: 3,
    hookStyle: "完整故事 + 情緒共鳴開場",
    algorithmSignal: "分享率 + 留言深度",
  },
  linkedin: {
    displayName: "LinkedIn",
    primaryAges: ["25-34", "35-44", "45+"],
    shortVideoSeconds: { min: 30, max: 90 },
    longVideoSeconds: { min: 120, max: 300 },
    aspectRatio: "1:1",
    hashtagBudget: { min: 3, max: 5 },
    bestTimes: ["平日 09:00-11:00", "平日 17:00-18:00"],
    weeklyCadence: 2,
    hookStyle: "產業洞察 + 個人敘事開場",
    algorithmSignal: "留言深度 + 重貼分享",
  },
};

// ─── buildPostPlan：把粗略需求展成完整貼文計畫 ────────────────────────

export interface PostPlanInput {
  platform: SocialPlatform;
  audienceAge: AudienceAge;
  theme: string;          // e.g. "減脂飲食"、"職場心得"、"開箱新品"
  assetType: AssetType;
  /** 主要目標：漲粉 / 互動 / 轉換 / 品牌 */
  goal?: PostGoal;
  /** 使用者已寫的內容素材（可選），用於提示「請改寫成 X 平台格式」 */
  rawDraft?: string;
}

export interface PostPlanResult {
  success: true;
  platform: SocialPlatform;
  displayName: string;
  /** 整支貼文公式：hook → conflict → reveal → CTA */
  structure: {
    hook: string;
    conflict: string;
    reveal: string;
    cta: string;
  };
  /** 建議影音 / 圖片規格 */
  spec: {
    aspectRatio: string;
    lengthSeconds?: { min: number; max: number };
    notes: string;
  };
  /** 推薦 hashtag block（已照平台 budget 限制數量） */
  hashtags: string[];
  /** 推薦發文時段（台灣 timezone） */
  recommendedTimes: ReadonlyArray<string>;
  /** 建議週發頻率 */
  weeklyCadence: number;
  /** 該平台演算法訊號提示，給使用者衡量數據用 */
  algorithmSignal: string;
}

/**
 * 內部：依平台 + 主題 + 目標生成貼文公式四段。模板式，不打 LLM，但
 * 字串會嵌入使用者實際給的主題，可直接照抄當 caption / 分鏡草稿。
 */
function buildStructure(
  platform: SocialPlatform,
  theme: string,
  goal: PostGoal,
): PostPlanResult["structure"] {
  const profile = PLATFORM_PROFILES[platform];
  const ctaByGoal: Record<PostGoal, string> = {
    reach: `留言 +1 我私訊你「${theme}」完整版`,
    engagement: `你有遇過${theme}的卡點嗎？留言告訴我`,
    conversion: `點 bio 連結拿${theme}懶人包`,
    branding: `追蹤我，每週分享一個${theme}的真實案例`,
  };
  return {
    hook: `${profile.hookStyle}：用一句「${theme}最常被誤解的一件事」開頭`,
    conflict: `大家都以為${theme}要「努力 / 花錢 / 天分」，但其實搞錯方向`,
    reveal: `真正關鍵是「具體可重複的 3 個步驟」— 用案例帶出每一步`,
    cta: ctaByGoal[goal],
  };
}

/**
 * 內部：依平台 + 主題回傳該平台規格內的 hashtag 組合。
 * 廣 (broad reach) + 中 (theme-specific) + 窄 (niche engagement) 配比。
 */
function buildHashtags(
  platform: SocialPlatform,
  theme: string,
): string[] {
  const profile = PLATFORM_PROFILES[platform];
  const themeSlug = theme.replace(/\s+/g, "").slice(0, 8);
  // 廣：平台主流 tag；中：主題；窄：受眾切入 / 平台慣用標籤
  const candidates: Record<SocialPlatform, string[]> = {
    instagram: [`#${themeSlug}`, `#${themeSlug}日常`, `#reels`, `#台灣`, `#daily`, `#lifestyle`, `#explorepage`, `#instagood`, `#${themeSlug}分享`, `#${themeSlug}教學`],
    tiktok: [`#${themeSlug}`, `#fyp`, `#foryou`, `#台灣tiktok`, `#${themeSlug}挑戰`],
    youtube: [`#${themeSlug}`, `#shorts`, `#${themeSlug}教學`, `#youtuber`, `#vlog`, `#台灣`, `#youtubeshorts`, `#${themeSlug}心得`],
    xiaohongshu: [`#${themeSlug}`, `#${themeSlug}乾貨`, `#${themeSlug}筆記`, `#日常分享`, `#好物分享`, `#${themeSlug}攻略`, `#新手入門`, `#${themeSlug}清單`, `#推薦`, `#${themeSlug}心得`],
    facebook: [`#${themeSlug}`, `#台灣`, `#${themeSlug}社群`],
    linkedin: [`#${themeSlug}`, `#leadership`, `#careertips`, `#${themeSlug}industry`, `#professionalgrowth`],
  };
  const pool = candidates[platform];
  const max = profile.hashtagBudget.max;
  return pool.slice(0, max);
}

/**
 * 把粗略的「我要在 IG 上發減脂飲食的 Reels，受眾 25-34 漲粉」轉成一整份
 * 可直接照抄的貼文計畫（鉤子 + 結構 + hashtag + 發文時段）。
 */
export function buildPostPlan(input: PostPlanInput): PostPlanResult {
  const profile = PLATFORM_PROFILES[input.platform];
  const goal = input.goal ?? "engagement";

  // 依素材類型決定要不要回 lengthSeconds：圖文 / 純文不需要影片長度。
  let lengthSeconds: { min: number; max: number } | undefined;
  if (input.assetType === "short-video") {
    lengthSeconds = profile.shortVideoSeconds;
  } else if (input.assetType === "long-video" && profile.longVideoSeconds) {
    lengthSeconds = profile.longVideoSeconds;
  }

  // 受眾年齡跟平台主受眾不同時提示 — 不阻擋，但告訴使用者要調整語氣。
  const ageMatch = profile.primaryAges.includes(input.audienceAge);
  const specNotes = ageMatch
    ? `${profile.displayName} 對 ${input.audienceAge} 年齡層友善，照預設語氣即可`
    : `${profile.displayName} 主要受眾是 ${profile.primaryAges.join(" / ")}，鎖定 ${input.audienceAge} 需把鉤子改成該年齡層在意的痛點`;

  const result: PostPlanResult = {
    success: true,
    platform: input.platform,
    displayName: profile.displayName,
    structure: buildStructure(input.platform, input.theme, goal),
    spec: {
      aspectRatio: profile.aspectRatio,
      ...(lengthSeconds ? { lengthSeconds } : {}),
      notes: specNotes,
    },
    hashtags: buildHashtags(input.platform, input.theme),
    recommendedTimes: profile.bestTimes,
    weeklyCadence: profile.weeklyCadence,
    algorithmSignal: profile.algorithmSignal,
  };

  logger.debug("community_post_plan_built", {
    platform: input.platform,
    audienceAge: input.audienceAge,
    assetType: input.assetType,
    goal,
  });

  return result;
}

// ─── nextClarification：群群主動問下一個欄位 ─────────────────────────

export interface ClarificationQuestion {
  field: keyof PostPlanInput;
  question: string;
  options: string[];
}

/**
 * 群群 system prompt 要求「先問平台 + 受眾年齡」再給建議。這支函式給
 * partial 欄位，回傳下一個該問的問題與選項。全部填好則回 null（呼叫
 * 端就可以送 buildPostPlan）。
 */
export function nextClarificationQuestion(
  partial: Partial<PostPlanInput>,
): ClarificationQuestion | null {
  if (!partial.platform) {
    return {
      field: "platform",
      question: "想經營哪個平台？",
      options: [
        "Instagram (18-34，Reels / Stories)",
        "TikTok (13-24，短影音演算法)",
        "YouTube (25-44，Shorts 或長片)",
        "小紅書 (18-34 女性為主，圖文 / 教學)",
        "Facebook (35+，故事 + 社團)",
        "LinkedIn (25+，職場 / 產業洞察)",
      ],
    };
  }
  if (!partial.audienceAge) {
    return {
      field: "audienceAge",
      question: "目標受眾年齡層大概？",
      options: ["13-17 (學生)", "18-24 (大學 / 初入社會)", "25-34 (青年職場)", "35-44 (中年家庭)", "45+ (熟齡)"],
    };
  }
  if (!partial.theme) {
    return {
      field: "theme",
      question: "這次的內容主題是什麼？（一句話，例如「減脂飲食」「轉職心得」「開箱新品」）",
      options: [],
    };
  }
  if (!partial.assetType) {
    return {
      field: "assetType",
      question: "預計用哪種素材？",
      options: [
        "短影音 (Reels / Shorts / TikTok)",
        "單張圖 (Instagram Post / 小紅書封面)",
        "多圖輪播 / 圖文 (Carousel)",
        "長影片 (YouTube 主頻)",
        "純文 (Facebook / LinkedIn 故事)",
      ],
    };
  }
  if (!partial.goal) {
    return {
      field: "goal",
      question: "這篇主要目標？",
      options: [
        "漲粉 / 觸及 (reach)",
        "留言互動 (engagement)",
        "導購 / 點擊 (conversion)",
        "品牌敘事 (branding)",
      ],
    };
  }
  return null;
}

// ─── recommendHashtags：獨立查詢 hashtag 組合 ──────────────────────────

export interface RecommendHashtagsInput {
  platform: SocialPlatform;
  theme: string;
  /** 上限可由呼叫端覆寫，預設用平台 budget.max */
  maxCount?: number;
}

export interface RecommendHashtagsResult {
  success: true;
  platform: SocialPlatform;
  /** 該平台 hashtag 數量規範說明 */
  budgetNote: string;
  hashtags: string[];
}

/**
 * 獨立呼叫的 hashtag 推薦工具 — 給使用者已經有貼文、只缺 hashtag 的場景。
 * 回傳混合廣 / 中 / 窄的標籤組合，並附上該平台 hashtag 數量規範說明。
 */
export function recommendHashtags(
  input: RecommendHashtagsInput,
): RecommendHashtagsResult {
  const profile = PLATFORM_PROFILES[input.platform];
  const hashtags = buildHashtags(input.platform, input.theme);
  const limit = Math.min(input.maxCount ?? hashtags.length, hashtags.length);
  const budgetNote = `${profile.displayName} 建議放 ${profile.hashtagBudget.min}-${profile.hashtagBudget.max} 個（演算法訊號：${profile.algorithmSignal}）`;
  return {
    success: true,
    platform: input.platform,
    budgetNote,
    hashtags: hashtags.slice(0, limit),
  };
}

// ─── planWeeklySchedule：跨平台週發節奏 ────────────────────────────────

export interface WeeklyScheduleInput {
  platforms: ReadonlyArray<SocialPlatform>;
  /** 起始日期 ISO 字串（YYYY-MM-DD），預設今天 */
  startDate?: string;
}

export interface ScheduleSlot {
  platform: SocialPlatform;
  dayOfWeek: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  timeSlot: string;
}

export interface WeeklyScheduleResult {
  success: true;
  startDate: string;
  /** 一週內推薦的所有發文時段，已按 day-of-week 排序 */
  slots: ReadonlyArray<ScheduleSlot>;
  /** 每平台的總貼文數 */
  perPlatformCounts: Record<string, number>;
  /** 提示：是否超出建議節奏 */
  warnings: string[];
}

const DAY_ORDER: ReadonlyArray<ScheduleSlot["dayOfWeek"]> = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * 把多個平台的 weeklyCadence 攤成一週 7 天的發文時段表。
 * 演算法：每平台依 cadence 等距挑天，timeSlot 從該平台 bestTimes 輪替。
 * 不爆量 — 一天一平台至多一則，超出 cadence 的會被自動截斷並進 warnings。
 */
export function planWeeklySchedule(
  input: WeeklyScheduleInput,
): WeeklyScheduleResult {
  const startDate = input.startDate ?? new Date().toISOString().slice(0, 10);
  const slots: ScheduleSlot[] = [];
  const perPlatformCounts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const platform of input.platforms) {
    const profile = PLATFORM_PROFILES[platform];
    const cadence = Math.min(profile.weeklyCadence, 7);
    if (profile.weeklyCadence > 7) {
      warnings.push(`${profile.displayName} 建議週發 ${profile.weeklyCadence} 次但一週只有 7 天，已截為 7`);
    }
    // 等距挑天：cadence=3 → Mon / Wed / Fri；cadence=5 → Mon-Fri
    const step = 7 / cadence;
    for (let i = 0; i < cadence; i += 1) {
      const dayIdx = Math.min(Math.floor(i * step), 6);
      const timeSlot = profile.bestTimes[i % profile.bestTimes.length];
      slots.push({
        platform,
        dayOfWeek: DAY_ORDER[dayIdx],
        timeSlot,
      });
    }
    perPlatformCounts[platform] = cadence;
  }

  // 依 day-of-week 排序，方便 UI 直接照星期列出來。
  slots.sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek));

  return {
    success: true,
    startDate,
    slots,
    perPlatformCounts,
    warnings,
  };
}

// ─── critiqueHook：對使用者寫的鉤子打分 + 改寫建議 ────────────────────

export interface CritiqueHookInput {
  hook: string;
  platform: SocialPlatform;
}

export interface CritiqueHookResult {
  success: true;
  scores: {
    /** 注意力鉤子強度（0-100，前 1-3 秒能不能拉人停下） */
    attention: number;
    /** 具體性（0-100，有沒有具體數字 / 對象 vs 空泛形容） */
    specificity: number;
    /** CTA 存在度（0-100，有沒有給觀眾下一步動作） */
    cta: number;
    /** 平台適配度（0-100，語氣 / 長度合不合該平台） */
    platformFit: number;
  };
  /** 整體評語，短句 1-2 句 */
  verdict: string;
  /** 具體可套用的改寫建議 */
  suggestedRewrite: string;
}

const SPECIFICITY_SIGNALS = /\d|%|塊|元|台幣|分鐘|秒|天|週|月|年|歲|步驟|kg|cm|km|公里|公斤|公分/;
const CTA_SIGNALS = /留言|私訊|追蹤|按讚|收藏|分享|點|bio|連結|限時|報名|報名表|下載|拿|領|搶/;
const QUESTION_SIGNALS = /[?？]/;

/**
 * 對使用者寫的鉤子做啟發式評分。純規則 — 不打 LLM，但提供 LLM 風格
 * 的改寫示範，讓使用者直接照抄。
 */
export function critiqueHook(input: CritiqueHookInput): CritiqueHookResult {
  const profile = PLATFORM_PROFILES[input.platform];
  const hook = input.hook.trim();
  const length = hook.length;

  // attention：有問句 / 數字 / 反差詞 加分；過長扣分
  let attention = 40;
  if (QUESTION_SIGNALS.test(hook)) attention += 25;
  if (SPECIFICITY_SIGNALS.test(hook)) attention += 20;
  if (/但是|其實|沒想到|你以為|不是|真相|別再/.test(hook)) attention += 20;
  if (length > 60) attention -= 20;  // 鉤子過長
  if (length < 6) attention -= 30;   // 過短沒內容
  attention = Math.max(0, Math.min(100, attention));

  // specificity：有具體數字 / 對象就大幅加分
  let specificity = 25;
  if (SPECIFICITY_SIGNALS.test(hook)) specificity += 50;
  if (/我|你|妳|你們|大家|新手|老手|上班族|學生|媽媽|寶寶/.test(hook)) specificity += 15;
  specificity = Math.max(0, Math.min(100, specificity));

  // cta：直接看有沒有 CTA 訊號詞
  const cta = CTA_SIGNALS.test(hook) ? 80 : 15;

  // platformFit：長度合不合 platform；TikTok 短 / YT 標題長 / 小紅書條列
  let platformFit = 60;
  if (input.platform === "tiktok" && length > 40) platformFit -= 30;
  if (input.platform === "tiktok" && length <= 25) platformFit += 25;
  if (input.platform === "youtube" && length < 15) platformFit -= 20;
  if (input.platform === "xiaohongshu" && /[【】「」]|✨|🔥|💡|📝/.test(hook)) platformFit += 20;
  if (input.platform === "linkedin" && /[!！]{2,}/.test(hook)) platformFit -= 25;
  platformFit = Math.max(0, Math.min(100, platformFit));

  const avg = (attention + specificity + cta + platformFit) / 4;
  let verdict = "";
  if (avg >= 75) verdict = "鉤子滿穩的，照這條送即可。";
  else if (avg >= 55) verdict = "可以用但有改善空間，下面是強化版。";
  else verdict = "鉤子太弱，建議用下面的改寫版。";

  // 改寫示範：依平台 hook 風格 + 補強短板
  const lowestKey = (Object.entries({ attention, specificity, cta, platformFit }).sort((a, b) => a[1] - b[1])[0] ?? ["attention", 0])[0] as
    | "attention" | "specificity" | "cta" | "platformFit";
  const rewriteHints: Record<typeof lowestKey, string> = {
    attention: `加一個反差開頭：「你以為${hook}？其實正好相反」`,
    specificity: `加具體數字：「3 天 / 5 分鐘 / 100 個」放在開頭`,
    cta: `結尾補一句 CTA：「留言 +1 我私訊你完整版」`,
    platformFit: `${profile.displayName} 偏好「${profile.hookStyle}」— 照這個風格重寫`,
  };
  const suggestedRewrite = `[${profile.displayName} 強化版] ${hook} → ${rewriteHints[lowestKey]}`;

  return {
    success: true,
    scores: { attention, specificity, cta, platformFit },
    verdict,
    suggestedRewrite,
  };
}

// ─── formatCaption：依平台規範重排 caption ───────────────────────────

export interface FormatCaptionInput {
  rawText: string;
  platform: SocialPlatform;
  /** 額外要附在尾巴的 hashtag（不傳則不附） */
  hashtags?: ReadonlyArray<string>;
}

export interface FormatCaptionResult {
  success: true;
  platform: SocialPlatform;
  formatted: string;
  /** 提示是否超出該平台 caption 長度限制 */
  notes: string[];
}

/** 各平台 caption 最大字數（粗估，超出會被截或建議放留言） */
const CAPTION_MAX_LENGTH: Record<SocialPlatform, number> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  xiaohongshu: 1000,
  facebook: 63206,
  linkedin: 3000,
};

/**
 * 依平台慣例重排 caption：
 *  - IG：段落空行 + emoji + hashtags 放尾巴 / 留言區
 *  - TikTok：短句 + 1-3 hashtags 嵌在內文
 *  - 小紅書：條列式 + emoji 標題
 *  - YT：第一行強 hook + 第二段詳述 + hashtags
 *  - FB / LinkedIn：段落式，少 hashtag
 */
export function formatCaption(input: FormatCaptionInput): FormatCaptionResult {
  const raw = input.rawText.trim();
  const tags = (input.hashtags ?? []).filter(t => t.trim().length > 0);
  const notes: string[] = [];
  let formatted = "";

  switch (input.platform) {
    case "instagram": {
      // 段落空行（句號斷句）+ 尾巴 hashtags
      const sentences = raw.split(/(?<=[。!?！？])/).filter(s => s.trim());
      formatted = sentences.join("\n\n");
      if (tags.length > 0) formatted += `\n\n.\n.\n.\n${tags.join(" ")}`;
      break;
    }
    case "tiktok": {
      // 短句 + hashtags 嵌在尾巴；TikTok 不愛斷行
      const trimmed = raw.replace(/\s+/g, " ");
      formatted = tags.length > 0 ? `${trimmed} ${tags.slice(0, 5).join(" ")}` : trimmed;
      break;
    }
    case "xiaohongshu": {
      // 條列式：每句前加 emoji bullet
      const lines = raw.split(/[。!?！？\n]/).filter(s => s.trim());
      formatted = lines.map((l, i) => `${["✨", "💡", "📝", "🔥", "🌟"][i % 5]} ${l.trim()}`).join("\n");
      if (tags.length > 0) formatted += `\n\n${tags.join(" ")}`;
      break;
    }
    case "youtube": {
      // 第一行強 hook + 段落 + hashtags
      const [first, ...rest] = raw.split(/[。!?！？\n]/).filter(s => s.trim());
      formatted = `${first?.trim() ?? raw}\n\n${rest.map(s => s.trim()).join("\n\n")}`;
      if (tags.length > 0) formatted += `\n\n${tags.join(" ")}`;
      break;
    }
    case "facebook":
    case "linkedin": {
      // 段落式：照原文段落，但去掉多餘空行
      formatted = raw.split(/\n+/).map(p => p.trim()).filter(Boolean).join("\n\n");
      if (tags.length > 0) formatted += `\n\n${tags.slice(0, input.platform === "linkedin" ? 5 : 3).join(" ")}`;
      break;
    }
  }

  const max = CAPTION_MAX_LENGTH[input.platform];
  if (formatted.length > max) {
    notes.push(`格式化後字數 ${formatted.length}，超過 ${PLATFORM_PROFILES[input.platform].displayName} 上限 ${max}，建議拆成主貼文 + 留言區補充`);
  }

  return {
    success: true,
    platform: input.platform,
    formatted,
    notes,
  };
}

// ─── 給呼叫端的元資料：平台清單 + 描述（system prompt 可帶出來給 LLM 看） ──

export function listSupportedPlatforms(): Array<{
  id: SocialPlatform;
  displayName: string;
  primaryAges: ReadonlyArray<AudienceAge>;
  weeklyCadence: number;
  bestTimes: ReadonlyArray<string>;
}> {
  return (Object.keys(PLATFORM_PROFILES) as SocialPlatform[]).map(id => ({
    id,
    displayName: PLATFORM_PROFILES[id].displayName,
    primaryAges: PLATFORM_PROFILES[id].primaryAges,
    weeklyCadence: PLATFORM_PROFILES[id].weeklyCadence,
    bestTimes: PLATFORM_PROFILES[id].bestTimes,
  }));
}
