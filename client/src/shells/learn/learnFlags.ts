// ============================================================================
// shells/learn/learnFlags.ts — /learn 富 shell 的旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// 沿用 P0 featureFlags.ts 的 readFlag 慣例（讀 import.meta.env，預設安全值）。
// 這層額外旗標只影響「/learn 是否用 P6 富 UI」，不影響 P0 的 ENABLE_4SHELL 總開關：
//   - ENABLE_4SHELL=OFF → 整個 /learn shell 根本不掛載（行為 == 線上）。
//   - ENABLE_4SHELL=ON + SHELL_LEARN_RICH=ON（預設）→ /learn 用 P6 富 shell（本包）。
//   - ENABLE_4SHELL=ON + SHELL_LEARN_RICH=OFF → /learn 退回 P0 ShellFrame（純 re-home 既有頁）。
//
// 故本包「可一鍵退回 P0 行為」：VITE_SHELL_LEARN_RICH=0 即還原成 P0 學習 shell。
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
  } catch { /* import.meta 不可用 → fallback */ }
  return fallback;
}

/**
 * /learn 富 shell 開關。預設 ON（P6 的重點就是把 /learn 變成真實富 UI）。
 * 對應 .env：VITE_SHELL_LEARN_RICH=0 可退回 P0 ShellFrame。
 */
export const SHELL_LEARN_RICH: boolean = readFlag("VITE_SHELL_LEARN_RICH", true);
