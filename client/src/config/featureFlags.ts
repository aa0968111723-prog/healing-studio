// ============================================================================
// featureFlags.ts — P0 4-shell restructure feature flags (build-time, Vite env)
// ----------------------------------------------------------------------------
// 單一真相源：所有 4-shell 相關旗標都從這裡讀。預設見各旗標說明
//（ENABLE_4SHELL 自 2026-06-20 預設 ON＝前端新介面上線；SHELL_LEARN 預設 ON＝既有 /learn 可達；
//  ENABLE_AIDV_CHROME 自 2026-06-16 預設 ON＝Wave U 新設計，但被 ENABLE_4SHELL gate）。
// 旗標來自 Vite 的 import.meta.env（建置時注入），可被 .env / 部署環境變數覆寫。
//
//   ENABLE_4SHELL=ON（自 2026-06-20 預設）→ ShellRoutes() 注入四個 shell 掛載點 + 舊路徑相容導向。
//   ENABLE_4SHELL=OFF（回滾退路）→ App.tsx 的 <Router> 完全照舊；不掛任何 /video|/social|
//                              /learn|/settings shell、不啟用任何舊→新相容導向。
//
// 為什麼用 import.meta.env 而非 system_settings 表：P0 是「純前端、零後端改動」，
// 旗標必須在「不碰 server / 不碰 DB」的前提下可切換。日後（/settings admin 治理）可
// 改讀 system_settings，屆時把 readFlag 的來源換掉即可，呼叫端不動。
// ============================================================================

/** 把多種「真值字串」正規化成 boolean（"1"/"true"/"on"/"yes" → true）。 */
function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }
  return false;
}

/**
 * 安全讀取 Vite 環境變數。SSR / 測試環境中 import.meta.env 可能不存在，故包 try。
 * 預設值由呼叫端的 fallback 決定（多數旗標傳 false／OFF＝「沒設＝照舊」；少數如 SHELL_LEARN 傳 true／ON）。
 */
function readFlag(key: string, fallback = false): boolean {
  try {
    // Vite 會把 import.meta.env.VITE_* 在建置時靜態替換。
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用（如某些測試 runner）→ 用 fallback */
  }
  return fallback;
}

/**
 * 4-shell 總開關。ON 時 ShellRoutes() 注入四個 shell 掛載點 + 舊路徑相容導向；
 * OFF 時整個 shell routing 層不存在，零行為改變（回滾退路）。
 *
 * **2026-06-20 Bruce 拍板「線上開前端新介面」→ default ON**：四殼導演台 UI
 * （Rail/TopBar/⌘K ＋ /video|/social|/learn|/settings shell ＋ ENABLE_AIDV_CHROME 暖光設計）
 * 成為線上預設樣貌。先前已於 .env.production 設 VITE_ENABLE_4SHELL=1（正式環境早已為新介面），
 * 此處翻 default 讓「沒有 env 覆寫」的環境（本機 dev／測試）也預設新介面。
 *
 * 關閉退路（任一，皆不需改碼）：
 *   ① 全站秒回滾：部署環境設 `VITE_ENABLE_4SHELL=0`（Railway），重新部署 →
 *      shell routing 層消失、ENABLE_AIDV_CHROME 連帶強制 OFF（沿用既有 AppleDock）。
 *   ② 單一瀏覽器：網址 `?aidvchrome=0`（即時、存 localStorage、不影響他人）關掉新 chrome。
 * 優先序維持：建置旗標（VITE_ENABLE_4SHELL）> 預設 ON；run-time 覆寫見 ENABLE_AIDV_CHROME。
 */
export const ENABLE_4SHELL: boolean = readFlag("VITE_ENABLE_4SHELL", true);

/**
 * /social shell 顯示開關（模擬 SHELL_META 已預留）。OFF 時 /social 顯示「已關閉」佔位。
 * 對應 .env：VITE_SHELL_SOCIAL=1
 */
export const SHELL_SOCIAL: boolean = readFlag("VITE_SHELL_SOCIAL", false);

/**
 * /learn shell 顯示開關。real repo 既有 /learn 已上線，預設 ON 以維持現狀可達性。
 * 對應 .env：VITE_SHELL_LEARN=0 可關閉
 */
export const SHELL_LEARN: boolean = readFlag("VITE_SHELL_LEARN", true);

/**
 * 執行期可切換旗標（給 Bruce 真站走查用，**不需重新部署、不影響其他使用者**）：
 * 網址 `?<key>=1` 開、`?<key>=0` 關，並存進 localStorage 持續整個瀏覽 session；
 * 只影響「加了參數的那個瀏覽器」。SSR/測試（無 window）安全回 false。
 */
