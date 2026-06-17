// ============================================================================
// components/connectors/connectorsFlags.ts — 連接器治理面板旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// AIDV-115 / U-12：連接器／個人資料庫 5 類治理面板視覺實裝
//                  （/settings/connections＋ACL＋BYOMCP）。
// 沿用 P0 featureFlags.ts 的 readFlag 慣例（讀 import.meta.env，預設安全值）。
//
// 零後端可回滾：本旗標純前端控制連接器治理面板是否啟用。預設 OFF（安全），
// 由 settings 殼明確開啟（VITE_CONNECTORS_PANEL=1）後才掛載 /settings/connections 入口。
//   - VITE_CONNECTORS_PANEL 未設 / =0 → 入口隱藏，等同未實裝（零回歸）。
//   - VITE_CONNECTORS_PANEL=1        → 啟用連接器治理面板。
//
// 純視覺實裝：資料一律走 props/mock（離線可驗），不接後端、不貼任何金鑰
//            （金鑰只貼 Railway，絕不入碼）。
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
 * 連接器治理面板總開關。預設 OFF（安全回滾值）。
 * 對應 .env：VITE_CONNECTORS_PANEL=1 啟用 /settings/connections。
 */
export const CONNECTORS_PANEL_ENABLED: boolean = readFlag("VITE_CONNECTORS_PANEL", false);

/**
 * BYOMCP（自帶 MCP 伺服器）分組是否可見。預設 OFF（安全）。
 * 對應 .env：VITE_CONNECTORS_BYOMCP=1。
 */
export const CONNECTORS_BYOMCP_ENABLED: boolean = readFlag("VITE_CONNECTORS_BYOMCP", false);
