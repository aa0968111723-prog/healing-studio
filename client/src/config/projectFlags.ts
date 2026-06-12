// ============================================================================
// config/projectFlags.ts — Wave 1 Project SSOT 旗標（新增檔；不改 P0 featureFlags.ts）
// ----------------------------------------------------------------------------
// 為什麼另開一檔而非改 P0 的 config/featureFlags.ts / videoFlags.ts：
//   - 沿用既有慣例（videoFlags.ts 先例）：P0 既有旗標檔一行不動，新能力的旗標收在
//     自己的檔，降低套用衝突面；讀取慣例完全一致（import.meta.env、預設安全、try 包覆）。
//
// 旗標階層（重要）：Project SSOT 永遠在 ENABLE_4SHELL 之下。
//   ENABLE_4SHELL=OFF（線上預設）→ ENABLE_PROJECT_SSOT 恆為 false
//     → ProjectsContext 走既有 MOCK_PROJECTS 路徑，行為與線上完全相同（零行為改變）。
//   ENABLE_4SHELL=ON → 看 VITE_ENABLE_PROJECT_SSOT（預設 ON）：
//     ON  → ProjectsContext 改掛真實 creativeProject.* tRPC procedure（單一真實來源；
//           active id 委派給 WorldContext，不再有第二套 localStorage 暫存）。
//     OFF → 除錯逃生口，退回 mock 路徑。
// ============================================================================
import { ENABLE_4SHELL } from "@/config/featureFlags";

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
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) return truthy(env[key]);
  } catch {
    /* import.meta 不可用 → 用 fallback */
  }
  return fallback;
}

/**
 * Project SSOT 總開關。**預設 ON，但只在 ENABLE_4SHELL=ON 時才可達**（見上方階層說明）。
 * 設 .env：VITE_ENABLE_PROJECT_SSOT=0 可在 4-shell 開啟下退回 MOCK_PROJECTS（除錯逃生口）。
 */
export const ENABLE_PROJECT_SSOT: boolean =
  ENABLE_4SHELL && readFlag("VITE_ENABLE_PROJECT_SSOT", true);
