/**
 * catalogCostFallback.ts — AIDV-14 真實價後援（catalog → USD），補 usage.cost 缺口
 * ──────────────────────────────────────────────────────────────────────────
 * 問題：extractUsageCostUsd 只認 OpenRouter 風格 usage.cost；但 aiProxy 線上四家
 * 供應商（fal_ai / gemini / elevenlabs / suno）的回應都沒有 usage.cost，故 costUsd
 * 恆為 "0" → 歸屬/TWD 彙總對在用供應商全為 0（成本不可視）。
 *
 * 解法：當 extractUsageCostUsd 回 "0" 且供應商「非 OpenRouter」時，用 inferredModel
 * ＋（可得的）回應/請求 metadata 走 modelPricing.ts 的「真實單位價目錄」算出 USD 估價
 * 作為後援，並標 costSource：
 *   - "provider"：來源是上游回應實際計費（usage.cost）── 最準。
 *   - "catalog" ：來源是 modelPricing 目錄真實單位價（per-call / per-second / per-1k-char
 *                 / per-image）按可得用量推算 ── 次準，供成本可視，稽核時可區分。
 *
 * 「真實價非估算」如何成立：modelPricing 目錄的 basePoints / pointsPerSecond /
 * pointsPer1kChars / pointsPerImage 是「對齊各供應商真實 API 單位價」訂定的（baseCostUsd
 * 註解即真實成本，1 USD = 100 pts）。此處用的是「目錄真實單位價 × 實際用量」，不是 token
 * 黑箱猜測；且嚴格標 costSource=catalog 與 provider 區隔，稽核可分辨來源、不會把目錄價
 * 誤當成上游實際計費。
 *
 * HARD SAFETY：
 *   - 純函式：不碰 DB、不碰請求路徑（呼叫端在 res.send 之後的 setImmediate 內呼叫）、
 *     永不 throw、不確定一律回 "0"／null（沿用 usageCost / ledger 的契約）。
 *   - 不改既有扣款/餘額；只在 costUsd 已是 "0"（無上游真實價）時才提供後援值。
 *   - OpenRouter 供應商不走後援（其 usage.cost 才是真相），避免雙重來源衝突。
 */
import { POINTS_PER_USD } from "../../../shared/currency";
import { estimatePoints, getModelPricing } from "../modelPricing";

/** 成本數字的來源標記（稽核用，寫入 ledger meta.costSource）。 */
export type CostSource = "provider" | "catalog";

/** 後援推算可吃的（best-effort）用量訊號。拿不到就用 base（純啟動價）。 */
export interface CatalogUsageSignals {
  /** 影片/音頻時長（秒）。 */
  durationSec?: number;
  /** 文字字符數（TTS / LLM）。 */
  charCount?: number;
  /** 圖片張數（批次）。 */
  imageCount?: number;
  /** 訓練步驟數。 */
  trainingSteps?: number;
}

/** DECIMAL(12,6) 上限與 scale（與 usageCost / ledger 同約定）。 */
const MAX_DECIMAL_12_6 = 999999.999999;
const SCALE = 6;

/**
 * 把任意候選值正規化成合法的 DECIMAL(12,6) 定點字串（≥0，否則 "0"）。
 * 與 usageCost.normalizeCostUsd 同契約，獨立一份避免跨模組耦合（純函式、可單測）。
 */
function toCostUsdString(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n > MAX_DECIMAL_12_6) n = MAX_DECIMAL_12_6;
  const fixed = n.toFixed(SCALE);
  if (Number(fixed) === 0) return "0";
  return fixed;
}

/** OpenRouter 風格供應商（其 usage.cost 為真相，不走 catalog 後援）。 */
function isOpenRouterStyleProvider(provider: string | null | undefined): boolean {
  if (!provider) return false;
  return provider.trim().toLowerCase() === "openrouter";
}

/**
 * pure：用 modelPricing 目錄真實單位價，把可得用量訊號換算成 USD 字串。
 * 目錄無此 modelId、或 modelId 空 → "0"（誠實留空，不亂編）。
 */
