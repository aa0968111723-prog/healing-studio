// ============================================================================
// featureFlags.ts — P0 4-shell restructure feature flags (build-time, Vite env)
// ----------------------------------------------------------------------------
// 單一真相源：所有 4-shell 相關旗標都從這裡讀。預設全部 OFF → 行為 == 線上現狀。
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
 * U-4 殼層 chrome 視覺實裝（AIDV-94，Wave U）。**預設 OFF**＝線上零變化（沿用現有 AppleDock）。
 * 開啟方式（任一）：① 建置期 `VITE_ENABLE_AIDV_CHROME=1`（全站，部署後生效）；
 * ② 真站走查 `?aidvchrome=1`（單一瀏覽器、即時、可 `?aidvchrome=0` 關，不動其他人）。
 * strangler：大範圍視覺改動先旗標化，Bruce 走查滿意後再 default ON。
 */
export const ENABLE_AIDV_CHROME: boolean =
  readFlag("VITE_ENABLE_AIDV_CHROME", false) || readRuntimeToggle("aidvchrome");

/** 集中匯出，方便 SpineProvider / 偵錯面板一次讀取。 */
export const FEATURE_FLAGS = {
  ENABLE_4SHELL,
  SHELL_SOCIAL,
  SHELL_LEARN,
  ENABLE_AIDV_CHROME,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
