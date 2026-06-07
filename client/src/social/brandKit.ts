// ============================================================================
// social/brandKit.ts — 品牌身份（Brand Kit）型別 + Tier-0 持久化 + 鎖定狀態機
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §2（品牌鎖定／一致性）。
//
// 【Tier-0 · 零新表】（設計 §2.3 / §5.1，架構 ② 預設）：品牌身份不建新表，
//   一筆 `block_combos`（payload JSON 塞 logo/色/字/voice）＋標籤 `kind:'brand'`；
//   鎖定閘門落 `consistency_vault`（兩條創作線共用品管脊椎）。本檔提供：
//     brandKitToBlockCombo() / blockComboFromBrandKit()  ← Tier-0 (de)serialize
//   PromptBlock（spine/types）只有 combo|custom 兩種 kind，故 Tier-0 以「label 前綴
//   哨符 + text 內嵌 JSON」round-trip，待 Tier-1 `brand_kits` 表時整段替換、UI 不改。
//
// 【鎖定狀態機】對映 /video 角色鎖定（設計 §2.2）：draft → defined → locked；
//   閘門旗標：missing_logo / missing_palette / missing_font / low_contrast(未達 AA) / superseded。
//   品牌 `locked` 才能進批量出圖／匯出／發佈。改版 → version++ → 下游貼文標 stale（§2.4）。
//
// 純型別 + 純函式：無 React、無網路、無副作用，前後端與測試皆可 import。
// ============================================================================
import type { PromptBlock } from "@/spine/types";

export type BrandLockState = "draft" | "defined" | "locked";
export type PaletteRole = "primary" | "secondary" | "accent" | "neutral";
export type EmojiPolicy = "none" | "sparing" | "liberal";

export interface BrandSwatch {
  role: PaletteRole;
  hex: string; // #RRGGBB
}

export interface BrandTypography {
  heading: { family: string; weight: number };
  body: { family: string; weight: number };
  /** 字級階（px，由大到小：H1/H2/Body/Caption…）。 */
  scale: number[];
}

export interface BrandVoice {
  tone: string; // 「溫暖療癒 / 專業 / 俏皮」
  preferredWords: string[];
  bannedWords: string[];
  emojiPolicy: EmojiPolicy;
}

export interface BrandLayoutRules {
  /** 安全邊距（佔短邊比例 0–0.5）。 */
  safeMargin: number;
  /** logo 最小尺寸（佔短邊比例）。 */
  logoMinSize: number;
  /** 對齊網格欄數。 */
  grid: number;
}

export interface BrandLogoRefs {
  /** 指向 digital_asset_library 的資產 id（Tier-0 可為佔位字串/URL）。 */
  primary?: string;
  mono?: string;
  inverse?: string;
}

export interface BrandKit {
  id: string;
  projectId: string | null;
  name: string;
  logoRefs: BrandLogoRefs;
  palette: BrandSwatch[];
  typography: BrandTypography;
  voice: BrandVoice;
  layoutRules: BrandLayoutRules;
  lockState: BrandLockState;
  /** 改版號（unlock → ++，下游引用此版的貼文標 stale）。 */
  version: number;
}

export type BrandGateFlag =
  | "missing_logo"
  | "missing_palette"
  | "missing_font"
  | "low_contrast"
  | "superseded";

export interface BrandGate {
  /** ready=可鎖/可發 · partial=可單張試做不可批量 · blocked=不可進生成。 */
  state: "ready" | "partial" | "blocked";
  flags: BrandGateFlag[];
  /** 可否進入批量出圖／匯出／發佈（＝品牌 locked 的硬條件預檢）。 */
  canBatch: boolean;
}

// ── 預設品牌（Tier-0 fixture「療癒誌」，設計 §5.5）────────────────────────────

export const DEFAULT_BRAND_KIT: BrandKit = {
  id: "brand_healingzine",
  projectId: null,
  name: "療癒誌",
  logoRefs: { primary: "asset:logo_primary", mono: "asset:logo_mono", inverse: "asset:logo_inverse" },
  palette: [
    { role: "primary", hex: "#04122B" },
    { role: "secondary", hex: "#0D1B2A" },
    { role: "accent", hex: "#E9C46A" },
    { role: "neutral", hex: "#F4F1EA" },
  ],
  typography: {
    heading: { family: "'Noto Serif TC', serif", weight: 700 },
    body: { family: "'Noto Sans TC', sans-serif", weight: 400 },
    scale: [88, 56, 34, 22, 16],
  },
  voice: {
    tone: "溫暖療癒",
    preferredWords: ["放下", "覺察", "自在", "陪伴"],
    bannedWords: ["焦慮販賣", "速成"],
    emojiPolicy: "sparing",
  },
  layoutRules: { safeMargin: 0.08, logoMinSize: 0.08, grid: 12 },
  lockState: "defined",
  version: 1,
};

