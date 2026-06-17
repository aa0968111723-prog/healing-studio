// ============================================================================
// components/home/landingFlags.ts — 首頁 landing 門面視覺旗標（建置時 Vite env）
// ----------------------------------------------------------------------------
// AIDV-119 / U-10：首頁 landing 視覺實裝（門面 KV／icon set／calm orb）。
// 沿用 P0 featureFlags.ts / flowTvFlags.ts 的 readFlag 慣例（讀 import.meta.env，
// 預設安全值）。零後端、可回滾、純前端唯讀。
//
// 線上開啟政策（2026-06-16 Bruce 拍板）：視覺/UI 採用片預設 ON、線上即有變動，
// 但須保留秒回滾退路 —— env（Railway `VITE_LANDING_KV=0`）即可關閉整塊門面，
// 等同未實裝（零回歸）。
//   - VITE_LANDING_KV 未設 → 預設 ON（門面 landing 顯示）。
//   - VITE_LANDING_KV=0 / false / off → 隱藏整塊，秒回滾。
// ============================================================================

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }
  return false;
}

function falsy(v: unknown): boolean {
  if (v === false) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "0" || s === "false" || s === "off" || s === "no";
  }
  return false;
}

/**
 * 讀建置時旗標。預設 ON 的旗標：只有「明確關閉值」才關，未設＝採 fallback。
 * 預設 OFF 的旗標：只有「明確開啟值」才開。
 */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env && key in env) {
      const raw = env[key];
      if (fallback) return !falsy(raw); // 預設 ON：只有明確 falsy 才關
      return truthy(raw); //               預設 OFF：只有明確 truthy 才開
    }
  } catch {
    /* import.meta 不可用 → fallback */
  }
  return fallback;
}

/**
 * 首頁 landing 門面總開關。預設 ON（線上即有變動），可由 env 秒回滾。
 * 對應 .env：VITE_LANDING_KV=0 隱藏整塊門面。
 */
export const LANDING_KV_ENABLED: boolean = readFlag("VITE_LANDING_KV", true);

/** calm orb 平靜光球是否顯示（隸屬門面之下；單獨關閉動效元件用）。預設 ON。 */
export const LANDING_CALM_ORB_ENABLED: boolean = readFlag("VITE_LANDING_CALM_ORB", true);
