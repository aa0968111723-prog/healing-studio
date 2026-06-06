// ============================================================================
// spine/spineUtil.ts — 脊椎用的純小工具（id / 時間戳 / 延遲 / 積分換算）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬 lib/util.ts 的對應片段（去掉與 UI 綁定的部分）。純函式。
// ============================================================================

let _n = 0;
/** 產生短 id（前綴 + 時間基底 + 序號）。 */
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${(_n++).toString(36)}`;

/** 本地時間字串（zh-TW、24 小時制）。 */
export const now = () => new Date().toLocaleTimeString("zh-TW", { hour12: false });

/** Promise 化的 setTimeout。 */
export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** USD 成本 → 積分（×1000，四捨五入，下限 0）。對映模擬的扣點換算。 */
export const creditsForCost = (usd: number) => Math.max(0, Math.round(usd * 1000));
