// ============================================================================
// promptVault/promptVaultAdoptionFlags.ts — U-9 採用閉環旗標（本卡新增·只加不改）
// ----------------------------------------------------------------------------
// 為什麼另開一檔（而非改 config/promptVaultFlags.ts）：
//   · config/promptVaultFlags.ts 的 ENABLE_PROMPT_VAULT 是「殼是否掛載 PromptVault」
//     的總開關，由 /video /social 殼擁有並已驗證；本卡不得改它（隔離鐵則）。
//   · 本檔放本卡擁有的 *採用閉環* 子旗標，治理「生成→存庫→重用」單一可重用元件
//     （PromptVaultAdoption）是否以閉環呈現。零後端、預設安全、可一鍵回滾。
//
// 旗標階層（永遠在總開關之下；總開關 OFF 則本旗標不可達）：
//   ENABLE_PROMPT_VAULT=OFF（殼層預設）   → 元件根本不掛載，零行為改變。
//   ENABLE_PROMPT_VAULT=ON + ADOPTION=ON（本檔預設）→ 顯示「存庫＋瀏覽重用」完整閉環。
//   ENABLE_PROMPT_VAULT=ON + ADOPTION=OFF          → 殼可只掛單側（存或瀏覽），閉環收起。
//
// 慣例對齊 config/promptVaultFlags.ts / learnFlags.ts：readFlag(import.meta.env)、
// 真值字串正規化、SSR/測試以 try 包覆、預設安全。
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
export function readFlag(key: string, fallback = false): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用 → 用 fallback */
  }
  return fallback;
}

/**
 * 採用閉環子旗標。**預設 ON**（U-9 的重點即把「存庫→重用」做成完整閉環）。
 * 因永遠受總開關 ENABLE_PROMPT_VAULT 節制，預設 ON 不破壞「零後端可回滾」：
 * 總開關 OFF 時本旗標不可達；總開關 ON 但本旗標 OFF 時閉環收起、退回單側採用。
 * 對應 .env：VITE_PROMPT_VAULT_ADOPTION=0 可收起閉環。
 */
export const PROMPT_VAULT_ADOPTION: boolean = readFlag("VITE_PROMPT_VAULT_ADOPTION", true);
