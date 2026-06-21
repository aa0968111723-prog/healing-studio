// ============================================================================
// adapters/costTier.ts — 成本層級單一真相源（AIDV-160 成本同意原則）
// ----------------------------------------------------------------------------
// 創作者信任紅線：**免費/使用者選定的引擎，絕不無聲自動跨界回退到「付費」引擎並扣點**。
//
// 這裡定義 provider（client 端粗粒度路由概念 hf|gemini|fal|mock）的成本層級，
// 供「成本層級感知 fallback」（generation.trpc.ts）與「選擇器標示」（ProviderPanel /
// GenerationConsole）共用同一份定義，避免兩邊分叉。
//
//   mock         → "free"  （$0、demo/離線兜底；prod 無 FAL_API_KEY 路由、無 fal.ai model id → 不可用）
//   hf|gemini|fal → "paid" （真實付費 provider，0.012–0.030+/張，會扣點）
//
// 規則（成本同意原則）：
//   - 免費引擎只回退到其他免費引擎；跨越「免費 → 付費」邊界需使用者明確動作（預設：不扣費，直接回明確錯誤）。
//   - 同付費層之間的回退（hf↔gemini↔fal）維持既有便利，行為不變。
//
// 旗標 ENABLE_COST_CONSENT_GUARD 預設 ON（安全側 = 不偷扣）。可用
//   VITE_ENABLE_COST_CONSENT_GUARD=0 關閉回到舊行為（回滾退路；不需改碼）。
// ============================================================================
import type { ProviderId } from "@/spine/types";

export type CostTier = "free" | "paid";

/** provider → 成本層級。新增 provider 時務必在此登記其層級（預設視為 paid，最安全）。 */
export const PROVIDER_COST_TIER: Record<ProviderId, CostTier> = {
  mock: "free",
  hf: "paid",
  gemini: "paid",
  fal: "paid",
};

/** 取得某 provider 的成本層級；未知 provider 一律當成 "paid"（最保守，避免誤判成免費而偷扣）。 */
export function providerCostTier(provider: ProviderId): CostTier {
  return PROVIDER_COST_TIER[provider] ?? "paid";
}

export function isFreeProvider(provider: ProviderId): boolean {
  return providerCostTier(provider) === "free";
}

export function isPaidProvider(provider: ProviderId): boolean {
  return providerCostTier(provider) === "paid";
}

// ─── 旗標：成本同意守門 ──────────────────────────────────────────────────────

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
    /* import.meta 不可用（SSR/測試）→ 用 fallback */
  }
  return fallback;
}

/**
 * 成本同意守門總開關。**預設 ON（安全側）**：免費引擎絕不無聲跨界回退到付費引擎扣點。
 * 關閉（VITE_ENABLE_COST_CONSENT_GUARD=0）= 回到舊的「跨層全鏈回退」行為（回滾退路）。
 *
 * 注意：fail 方向永遠是「不扣費」——守門開時，免費引擎不可用且無同層替代 →
 * 直接回明確錯誤、不生成、不扣點，而非偷偷換付費 provider。
 */
export const ENABLE_COST_CONSENT_GUARD: boolean = readFlag(
  "VITE_ENABLE_COST_CONSENT_GUARD",
  true,
);

// ─── mock provider 在 prod 的可用性 ─────────────────────────────────────────

/**
 * mock 在 prod 是否可用。mock = demo/離線兜底：prod 無 FAL_API_KEY 路由、未配置 fal.ai
 * model id，dispatchFalQueueTask 不認得 provider=mock → 伺服器 provider-not-found。
 * 因此：
 *   - 非 prod（dev/test/demo）→ 可用（離線兜底、零金鑰）。
 *   - prod → 預設不可用；可用 VITE_ALLOW_MOCK_PROVIDER=1 顯式打開（如刻意做 demo 部署）。
 *
 * 選擇器據此 disable/標示 mock，不顯示「可選卻偷換」。
 */
export function isMockProviderAvailable(): boolean {
  try {
    const env = (import.meta as unknown as {
      env?: { PROD?: boolean; [k: string]: unknown };
    }).env;
    if (!env) return true; // 無 env（SSR/測試）→ 視為可用，不誤擋
    const isProd = env.PROD === true;
    if (!isProd) return true; // dev / test / demo → mock 可用
    return readFlag("VITE_ALLOW_MOCK_PROVIDER", false); // prod 預設關，顯式才開
  } catch {
    return true;
  }
}
