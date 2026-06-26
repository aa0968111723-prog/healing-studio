/* AI Director · 設計系統 — atom 元件庫（綁變數）
 * U-SOP-3（AIDV-142）：統一 atom 入口＋補齊 primitives 缺的變體。
 * 範圍：btn / tag / pill / dot / meter / kbd 六類 design-token-bound 原子。
 *
 * 設計鐵則
 *  · 亮色暖光；色彩／圓角／陰影一律走 CSS 變數（.aidv-kit scope 解析），不寫死 hex。
 *  · 能重用 primitives 就 re-export／薄包裝其變體，不重造輪子。
 *  · a11y：icon-only 必帶 aria-label、焦點環、對比 ≥4.5；全部可組合、有 TypeScript 型別。
 *  · 元件須用在 <AidvKit>（.aidv-kit scope）內，token 才解析成設計套件原義。
 * rev. U-SOP-3 · 2026-06-17 */
import * as React from "react";
import { cn } from "./tokens";
import { Button, Pill, Tag as TagBase, Kbd, Meter } from "./primitives";

/* ──────────────────────────────────────────────────────────────
 * 共用狀態語氣（SSOT）— ok/warn/bad/info/mute 對應 token 色。
 * dot / pill / meter 等狀態原子共用，避免各處重複硬綁。
 * ────────────────────────────────────────────────────────────── */
export type StatusTone = "ok" | "warn" | "bad" | "info" | "mute";

/** 各語氣的「實心前景色」變數（用於 dot 圓點、meter 填色等）。 */
const TONE_FG: Record<StatusTone, string> = {
  ok:   "bg-[var(--ok)]",
  warn: "bg-[var(--warn)]",
  bad:  "bg-[var(--bad)]",
  info: "bg-[var(--info)]",
  mute: "bg-[var(--muted-2)]",
};

/** 各語氣的「淡底環」變數（用於 dot 外環光暈）。 */
const TONE_RING: Record<StatusTone, string> = {
  ok:   "ring-[var(--ok-tint)]",
  warn: "ring-[var(--warn-tint)]",
  bad:  "ring-[var(--bad-tint)]",
  info: "ring-[var(--info-tint)]",
  mute: "ring-[var(--surface-2)]",
};

/* ──────────────────────────────────────────────────────────────
 * btn —— 重用 primitives Button（default/primary/gold/ghost/danger ×
 *        md/sm/xs），統一以 Btn 入口匯出，並補 icon-only 變體 IconBtn。
 * ────────────────────────────────────────────────────────────── */

/** 文字按鈕：primitives Button 的 design-kit atom 別名入口。 */
export const Btn = Button;

const ICON_BTN_SIZE = {
  md: "size-[38px] rounded-[12px] text-[15px]",
  sm: "size-8 rounded-[10px] text-[13px]",
  xs: "size-[26px] rounded-[9px] text-[12px]",
} as const;

/**
 * 純圖示按鈕（正方形）。a11y：強制 `aria-label`（型別必填）。
 * 沿用 Button 的語氣變體與焦點環，但鎖定正方形尺寸、無內距文字。
 */
export function IconBtn({
  variant = "ghost",
  size = "sm",
  className,
  children,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: keyof typeof ICON_BTN_SIZE;
  /** icon-only 必填，供螢幕報讀器朗讀動作語意。 */
  "aria-label": string;
}) {
  return (
    <Button
      variant={variant}
      className={cn("!p-0 justify-center", ICON_BTN_SIZE[size], className)}
      {...p}
    >
      {children}
    </Button>
  );
}

/* ──────────────────────────────────────────────────────────────
 * pill —— 直接 re-export primitives Pill（ok/warn/bad/info/mute/default）。
 * ────────────────────────────────────────────────────────────── */
export { Pill } from "./primitives";

/* ──────────────────────────────────────────────────────────────
 * tag —— primitives Tag（mono 標籤）＋補語氣 ToneTag 變體。
 * ────────────────────────────────────────────────────────────── */
export const Tag = TagBase;

const TONE_TAG: Record<StatusTone | "default", string> = {
  ok:      "text-[var(--ok)] border-[rgba(92,138,85,.28)] bg-[var(--ok-tint)]",
  warn:    "text-[var(--gold-deep)] border-[rgba(200,146,47,.3)] bg-[var(--warn-tint)]",
  bad:     "text-[var(--bad)] border-[rgba(199,73,58,.28)] bg-[var(--bad-tint)]",
  info:    "text-[var(--info)] border-[rgba(92,134,176,.28)] bg-[var(--info-tint)]",
  mute:    "text-[var(--muted)] border-[var(--line)] bg-[var(--surface-2)]",
  default: "text-[var(--text-soft)] border-[var(--line)] bg-[var(--surface-2)]",
};

