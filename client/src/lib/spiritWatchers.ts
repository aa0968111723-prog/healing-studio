/**
 * client/src/lib/spiritWatchers.ts
 *
 * 純函式 helpers for the 5 主動精靈 watchdog 還沒有 publisher 的事件。
 *
 * 之前這 5 條事件 schema 寫好但沒人 publish，導致對應精靈在 production
 * 從不主動冒出來（巧巧 / 守守 / 細細 / 群群）。本檔提供「客戶端能算得出來」
 * 的保守偵測：
 *   - measurePageTti() — 用 Navigation Timing API 量 TTI
 *   - hasMutedRelevantSpirit() — 比對 mutedSpirits × 當前訊息關鍵字
 *   - detectPlatformMention() — 從近期訊息找社群平台名稱
 *   - suggestUnusedFeature() — 從 localStorage visited 找個沒走過的功能
 *
 * 不直接 publish — 純資料運算 — 留給呼叫端（DashboardLayout / sendMessage /
 * BackgroundTasksContext）依各自情境決定要不要 publish。
 */

// ─── 守守：page_perf_bad ───────────────────────────────────────────────
/**
 * 用 Navigation Timing API 量首次互動可用時間（TTI 粗估，用 domInteractive）。
 * 回傳 null 表示瀏覽器不支援或 entry 尚未產生。瀏覽器舊版 Safari 可能無資料。
 */
export function measurePageTti(): number | null {
  if (typeof performance === "undefined") return null;
  // 優先用 Navigation Timing Level 2 (PerformanceNavigationTiming)
  const entries = performance.getEntriesByType?.("navigation");
  if (entries && entries.length > 0) {
    const nav = entries[0] as PerformanceNavigationTiming;
    // domInteractive 是 DOM 解析完可互動 — 是 TTI 的合理代理。
    // navigation.startTime 永遠是 0，所以直接讀 domInteractive。
    if (typeof nav.domInteractive === "number" && nav.domInteractive > 0) {
      return Math.round(nav.domInteractive);
    }
  }
  return null;
}

/**
 * 給定的 TTI 是否超過「慢」門檻（5 秒）。配合 inspector 慢頁警示用。
 * 5 秒是 Google 對 Core Web Vitals「Poor」TTI 的近似門檻。
 */
export function isPageTtiSlow(tti: number | null): boolean {
  return tti !== null && tti > 5000;
}

// ─── 細細：settings_drift_detected ────────────────────────────────────
/**
 * 對應「使用者把某類精靈靜音了，但訊息裡卻問該精靈的領域」— 例如：
 *   - mute 財財，但訊息含「多少點」「貴」「省」
 *   - mute 巧巧，但訊息含「prompt 改一下」「再寫一遍」
 *   - mute 守守，但訊息含「壞掉」「掛了」
 *
 * 命中即可由呼叫端 publish settings_drift_detected，讓細細冒出來說「你之前
 * 把『財財主動提醒』關掉了…要打開還是維持靜音？」
 *
 * 回傳被靜音又被問到的精靈名（顯示用），未命中回 null。
 */
const DRIFT_RULES: ReadonlyArray<{
  role: string;
  nickname: string;
  settingLabel: string;
  keywords: RegExp;
}> = [
  {
    role: "accountant",
    nickname: "財財",
    settingLabel: "財財主動提醒（成本 / 餘額）",
    keywords: /(多少點|花多少|貴|省|預算|額度|本月用了)/,
  },
  {
    role: "quality-coach",
    nickname: "巧巧",
    settingLabel: "巧巧主動提醒（prompt 改寫）",
    keywords: /(prompt(改|寫|修)|改寫|再寫一遍|寫得不好|想法卡住)/i,
  },
  {
    role: "inspector",
    nickname: "守守",
    settingLabel: "守守主動提醒（站台問題）",
    keywords: /(壞掉|掛了|失敗|錯誤|出錯|404|500|慢|跑不動)/,
  },
  {
    role: "legal-advisor",
    nickname: "律律",
    settingLabel: "律律主動提醒（版權 / 商標 / 肖像）",
    keywords: /(版權|授權|商標|肖像|侵權|copyright|trademark)/i,
  },
  {
    role: "security-guard",
    nickname: "安安",
    settingLabel: "安安主動提醒（資安）",
    keywords: /(密碼|api ?key|金鑰|盜帳號|釣魚|資安)/i,
  },
  {
    role: "onboarding-coach",
    nickname: "帶帶",
    settingLabel: "帶帶主動提醒（操作引導）",
    keywords: /(怎麼用|怎麼操作|找不到|不會用|教我)/,
  },
];

export interface SettingsDriftHit {
  /** 被靜音卻被問到的精靈名 (顯示用) */
  nickname: string;
  /** 對應的偏好設定名稱（settings_drift_detected payload 的 settingName） */
  settingName: string;
}

