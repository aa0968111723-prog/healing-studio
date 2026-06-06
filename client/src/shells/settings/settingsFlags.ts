// ============================================================================
// shells/settings/settingsFlags.ts — /settings 富 shell 旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// 沿用 P0 featureFlags.ts 的 readFlag 慣例。本旗標只影響「/settings 是否用 P6 富 UI」，
// 不影響 P0 的 ENABLE_4SHELL 總開關：
//   - ENABLE_4SHELL=OFF → /settings shell 不掛載（行為 == 線上）。
//   - ENABLE_4SHELL=ON + SHELL_SETTINGS_RICH=ON（預設）→ /settings 用 P6 富 shell（本包）。
//   - ENABLE_4SHELL=ON + SHELL_SETTINGS_RICH=OFF → /settings 退回 P0 ShellFrame（純 re-home）。
// 故本包可一鍵退回 P0：VITE_SHELL_SETTINGS_RICH=0。
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
 * /settings 富 shell 開關。預設 ON。
 * 對應 .env：VITE_SHELL_SETTINGS_RICH=0 可退回 P0 ShellFrame。
 */
export const SHELL_SETTINGS_RICH: boolean = readFlag("VITE_SHELL_SETTINGS_RICH", true);
