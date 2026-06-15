/* AI Director · 設計系統 — JS/TS token 參照與共用常數（rev. L1）
   色彩 token 的真實來源是 CSS 變數（tokens.css / tokens.oklch.css）。
   這裡只放「程式邏輯會用到」的常數，避免在 TSX 硬寫 hex。 */

/** 極簡 className 合併（不想引 clsx 時可用） */
export const cn = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

/** 生成 provider（B 案：hf 預設 / gemini 並列 / fal 回退 / mock 兜底） */
export type ProviderId = "hf" | "gemini" | "fal" | "mock";
export const PROVIDER_META: Record<ProviderId, { label: string; cost: number; note: string }> = {
  hf:     { label: "Hugging Face", cost: 0.012, note: "預設生成 provider" },
  gemini: { label: "Gemini 2.5",   cost: 0.020, note: "感知＋生成並列" },
  fal:    { label: "fal flux-pro",  cost: 0.040, note: "回退 provider" },
  mock:   { label: "Mock",          cost: 0.000, note: "兜底・零金鑰" },
};

/** 確認門狀態（唯一品管脊椎） */
export type GateState = "ready" | "partial" | "blocked";

/** 生成狀態機（鏡頭 / 素材） */
export type GenStatus = "idle" | "queued" | "generating" | "done" | "error" | "stale";

/** 角色來源分級 */
export type SourceGrade = "precise" | "estimate" | "unconfirmed";
export const GRADE_LABEL: Record<SourceGrade, string> = {
  precise: "✅ 精準",
  estimate: "⚠ 估算",
  unconfirmed: "⚠ 未確認",
};

/** 導演人格三色（對應 CSS --persona-*） */
export type Persona = "calm" | "creative" | "technical";
export const PERSONA = [
  { id: "calm",      zh: "平靜", en: "CALM" },
  { id: "creative",  zh: "創意", en: "CREATIVE" },
  { id: "technical", zh: "技術", en: "TECHNICAL" },
] as const;

/** 低積分門檻（<120 轉 bad；脊椎共用） */
export const LOW_CREDITS = 120;
/** 1 USD ≈ 1000 內部積分（與模擬一致；真實費率走 credits.pricingCatalog） */
export const creditsForCost = (usd: number) => Math.max(0, Math.round(usd * 1000));
