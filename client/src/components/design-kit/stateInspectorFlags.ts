// ============================================================================
// design-kit/stateInspectorFlags.ts — StateInspector（四態演示切換）專屬旗標
// ----------------------------------------------------------------------------
// U-4f（AIDV-139）· 脊椎 chrome StateInspector：用 segmented control 在「載入／空／
// 錯誤／就緒」四態間切換，即時展示 design-kit 四態元件，供走查與設計驗收用。
//
// 沿用 P0 featureFlags.ts / socialFlags.ts 的 readFlag 慣例（讀 import.meta.env，
// 預設安全值）。本旗標只控制「StateInspector 演示器是否渲染」，純前端唯讀、零後端、
// 可一鍵回滾：
//   - STATE_INSPECTOR=OFF（預設）→ <StateInspector> 回傳 null＝prod 隱藏、零變化。
//   - STATE_INSPECTOR=ON          → 顯示四態演示切換器（設計走查 / 驗收用）。
//
// 對應 .env：VITE_STATE_INSPECTOR=1 開啟；不設或 0＝關閉（安全預設，prod 隱藏）。
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
 * StateInspector 四態演示器開關。預設 OFF＝prod 隱藏（安全回滾）。
 * 對應 .env：VITE_STATE_INSPECTOR=1 啟用四態走查切換。
 */
export const STATE_INSPECTOR: boolean = readFlag("VITE_STATE_INSPECTOR", false);
