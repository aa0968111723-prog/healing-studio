// ============================================================================
// config/videoFlags.ts — P2 /video 座艙專屬旗標（新增檔；不改 P0 featureFlags.ts）
// ----------------------------------------------------------------------------
// 為什麼另開一檔而非改 P0 的 config/featureFlags.ts：
//   - P0 的 featureFlags.ts 已驗證、已套用；P1P2 採「只加不改」，把座艙旗標收在這個
//     新檔，P0 既有檔一行不動，降低套用衝突面。
//   - 兩檔慣例完全一致（讀 import.meta.env、預設安全、SSR/測試 try 包覆）。
//
// 旗標階層（重要）：座艙永遠在 ENABLE_4SHELL 之下。
//   ENABLE_4SHELL=OFF（P0 預設）→ 整個 shell 路由層不存在 → VideoShell 不會被渲染
//                                  → 座艙程式碼完全不可達（零行為改變保證仍成立）。
//   ENABLE_4SHELL=ON  → /video shell 掛載；此時才看 ENABLE_VIDEO_COCKPIT：
//     ENABLE_VIDEO_COCKPIT=ON（預設）→ /video 首頁 = P2 導演座艙（旗艦）。
//     ENABLE_VIDEO_COCKPIT=OFF       → 退回 P0 行為（/video/director re-home 既有 DirectorAI）。
//
//   VIDEO_SPINE_MOCK=OFF（預設）→ 脊椎走真實 tRPC（creativeProject/worldbuilding/…）。
//   VIDEO_SPINE_MOCK=ON         → 脊椎走離線 mock 種子（spine/mockProjects.ts），零後端、零金鑰。
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

/** 安全讀取 Vite 環境變數；SSR/測試中 import.meta.env 可能不存在，故包 try。 */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用 → 用 fallback */
  }
  return fallback;
}

/**
 * P2 導演座艙總開關。**預設 ON**，但只在 ENABLE_4SHELL=ON 時才可達（見上方階層說明）。
 * 設 .env：VITE_ENABLE_VIDEO_COCKPIT=0 可在 4-shell 開啟的情況下退回 P0 re-home 行為（除錯逃生口）。
 */
export const ENABLE_VIDEO_COCKPIT: boolean = readFlag("VITE_ENABLE_VIDEO_COCKPIT", true);

/**
 * 脊椎資料來源開關。**預設 OFF = 真實 tRPC**（P1 預設打既有後端）。
 * 設 .env：VITE_VIDEO_SPINE_MOCK=1 → 離線 mock 種子（demo / 無後端開發 / e2e）。
 */
export const VIDEO_SPINE_MOCK: boolean = readFlag("VITE_VIDEO_SPINE_MOCK", false);

/**
 * Wave 0 導演台重構總開關。**預設 ON**，但只在 ENABLE_4SHELL=ON ＋ ENABLE_VIDEO_COCKPIT=ON
 * 之下才可達（座艙永遠在雙旗標之下）。ON → /video 首頁＝三欄導演台（Story Spine／創作畫布／
 * Context Sidecar ＋ 頂部創作流程列 ＋ 光球 Ambient Copilot）。
 * 設 .env：VITE_ENABLE_DIRECTOR_CONSOLE=0 → 退回 P2 既有三欄座艙（除錯逃生口，strangler-fig 只加不刪）。
 */
export const ENABLE_DIRECTOR_CONSOLE: boolean = readFlag("VITE_ENABLE_DIRECTOR_CONSOLE", true);

/** 集中匯出，方便偵錯面板/驗收一次讀取。 */
export const VIDEO_FLAGS = {
  ENABLE_VIDEO_COCKPIT,
  VIDEO_SPINE_MOCK,
  ENABLE_DIRECTOR_CONSOLE,
} as const;

export type VideoFlagKey = keyof typeof VIDEO_FLAGS;
