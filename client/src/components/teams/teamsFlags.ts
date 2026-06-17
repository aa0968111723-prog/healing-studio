// ============================================================================
// teams/teamsFlags.ts — 團隊協作視覺（U-13 / AIDV-116）專屬旗標
// ----------------------------------------------------------------------------
// Wave U · /learn/teams 團隊協作系統視覺實裝：團隊清單卡／成員列／角色標籤／
// 共享範圍指示／分工看板（純前端唯讀，資料用 props/mock，零後端可回滾）。
//
// 沿用 P0 featureFlags.ts / stateInspectorFlags.ts 的 readFlag 慣例（讀
// import.meta.env，預設安全值）。本旗標只控制「團隊協作視覺是否渲染」，純前端
// 唯讀、零後端、可一鍵回滾：
//   - TEAMS_COLLAB=OFF（預設）→ <TeamsBoard> 回傳 null＝prod 隱藏、零變化。
//   - TEAMS_COLLAB=ON          → 顯示團隊協作視覺（團隊／成員／角色／共享／看板）。
//
// 對應 .env：VITE_TEAMS_COLLAB=1 開啟；不設或 0＝關閉（安全預設，prod 隱藏）。
// 注意：真實 RBAC／後端＝AIDV-121，不在本卡；本卡純視覺，旗標只控渲染。
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
 * 團隊協作視覺開關。預設 OFF＝prod 隱藏（安全回滾）。
 * 對應 .env：VITE_TEAMS_COLLAB=1 啟用 /learn/teams 團隊協作視覺。
 */
export const TEAMS_COLLAB: boolean = readFlag("VITE_TEAMS_COLLAB", false);