// ── WCAG 對比（low_contrast 閘門用，設計 §2.2 / §a11y）────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  // 支援 3 碼簡寫（#abc → #aabbcc）與 6 碼。
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 對比比值（1–21）。輸入非法 hex 時回 0（視同最差）。 */
export function contrastRatio(fg: string, bg: string): number {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return 0;
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 是否達 WCAG AA（一般文字 4.5、大字 3.0）。 */
export function meetsAA(ratio: number, large = false): boolean {
  return ratio >= (large ? 3 : 4.5);
}

// ── 取色助手（composeLayout 與 UI 共用）──────────────────────────────────────

export function swatch(kit: BrandKit, role: PaletteRole): string | undefined {
  return kit.palette.find((s) => s.role === role)?.hex;
}

/** 文字色：取與底色對比最佳的品牌色（達 AA 優先；否則退黑/白）。 */
export function bestTextColor(kit: BrandKit, bg: string): string {
  const candidates = [swatch(kit, "neutral"), "#FFFFFF", swatch(kit, "accent"), "#0B0B0B"]
    .filter((c): c is string => !!c);
  let best = candidates[0] ?? "#FFFFFF";
  let bestRatio = 0;
  for (const c of candidates) {
    const r = contrastRatio(c, bg);
    if (r > bestRatio) {
      bestRatio = r;
      best = c;
    }
  }
  return best;
}

// ── 鎖定狀態機（設計 §2.2）────────────────────────────────────────────────────

/** 評估品牌閘門：缺漏旗標 + 是否可批量（locked 的硬前提預檢）。 */
export function evaluateBrandGate(kit: BrandKit): BrandGate {
  const flags: BrandGateFlag[] = [];
  if (!kit.logoRefs.primary) flags.push("missing_logo");
  if (kit.palette.length < 2) flags.push("missing_palette");
  if (!kit.typography.heading.family || !kit.typography.body.family) flags.push("missing_font");

  // 對比：主色 vs 中性（標題層常用組合）未達 AA-large → low_contrast（可覆寫，§2.2）。
  const primary = swatch(kit, "primary");
  const neutral = swatch(kit, "neutral") ?? "#FFFFFF";
  if (primary && !meetsAA(contrastRatio(neutral, primary), true)) flags.push("low_contrast");

  const blocking = flags.filter((f) => f === "missing_logo" || f === "missing_palette" || f === "missing_font");
  const state: BrandGate["state"] = blocking.length ? "blocked" : flags.length ? "partial" : "ready";
  return { state, flags, canBatch: state === "ready" && kit.lockState === "locked" };
}

/** 可否鎖定（無 blocking 旗標即可；low_contrast 為 WARN 可覆寫，不擋鎖）。 */
export function canLock(kit: BrandKit): boolean {
  return evaluateBrandGate(kit).state !== "blocked";
}

/** 鎖定（draft/defined → locked）。version 不變；不可鎖時原樣回傳。 */
export function lockBrand(kit: BrandKit): BrandKit {
  if (!canLock(kit)) return kit;
  return { ...kit, lockState: "locked" };
}

/** 解鎖（locked → defined）並 version++（觸發下游貼文 stale，§2.4）。 */
export function unlockBrand(kit: BrandKit): BrandKit {
  if (kit.lockState !== "locked") return kit;
  return { ...kit, lockState: "defined", version: kit.version + 1 };
}

// ── Tier-0 持久化：BrandKit ⇄ block_combos（設計 §2.3 / §5.1）────────────────

const BRAND_SENTINEL = "@brand-kit:v1"; // label 前綴哨符，round-trip 識別用

/** BrandKit → 一筆 block_combos（Tier-0；payload 內嵌 JSON、kind 標 'combo' 但 label 帶哨符）。 */
export function brandKitToBlockCombo(kit: BrandKit): PromptBlock {
  return {
    id: kit.id,
    label: `${BRAND_SENTINEL} ${kit.name}`,
    text: JSON.stringify(kit),
    kind: "combo", // spine/types 僅 combo|custom；哨符在 label 區分「品牌」用途
    uses: kit.version,
  };
}

/** block_combos → BrandKit（非品牌哨符或解析失敗回 null，呼叫端略過）。 */
export function blockComboToBrandKit(pb: PromptBlock): BrandKit | null {
  if (!pb.label?.startsWith(BRAND_SENTINEL)) return null;
  try {
    const parsed = JSON.parse(pb.text) as BrandKit;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.palette)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 判斷一筆 block_combos 是否為品牌（給「風格庫 vs 品牌庫」分流，§3.3）。 */
export function isBrandCombo(pb: PromptBlock): boolean {
  return !!pb.label?.startsWith(BRAND_SENTINEL);
}