export function readRuntimeToggle(key: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search).get(key);
    if (q === "1" || q === "0") {
      try { window.localStorage.setItem(`flag:${key}`, q); } catch { /* 私密模式忽略 */ }
      return q === "1";
    }
    return window.localStorage.getItem(`flag:${key}`) === "1";
  } catch {
    return false;
  }
}

/**
 * 執行期三態覆寫：明確設了才回 true/false，沒設回 null（交給建置預設決定）。
 * 這讓「預設 ON」仍能被 `?aidvchrome=0`（單瀏覽器）明確關閉。
 */
export function readRuntimeOverride(key: string): boolean | null {
  try {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search).get(key);
    if (q === "1" || q === "0") {
      try { window.localStorage.setItem(`flag:${key}`, q); } catch { /* 私密模式忽略 */ }
      return q === "1";
    }
    const ls = window.localStorage.getItem(`flag:${key}`);
    if (ls === "1") return true;
    if (ls === "0") return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * U-4 殼層 chrome ＋ Wave U design-kit 全站採用總開關（AIDV-94/92，Wave U）。
 * **2026-06-16 Bruce 拍板「預設全部打開」→ default ON**（§2.5d 整套一次上）：
 * 亮色暖光新設計（Rail/TopBar/⌘K ＋ 各殼面板採用）成為線上預設樣貌。
 *
 * 關閉退路（任一，皆不需改碼）：
 *   ① 全站秒回滾：部署環境設 `VITE_ENABLE_AIDV_CHROME=0`（Railway），重新部署。
 *   ② 單一瀏覽器：網址 `?aidvchrome=0`（即時、存 localStorage、不影響他人）。
 * 優先序：執行期覆寫（?aidvchrome=0/1）> 建置旗標（VITE_ENABLE_AIDV_CHROME）> 預設 ON。
 *
 * **依賴 `ENABLE_4SHELL`（必要前提）**：chrome 的 Rail/⌘K 導向 SHELL_META 路徑（/video…），
 * 這些路由只有 `ENABLE_4SHELL && shellRoutes()` 才註冊（App.tsx）。故 chrome 必須在 4-shell
 * 之下才有作用——`ENABLE_4SHELL` OFF 時強制 OFF（沿用既有 AppleDock＝含登出，零破壞），
 * 避免預設 chrome 把使用者導到 NotFound。上線新設計＝Railway 同時設 `VITE_ENABLE_4SHELL=1`。
 */
export const ENABLE_AIDV_CHROME: boolean =
  ENABLE_4SHELL && (readRuntimeOverride("aidvchrome") ?? readFlag("VITE_ENABLE_AIDV_CHROME", true));

/**
 * 「光球只留笑臉光球」總開關（Bruce 2026-06-20 拍板「光球只留笑臉光球」）。
 * **預設 ON＝只保留右下笑臉助手光球（ProactiveOrbWidget）本身**，把「主動跳出的其他
 * 精靈光球提示」全部靜音：
 *   ① 右上主動精靈通知卡（ProactiveNotificationCenter＝守守/財財/巧巧…）整組不訂閱、不渲染。
 *   ② 左下第二顆新光球（AidvOrbMount）的主動泡泡（proactive bubble）不再自動冒出；
 *      光球本體＝點開才用，不主動彈。
 * 笑臉光球本體（含它自己嘴上的到站建議氣泡）完全不受影響＝功能不動。
 *
 * 「主動跳出的精靈系統」底層邏輯（事件匯流排、觸發定義、偵測器、通知中心元件）全部保留，
 * **只關它對外的 UI 呈現**＝可秒回滾、零後端：
 *   ① 全站還原舊行為：部署環境設 `VITE_ORB_SMILEY_ONLY=0`（Railway），重新部署 →
 *      主動精靈卡片＋第二顆光球泡泡回來。
 *   ② 單一瀏覽器即時：網址 `?orbsmileyonly=0`（存 localStorage、不影響他人）還原。
 * 優先序：執行期覆寫（?orbsmileyonly=0/1）> 建置旗標（VITE_ORB_SMILEY_ONLY）> 預設 ON。
 */
export const ORB_SMILEY_ONLY: boolean =
  readRuntimeOverride("orbsmileyonly") ?? readFlag("VITE_ORB_SMILEY_ONLY", true);

/**
 * Export Chain 開關（AIDV-237）：在導演台批次生成面板加入「下載素材」按鈕
 * 和批次匯出清單。預設 ON；關閉退路：
 *   ① 全站：部署環境設 `VITE_FEATURE_EXPORT_CHAIN=0`（Railway），重新部署。
 *   ② 單一瀏覽器：網址 `?exportchain=0`（存 localStorage）。
 */
export const FEATURE_EXPORT_CHAIN: boolean =
  readRuntimeOverride("exportchain") ?? readFlag("VITE_FEATURE_EXPORT_CHAIN", true);

/**
 * 統一 SSE 路由開關（AIDV-716）：ON 時前端改用 /api/sse 統一端點取代三條
 * 舊 SSE 端點（/api/generation-events/:jobId、/api/model-training-events/:modelId）。
 * **預設 OFF**，零行為改變；需同時在伺服器端設 UNIFIED_SSE_ROUTER=1 才能生效。
 *
 * 關閉退路：取消 VITE_UNIFIED_SSE_ROUTER 或設為 0 → 恢復舊三端點，不需改碼。
 */
export const UNIFIED_SSE_ROUTER: boolean = readFlag("VITE_UNIFIED_SSE_ROUTER", false);

/**
 * OrbOnboarding 引導對話框開關（AIDV-823 / AIDV-830）。
 * 首次登入時彈出引導問卷，讓代理了解使用者偏好，完成後導向 /video。
 * 預設 ON（AIDV-830：旗標政策，預設開啟、秒回滾退路）。
 * 關閉退路：部署環境設 VITE_ENABLE_ORB_ONBOARDING=0；無需改碼。
 */
export const ENABLE_ORB_ONBOARDING: boolean = readFlag("VITE_ENABLE_ORB_ONBOARDING", true);

/**
 * 首次創作流「下一步」分支 chip（AIDV-810）。
 * 首圖完成後顯示多模態引導 chip：配音/動畫/導演/再生一張。
 * 預設 ON；關閉退路：VITE_FEATURE_ONBOARDING_BRANCH=0 或 ?onboardingbranch=0。
 */
export const FEATURE_ONBOARDING_BRANCH: boolean =
  readRuntimeOverride("onboardingbranch") ?? readFlag("VITE_FEATURE_ONBOARDING_BRANCH", true);

/**
 * /learn 新手 0→1 路徑分頁（AIDV-811）。
 * 在 /learn 新增「🚀 新手路徑」分頁為預設落點，含 5 步做中學路徑卡（localStorage 追蹤進度）。
 * 預設 ON；關閉退路：VITE_FEATURE_LEARN_BEGINNER_PATH=0 或 ?learnbeginnerpath=0。
 */
export const FEATURE_LEARN_BEGINNER_PATH: boolean =
  readRuntimeOverride("learnbeginnerpath") ?? readFlag("VITE_FEATURE_LEARN_BEGINNER_PATH", true);

/**
 * 提示診斷微文案＋範例卡（AIDV-812）。
 * 空結果或弱提示時，升級「再試一次」為具體建議文案，並提供前後對照範例卡。
 * 預設 ON；關閉退路：VITE_FEATURE_PROMPT_DIAGNOSTIC=0 或 ?promptdiagnostic=0。
 */
export const FEATURE_PROMPT_DIAGNOSTIC: boolean =
  readRuntimeOverride("promptdiagnostic") ?? readFlag("VITE_FEATURE_PROMPT_DIAGNOSTIC", true);

/**
 * AIDV-864 PR②：快速情境回饋浮動按鈕（右下角常駐）。
 * 預設 ON；關閉退路：VITE_ENABLE_QUICK_FEEDBACK=0 或 ?quickfeedback=0。
 */
export const ENABLE_QUICK_FEEDBACK: boolean =
  readRuntimeOverride("quickfeedback") ?? readFlag("VITE_ENABLE_QUICK_FEEDBACK", true);

/** 集中匯出，方便 SpineProvider / 偵錯面板一次讀取。 */
export const FEATURE_FLAGS = {
  ENABLE_4SHELL,
  SHELL_SOCIAL,
  SHELL_LEARN,
  ENABLE_AIDV_CHROME,
  ORB_SMILEY_ONLY,
  FEATURE_EXPORT_CHAIN,
  UNIFIED_SSE_ROUTER,
  ENABLE_ORB_ONBOARDING,
  FEATURE_ONBOARDING_BRANCH,
  FEATURE_LEARN_BEGINNER_PATH,
  FEATURE_PROMPT_DIAGNOSTIC,
  ENABLE_QUICK_FEEDBACK,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