/**
 * 語氣標籤（mono 等寬、可帶語氣色）。Tag 偏「中性 metadata 籤」，
 * ToneTag 偏「帶狀態色的分類籤」；兩者皆可組合於卡片角落。
 */
export function ToneTag({
  tone = "default",
  className,
  children,
}: {
  tone?: StatusTone | "default";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono text-[10px] tracking-[.05em] px-2 py-[2px] rounded-[8px] border",
        TONE_TAG[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
 * dot —— 狀態小圓點（primitives 缺）。ok/warn/bad/info/mute 對應 token 色，
 *        可選脈動光暈（pulse）＋光環（ring）＋三種尺寸。icon-only → 強制 label。
 * ────────────────────────────────────────────────────────────── */
const DOT_SIZE = { sm: "size-[6px]", md: "size-[8px]", lg: "size-[10px]" } as const;

export function Dot({
  tone = "mute",
  size = "md",
  ring = false,
  pulse = false,
  label,
  className,
}: {
  tone?: StatusTone;
  size?: keyof typeof DOT_SIZE;
  /** 外環淡色光暈（強調當前狀態）。 */
  ring?: boolean;
  /** 脈動動畫（如「生成中」等進行態）。 */
  pulse?: boolean;
  /**
   * 無障礙標籤。給定時以 role="img" 朗讀狀態語意；
   * 省略時視為純裝飾（aria-hidden），由相鄰文字承載語意。
   */
  label?: string;
  className?: string;
}) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-block flex-none rounded-full align-middle",
        DOT_SIZE[size],
        TONE_FG[tone],
        ring && cn("ring-2", TONE_RING[tone]),
        pulse && "motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

/* ──────────────────────────────────────────────────────────────
 * meter —— primitives Meter（漸層進度條）＋補語氣／標籤變體 MeterBar。
 * ────────────────────────────────────────────────────────────── */
export { Meter } from "./primitives";

const TONE_FILL: Record<StatusTone | "brand", string> = {
  brand: "bg-[linear-gradient(90deg,var(--clay),var(--gold))]",
  ok:    "bg-[var(--ok)]",
  warn:  "bg-[var(--warn)]",
  bad:   "bg-[var(--bad)]",
  info:  "bg-[var(--info)]",
  mute:  "bg-[var(--muted-2)]",
};

/**
 * 進度／量表條，支援語氣填色（brand 漸層為預設）＋可選文字標籤。
 * a11y：role="progressbar" ＋ aria-valuenow/min/max；有標籤時 aria-label 帶語意。
 */
export function MeterBar({
  pct,
  tone = "brand",
  label,
  showValue = false,
  className,
}: {
  pct: number;
  tone?: StatusTone | "brand";
  label?: string;
  /** 在右側顯示百分比數字。 */
  showValue?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(v)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 flex-1 rounded-md bg-[var(--surface-2)] overflow-hidden border border-[var(--hair)]"
      >
        <i
          className={cn(
            "block h-full rounded-md transition-[width] duration-[.6s] ease-[cubic-bezier(.16,1,.3,1)]",
            TONE_FILL[tone],
          )}
          style={{ width: `${v}%` }}
        />
      </div>
      {showValue && (
        <span className="font-mono text-[11px] tabular-nums text-[var(--muted)] flex-none">
          {Math.round(v)}%
        </span>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * kbd —— 直接 re-export primitives Kbd（鍵帽）；補多鍵組合 KbdCombo。
 * ────────────────────────────────────────────────────────────── */
export { Kbd } from "./primitives";

/**
 * 鍵盤組合（如 ⌘ + K）。以 `+` 分隔多顆鍵帽，視覺一致。
 * 接受字串陣列或單一字串（後者以 "+" 自動切分）。
 */
export function KbdCombo({
  keys,
  className,
}: {
  keys: string | string[];
  className?: string;
}) {
  const list = Array.isArray(keys) ? keys : keys.split("+").map((k) => k.trim());
  return (
    <span className={cn("inline-flex items-center gap-[3px]", className)}>
      {list.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-[10px] text-[var(--muted-2)]">+</span>}
          <Kbd>{k}</Kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
 * 統一 atom 入口：以單一物件聚合，方便 `import { Atoms } from …` 取用。
 * （個別具名匯出仍可獨立 tree-shake。）
 * ────────────────────────────────────────────────────────────── */
export const Atoms = {
  Btn,
  IconBtn,
  Pill,
  Tag,
  ToneTag,
  Dot,
  Meter,
  MeterBar,
  Kbd,
  KbdCombo,
} as const;
