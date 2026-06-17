// ============================================================================
// components/flow-tv/flowTvFlags.ts — Flow TV 放映皮旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// AIDV-117 / U-14：Flow TV 全屏沉浸播放器（跨 /video /social 提示庫放映皮）。
// 沿用 P0 featureFlags.ts 的 readFlag 慣例（讀 import.meta.env，預設安全值）。
//
// 零後端可回滾：本旗標純前端控制 Flow TV 放映皮是否啟用。預設 OFF（安全），
// 由各殼明確開啟（VITE_FLOW_TV=1）後才掛載沉浸播放器入口。
//   - VITE_FLOW_TV 未設 / =0 → Flow TV 入口隱藏，等同未實裝（零回歸）。
//   - VITE_FLOW_TV=1 → 啟用 Flow TV 放映皮。
// ============================================================================

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }
  return false;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用 → fallback */
  }
  return fallback;
}

/**
 * Flow TV 放映皮總開關。預設 OFF（安全回滾值）。
 * 對應 .env：VITE_FLOW_TV=1 啟用沉浸播放器。
 */
export const FLOW_TV_ENABLED: boolean = readFlag("VITE_FLOW_TV", false);

/** 自動播放每張的停留毫秒（>=150ms，尊重動效範圍）。 */
export const FLOW_TV_AUTOPLAY_MS = 4500;