export function detectSettingsDrift(
  text: string,
  mutedRoles: readonly string[],
): SettingsDriftHit | null {
  if (!text || mutedRoles.length === 0) return null;
  const muted = new Set(mutedRoles);
  for (const rule of DRIFT_RULES) {
    if (!muted.has(rule.role)) continue;
    if (rule.keywords.test(text)) {
      return {
        nickname: rule.nickname,
        settingName: rule.settingLabel,
      };
    }
  }
  return null;
}

// ─── 群群：social_post_ready ──────────────────────────────────────────
/**
 * 從近期訊息找社群平台 mention。回傳第一個命中的平台 + 推薦發文時段。
 */
const PLATFORM_HINTS: ReadonlyArray<{
  pattern: RegExp;
  platform: string;
  // 給 social_post_ready.timing 用的台灣最佳發文時段建議
  timing: string;
}> = [
  { pattern: /\b(ig|instagram)\b|限動|reels?\b/i, platform: "Instagram", timing: "傍晚 19-21 點" },
  { pattern: /\b(tiktok|抖音|tt)\b/i, platform: "TikTok", timing: "下午 18-22 點" },
  { pattern: /\b(youtube|yt|油管)\b/i, platform: "YouTube", timing: "週四 / 週日 20-22 點" },
  { pattern: /\b(小紅書|xiaohongshu|rednote)\b/i, platform: "小紅書", timing: "中午 12-13 點 / 晚上 21-23 點" },
  { pattern: /\b(facebook|fb|臉書)\b/i, platform: "Facebook", timing: "傍晚 18-21 點" },
  { pattern: /\b(linkedin|領英)\b/i, platform: "LinkedIn", timing: "工作日早上 9-11 點" },
];

export interface PlatformMention {
  platform: string;
  timing: string;
}

export function detectPlatformMention(texts: readonly string[]): PlatformMention | null {
  for (const text of texts) {
    if (!text) continue;
    for (const hint of PLATFORM_HINTS) {
      if (hint.pattern.test(text)) {
        return { platform: hint.platform, timing: hint.timing };
      }
    }
  }
  return null;
}

/**
 * 把使用者剛剛訊息中的平台 mention 記到 localStorage，附時間戳。
 * BackgroundTasksContext 在任務完成時讀此值，30 分鐘內有 mention 才發
 * social_post_ready。沒命中或瀏覽器不支援 localStorage 都安全 no-op。
 */
const PLATFORM_MENTION_KEY = "spiritWatchers.platformMention";
const PLATFORM_MENTION_TTL = 30 * 60_000;

export function notePlatformMention(text: string): void {
  if (typeof window === "undefined") return;
  const m = detectPlatformMention([text]);
  if (!m) return;
  try {
    window.localStorage.setItem(
      PLATFORM_MENTION_KEY,
      JSON.stringify({ platform: m.platform, timing: m.timing, at: Date.now() }),
    );
  } catch {
    // ignore quota errors
  }
}

export function getRecentPlatformMention(): PlatformMention | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLATFORM_MENTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { platform?: string; timing?: string; at?: number };
    if (!parsed?.platform || !parsed?.timing || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > PLATFORM_MENTION_TTL) return null;
    return { platform: parsed.platform, timing: parsed.timing };
  } catch {
    return null;
  }
}

// ─── 守守：feature_not_used ────────────────────────────────────────────
/**
 * 站內主要功能 + 它的暗示用法。判斷邏輯：使用者最近 7 天用過站台至少 N 次但
 * 完全沒走過某條 path → 推薦「你還沒試過 X」。
 *
 * 用 localStorage key `visitedRoutes` 累積一份「曾經走過的 path prefix」。
 * 配合 useEffect 在 location 改變時 push。
 */
export const FEATURE_SUGGESTIONS: ReadonlyArray<{
  path: string;
  /** 顯示給使用者看的功能名 */
  featureName: string;
}> = [
  { path: "/director", featureName: "導演 AI（自動排腳本 → 出圖 → 串成影片）" },
  { path: "/models", featureName: "LoRA 訓練（訓你自己的風格 / 角色）" },
  { path: "/learn", featureName: "教學中心（30 秒小教程）" },
  { path: "/prompt-library", featureName: "提示詞庫（直接套用熱門 prompt）" },
  { path: "/dashboard", featureName: "Dashboard（看本月用量與省錢建議）" },
];

const VISITED_KEY = "spiritWatchers.visitedRoutes";
const VISITED_COUNT_KEY = "spiritWatchers.visitCount";

/** 把 path 寫進 localStorage 訪問清單（key 用 prefix 第一段）。同時累加總訪問次數。 */
export function trackRouteVisit(path: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(VISITED_KEY);
    const set: Set<string> = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    // 只記 path 的第一段（e.g. "/models/abc" → "/models"），跟 FEATURE_SUGGESTIONS 對齊
    const first = "/" + (path.split("/")[1] ?? "");
    set.add(first);
    window.localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(set)));
    const cnt = parseInt(window.localStorage.getItem(VISITED_COUNT_KEY) ?? "0", 10) || 0;
    window.localStorage.setItem(VISITED_COUNT_KEY, String(cnt + 1));
  } catch {
    // ignore quota / parse errors — only a hint surface
  }
}

