// ============================================================================
// social/socialFlags.ts — /social 視覺實裝專屬旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 九步旅程（S1–S9）視覺實裝。
// 沿用 P0 featureFlags.ts / learnFlags.ts 的 readFlag 慣例（讀 import.meta.env，
// 預設安全值）。本旗標只控制「/social cockpit 是否顯示 design-kit 九步旅程步進
// 指示」，零後端、可一鍵回滾：
//   - SOCIAL_JOURNEY_STEPPER=OFF（預設）→ cockpit 維持既有純文字旅程行＝零變化。
//   - SOCIAL_JOURNEY_STEPPER=ON         → cockpit 改用 design-kit 亮色暖光步進指示
//     （目前第幾步／就緒態，以 design-kit token 呈現）。
//
// 對應 .env：VITE_SOCIAL_JOURNEY_STEPPER=1 開啟；不設或 0＝關閉（安全預設）。
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
 * /social 九步旅程步進指示開關。預設 OFF＝零變化（安全回滾）。
 * 對應 .env：VITE_SOCIAL_JOURNEY_STEPPER=1 啟用 design-kit 步進視覺。
 */
export const SOCIAL_JOURNEY_STEPPER: boolean = readFlag("VITE_SOCIAL_JOURNEY_STEPPER", false);