export function catalogCostUsd(
  modelId: string | null | undefined,
  signals: CatalogUsageSignals = {}
): string {
  try {
    const id = typeof modelId === "string" ? modelId.trim() : "";
    if (id === "") return "0";
    // 目錄沒有這個 model → 不後援（estimatePoints 對未知 model 會回固定 5pts，
    // 那是「使用者計費保底」非「真實成本」，不可拿來當真實價，故這裡先檢查目錄）。
    if (!getModelPricing(id)) return "0";

    const estimate = estimatePoints(id, {
      durationSec: signals.durationSec,
      charCount: signals.charCount,
      imageCount: signals.imageCount,
      trainingSteps: signals.trainingSteps,
    });
    const usd = estimate.totalPoints / POINTS_PER_USD;
    return toCostUsdString(usd);
  } catch {
    return "0";
  }
}

export interface ResolvedCostUsd {
  /** 合法 DECIMAL(12,6) 字串；無法得出真實/目錄價 → "0"。 */
  costUsd: string;
  /** 成本來源；costUsd==="0"（無任何來源）時為 null。 */
  costSource: CostSource | null;
}

/**
 * pure：決定要落帳的 costUsd 與其來源標記。
 *
 *   1. providerCostUsd（extractUsageCostUsd 的結果）非 "0" → 直接用，costSource="provider"。
 *   2. 否則，若供應商非 OpenRouter 且有 inferredModel 命中目錄 → 用 catalog 後援，
 *      costSource="catalog"。
 *   3. 都拿不到 → "0" / null（誠實留空，buildAttributionEntries 會略過不落 $0 髒列）。
 *
 * 永不 throw。呼叫端在 res.send 之後（請求熱路徑外）呼叫。
 */
export function resolveCostUsdWithCatalog(params: {
  providerCostUsd: string;
  provider: string | null | undefined;
  modelId: string | null | undefined;
  signals?: CatalogUsageSignals;
}): ResolvedCostUsd {
  const provider = params.providerCostUsd;
  // 1. 上游真實計費優先。
  if (provider != null && provider !== "0" && Number(provider) > 0) {
    return { costUsd: provider, costSource: "provider" };
  }
  // 2. 非 OpenRouter 供應商 → catalog 真實單位價後援。
  if (!isOpenRouterStyleProvider(params.provider)) {
    const fallback = catalogCostUsd(params.modelId, params.signals);
    if (fallback !== "0") return { costUsd: fallback, costSource: "catalog" };
  }
  // 3. 都沒有 → 誠實留空。
  return { costUsd: "0", costSource: null };
}

/**
 * pure：從（aiProxy 已有的）請求 body 物件 best-effort 撈出用量訊號，餵 catalog 後援。
 * 拿不到就留 undefined（estimatePoints 退回 base 純啟動價）。永不 throw。
 *
 * 刻意保守：只認常見、明確的數值欄位名，避免把無關欄位誤當用量灌大成本。
 */
export function extractCatalogSignals(
  body: Record<string, unknown> | null | undefined
): CatalogUsageSignals {
  const out: CatalogUsageSignals = {};
  if (!body || typeof body !== "object") return out;
  try {
    const num = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return undefined;
    };

    // 時長（秒）：duration / duration_seconds / durationSec。
    out.durationSec =
      num(body.duration_seconds) ?? num(body.durationSec) ?? num(body.duration);

    // 字符數：明確 charCount，否則由 text / input / prompt 字串長度推。
    const explicitChars = num(body.charCount) ?? num(body.char_count);
    if (explicitChars !== undefined) {
      out.charCount = explicitChars;
    } else {
      const textField =
        (typeof body.text === "string" && body.text) ||
        (typeof body.input === "string" && body.input) ||
        "";
      if (textField.length > 0) out.charCount = textField.length;
    }

    // 圖片張數：num_images / numImages / n / imageCount。
    out.imageCount =
      num(body.num_images) ??
      num(body.numImages) ??
      num(body.imageCount) ??
      num(body.n);

    // 訓練步驟數。
    out.trainingSteps = num(body.trainingSteps) ?? num(body.steps);
  } catch {
    return out;
  }
  return out;
}
