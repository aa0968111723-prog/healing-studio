// ============================================================================
// config/promptVaultFlags.ts — U-9 共用 PromptVault 採用旗標（新增檔；只加不改）
// ----------------------------------------------------------------------------
// 慣例對齊 videoFlags.ts / featureFlags.ts：讀 import.meta.env、預設安全 OFF、
// SSR/測試以 try 包覆。為什麼另開一檔：跨殼（/video + /social）共用，且 P0 既有
// featureFlags.ts「已驗證、已套用」，採「只加不改」收斂套用衝突面。
//
// 旗標階層：PromptVault 採用永遠在 ENABLE_4SHELL 之下（shell 未掛載則程式不可達）。
//   ENABLE_PROMPT_VAULT=OFF（預設）→ 殼內不掛載 PromptVaultPanel / SaveToVaultControl，
//                                    零行為改變保證成立。
//   ENABLE_PROMPT_VAULT=ON         → /video、/social 顯示「存庫→重用」閉環（接真實
//                                    promptLibrary.* tRPC procedure）。
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
function readFlag(key: string, fallback = false): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用 → 用 fallback */
  }
  return fallback;
}

/**
 * 共用 PromptVault「生成→存庫→重用」採用總開關。**預設 OFF**（沒設＝照舊）。
 * 對應 .env：VITE_ENABLE_PROMPT_VAULT=1
 */
export const ENABLE_PROMPT_VAULT: boolean = readFlag("VITE_ENABLE_PROMPT_VAULT", false);
