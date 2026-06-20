/**
 * shared/currency.ts — 站內成本金流換算工具
 *
 * 設計原則：
 *  1. 站內模型 catalog 的成本一律以 USD 計（baseCostUsd / estimatedCostUsd）
 *  2. 使用者看到的是「平台積分（Points）」— 站內公定匯率 1 USD ≈ 100 pts
 *  3. 後台 / 報表 需要看到實際新台幣金額時，再走 USD → TWD 二次換算
 *
 * 匯率規則：
 *  - 預設 31.5 NTD/USD（接近近年中位）
 *  - 透過 USD_TO_TWD_RATE 環境變數覆寫（伺服器端讀取後回傳給前端）
 *  - 客戶端不直接讀 env，由 API 回傳當前 rate，避免兩端漂移
 */

/** 站內公定積分換算：1 USD = 100 pts */
export const POINTS_PER_USD = 100;

/** 預設 USD → NTD 匯率（環境變數未設定時的 fallback） */
export const DEFAULT_USD_TO_TWD_RATE = 31.5;

/** 環境變數可接受範圍 — 防呆，避免誤填 0 或天文數字導致報表全錯 */
const MIN_RATE = 1;
const MAX_RATE = 1000;

/**
 * 安全地把字串/未知值轉成有效匯率；超出範圍或非數值時退回 default。
 * 拆出來給 server 讀 env 用，pure，無 side-effect。
 */
export function parseUsdToTwdRate(
  raw: string | number | undefined | null,
  fallback: number = DEFAULT_USD_TO_TWD_RATE
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < MIN_RATE || n > MAX_RATE) return fallback;
  return n;
}

/**
 * AIDV-14：解析「實際生效的 TWD/USD 匯率」，含 env 來源優先序。
 *
 * 優先序（前者有效就用前者）：
 *   1. TWD_PER_USD（規格名，AIDV-14 新增）
 *   2. USD_TO_TWD_RATE（既有；teamCostSummary 等沿用，避免兩套漂移）
 *   3. DEFAULT_USD_TO_TWD_RATE（fallback 31.5）
 *
 * 每一層都經 parseUsdToTwdRate 防呆（1~1000 合法、否則往下退）。pure、無 side-effect，
 * 由 caller 傳入兩個 env 原值（server 端讀 process.env、不在 shared 直接碰 env，
 * 避免前端/測試耦合）。架構上保留日後改接即時匯率：只要把 resolved rate 換成即時
 * 來源即可，落帳/彙總已在當下凍結匯率寫稽核欄位。
 */
export function resolveTwdPerUsd(
  twdPerUsd: string | number | undefined | null,
  usdToTwdRate: string | number | undefined | null,
  fallback: number = DEFAULT_USD_TO_TWD_RATE
): number {
  // TWD_PER_USD 有合法值就用；否則退回 USD_TO_TWD_RATE；再否則 fallback。
  if (twdPerUsd !== undefined && twdPerUsd !== null && String(twdPerUsd).trim() !== "") {
    return parseUsdToTwdRate(twdPerUsd, parseUsdToTwdRate(usdToTwdRate, fallback));
  }
  return parseUsdToTwdRate(usdToTwdRate, fallback);
}

/** USD → 平台積分（四捨五入到整數，因為 DB 的 generationsDeducted 是 int） */
export function usdToPoints(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * POINTS_PER_USD);
}

/** USD → 新台幣（保留小數，由 caller 決定要 toFixed 幾位） */
export function usdToTwd(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return usd * rate;
}

/** 分母為 0 時回 0，避免 NaN 污染前端表格 */
export function safeSharePct(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
}

/** 格式化 NTD 顯示字串 — 用整數，因為日常觀察沒人在意小數點。 */
export function formatTwd(twd: number): string {
  if (!Number.isFinite(twd) || twd <= 0) return "NT$0";
  return `NT$${Math.round(twd).toLocaleString("zh-TW")}`;
}