/**
 * 回傳一個使用者尚未訪問的功能。要求：總訪問次數 ≥ 20（代表是常駐使用者）
 * 才會推薦，新使用者不打擾。沒有未訪問項目回 null。
 */
export function suggestUnusedFeature(): { featureName: string; path: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const cnt = parseInt(window.localStorage.getItem(VISITED_COUNT_KEY) ?? "0", 10) || 0;
    if (cnt < 20) return null;
    const raw = window.localStorage.getItem(VISITED_KEY);
    const visited = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    for (const f of FEATURE_SUGGESTIONS) {
      if (!visited.has(f.path)) {
        return { featureName: f.featureName, path: f.path };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 巧巧：low_quality_generation ──────────────────────────────────────
/**
 * 偵測「使用者短時間內重複送很相似的 prompt」— 這通常代表上一張結果不理想，
 * 在反覆嘗試。
 *
 * 之前版本的問題：
 *   - 用 char-level Jaccard set similarity 對中文偏誤太大（兩條完全不同
 *     需求的中文短句字元集合常 ≥0.5）
 *   - 改寫建議硬寫死「午後光線、35mm 淺景深、水彩插畫風」對 video /
 *     music / voice 完全不適用
 *   - 沒判斷分數高低 — 短時間內微改錯字（已是好 prompt）也會跳出來
 *
 * 新版改走 shared/qualityCoachEngine 的真實診斷管線：
 *   - jaccardWordSimilarity 用 word/char bigram 對中文穩 10×
 *   - rewrittenPrompt 依模態挑對應的 SUGGESTION_SNIPPETS（圖 / 影 / 音 /
 *     聲 / 通用），不再用一條 image-only 硬編字串對所有情境
 *   - 多帶 modality / missingDimensions 給 ProactiveEventBus，巧巧 system
 *     prompt 拿到後可以一次給「真的缺哪幾維」的反饋
 */
import {
  detectModality,
  detectStruggle,
  scorePrompt,
  type StruggleDiagnosis,
} from "../../../shared/qualityCoachEngine";

interface PromptHistoryEntry {
  text: string;
  at: number;
}

export interface StrugglingPromptResult {
  issue: string;
  sampleCount: number;
  rewrittenPrompt?: string;
  /** 補資料：給 ProactiveEventBus payload，巧巧可拿來精細回覆 */
  modality?: StruggleDiagnosis["modality"];
  missingDimensions?: StruggleDiagnosis["missingDimensions"];
  lastScore?: number;
}

export function detectStrugglingPrompt(
  history: readonly PromptHistoryEntry[],
  now: number,
): StrugglingPromptResult | null {
  const diag = detectStruggle(history, now);
  if (!diag) return null;
  return {
    issue: diag.issue,
    sampleCount: diag.sampleCount,
    rewrittenPrompt: diag.rewrittenPrompt,
    modality: diag.modality,
    missingDimensions: diag.missingDimensions,
    lastScore: diag.lastScore,
  };
}

// ─── 巧巧：prompt_too_short ──────────────────────────────────────────────
/**
 * 把「prompt 太短」的抽象提示換成依模態的具體建議。
 * 用 scorePrompt 找出第一個缺的維度，回傳對應的 SUGGESTION_SNIPPET 字串，
 * 給 prompt_too_short proactive event 的 suggestedAddition 欄位填入。
 *
 * 例：
 *   - 「一隻貓」(image) → "柔和午後逆光"（缺 lighting）
 *   - 「做支廣告」(general) → "明確目的（例如：建立月訂閱會員）"
 *   - "聲音"（voice）→ "腳本內容（請唸：「XXX」）"
 *
 * 取代之前硬寫死的「場景、風格、用途其中一個」抽屜。
 */
export interface ShortPromptScore {
  modality: ReturnType<typeof detectModality>;
  /** 給 ProactiveEventBus prompt_too_short 的 suggestedAddition token */
  suggestedAddition: string;
  /** 0-100 分（供 UI 顯示） */
  score: number;
}

export function scoreShortPrompt(text: string): ShortPromptScore {
  const modality = detectModality(text);
  const diag = scorePrompt(text, modality);
  // 第一個缺的維度通常是「應該補什麼」最強訊號 — engine 已經依重要度排序
  const firstMissing = diag.missingDimensions[0];
  const suggestedAddition = firstMissing
    ? diag.dimensions.find(d => d.dimension === firstMissing)!.label
    : "更具體的細節";
  return {
    modality,
    suggestedAddition,
    score: diag.score,
  };
}
