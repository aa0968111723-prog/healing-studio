// ============================================================================
// featureFlags.ts — P0 4-shell restructure feature flags (build-time, Vite env)
// ----------------------------------------------------------------------------
// 單一真相源：所有 4-shell 相關旗標都從這裡讀。多數預設 OFF；例外見各旗標說明
//（SHELL_LEARN 預設 ON＝既有 /learn 可達；ENABLE_AIDV_CHROME 自 2026-06-16 預設 ON＝Wave U 新設計上線）。
// 旗標來自 Vite 的 import.meta.env（建置時注入），可被 .env / 部署環境變數覆寫。
//
//   ENABLE_4SHELL=OFF（預設）→ App.tsx 的 <Router> 完全照舊；不掛任何 /video|/social|
//                              /learn|/settings shell、不啟用任何舊→新相容導向。
//   ENABLE_4SHELL=ON         → ShellRoutes() 注入四個 shell 掛載點 + 舊路徑相容導向。
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
 * 預設值一律 false（OFF），確保「沒設＝照舊」。
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
 * 4-shell 總開關。OFF（預設）時整個 shell routing 層不存在，零行為改變。
 * 對應 .env：VITE_ENABLE_4SHELL=1
 */
export const ENABLE_4SHELL: boolean = readFlag("VITE_ENABLE_4SHELL", false);

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

/** 集中匯出，方便 SpineProvider / 偵錯面板一次讀取。 */
export const FEATURE_FLAGS = {
  ENABLE_4SHELL,
  SHELL_SOCIAL,
  SHELL_LEARN,
  ENABLE_AIDV_CHROME,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
