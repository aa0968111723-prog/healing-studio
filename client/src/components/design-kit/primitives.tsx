/* AI Director · 設計系統 — 基礎元件（React 19 + Tailwind 4，可貼回真實 repo）
   · 色彩/圓角/陰影/動效一律走 CSS 變數（見 tokens.oklch.css），不寫死 hex。
   · 與 theme.css 的 class 名稱對齊（.btn/.pill/.card…）；此處用 Tailwind 任意值
     直接綁變數，方便在 shadcn/Tailwind repo 內貼用。
   · rev. L1 · 2026-06-06 */
import * as React from "react";
import { cn } from "./tokens";

/* ---------------- Button ---------------- */
type BtnVariant = "default" | "primary" | "gold" | "ghost" | "danger";
type BtnSize = "md" | "sm" | "xs";
const BTN_SIZE: Record<BtnSize, string> = {
  md: "h-[38px] px-4 text-[13px] rounded-[12px]",
  sm: "h-8 px-[11px] text-[12px] rounded-[10px]",
  xs: "h-[26px] px-[9px] text-[11px] rounded-[9px] gap-1",
};
const BTN_VARIANT: Record<BtnVariant, string> = {
  default: "bg-[var(--surface)] text-[var(--text-soft)] border border-[var(--line)] hover:border-[var(--clay-soft)] hover:bg-[var(--surface-2)] hover:shadow-[var(--shadow-xs)]",
  primary: "bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)] font-semibold shadow-[0_2px_8px_-2px_var(--clay-ring)] hover:brightness-[1.04] hover:shadow-[0_6px_16px_-4px_var(--clay-ring)]",
  gold:    "bg-[linear-gradient(120deg,var(--gold-bright),var(--gold))] text-[var(--on-gold)] font-semibold hover:brightness-[1.04]",
  ghost:   "bg-transparent border border-transparent hover:bg-[var(--surface-2)] hover:border-[var(--line)]",
  danger:  "bg-[var(--surface)] text-[var(--bad)] border border-[rgba(199,73,58,.3)] hover:bg-[var(--bad-tint)] hover:border-[var(--bad)]",
};
export function Button({
  variant = "default", size = "md", block, className, ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; block?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-[7px] font-medium whitespace-nowrap cursor-pointer transition-all duration-200 ease-[cubic-bezier(.2,.7,.2,1)] active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
        "disabled:opacity-45 disabled:pointer-events-none",
        BTN_SIZE[size], BTN_VARIANT[variant], block && "w-full", className
      )}
      {...p}
    />
  );
}

/* ---------------- Pill ---------------- */
type PillKind = "ok" | "warn" | "bad" | "info" | "mute" | "default";
const PILL: Record<PillKind, string> = {
  ok:   "text-[var(--ok)] border-[rgba(92,138,85,.28)] bg-[var(--ok-tint)]",
  warn: "text-[var(--gold-deep)] border-[rgba(200,146,47,.3)] bg-[var(--warn-tint)]",
  bad:  "text-[var(--bad)] border-[rgba(199,73,58,.28)] bg-[var(--bad-tint)]",
  info: "text-[var(--info)] border-[rgba(92,134,176,.28)] bg-[var(--info-tint)]",
  mute: "text-[var(--muted)] border-[var(--line)] bg-[var(--surface-2)]",
  default: "text-[var(--text-soft)] border-[var(--line)] bg-[var(--surface-2)]",
};
export function Pill({ kind = "default", dot, children }: { kind?: PillKind; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-[5px] px-[10px] py-[3px] rounded-full text-[11px] font-semibold border", PILL[kind])}>
      {dot && <i className="w-[6px] h-[6px] rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const Tag = ({ children }: { children: React.ReactNode }) =>
  <span className="font-mono text-[10px] tracking-[.05em] text-[var(--muted)] px-2 py-[2px] border border-[var(--line)] rounded-[8px] bg-[var(--surface-2)]">{children}</span>;

export const Kbd = ({ children }: { children: React.ReactNode }) =>
  <kbd className="font-mono text-[10px] bg-[var(--wash)] border border-[var(--line)] rounded-[6px] px-[6px] py-[1px] text-[var(--muted)]">{children}</kbd>;

export const Eyebrow = ({ children }: { children: React.ReactNode }) =>
  <div className="font-mono text-[10px] tracking-[.26em] uppercase text-[var(--clay)]">{children}</div>;

/* ---------------- Toggle ---------------- */
export function Toggle({ on, onClick, label }: { on: boolean; onClick?: () => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={cn(
        "relative w-[46px] h-[26px] rounded-full border transition-all duration-200 cursor-pointer flex-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
        on ? "bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] border-transparent" : "bg-[var(--surface-2)] border-[var(--line-strong)]")}>
      <i className={cn("absolute top-[2px] w-5 h-5 rounded-full bg-white shadow-[var(--shadow-xs)] transition-all duration-200 ease-[cubic-bezier(.16,1,.3,1)]", on ? "left-[22px]" : "left-[2px]")} />
    </button>
  );
}

/* ---------------- Meter ---------------- */
export const Meter = ({ pct }: { pct: number }) => (
  <div className="h-2 rounded-md bg-[var(--surface-2)] overflow-hidden border border-[var(--hair)]">
    <i className="block h-full rounded-md bg-[linear-gradient(90deg,var(--clay),var(--gold))] transition-[width] duration-[.6s] ease-[cubic-bezier(.16,1,.3,1)]"
       style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);

/* ---------------- Spinner ---------------- */
export const Spinner = () =>
  <div className="w-[42px] h-[42px] rounded-full border-[3px] border-[var(--line)] border-t-[var(--clay)] animate-spin" />;

/* ---------------- Card ---------------- */
export const Card = ({ pad, hover, className, ...p }: React.HTMLAttributes<HTMLDivElement> & { pad?: boolean; hover?: boolean }) => (
  <div className={cn(
    "bg-[var(--surface)] border border-[var(--line)] rounded-[16px] shadow-[var(--shadow-card)] transition-all duration-200",
    pad && "p-[18px]",
    hover && "hover:-translate-y-[2px] hover:shadow-[var(--shadow-lift)] hover:border-[var(--line-strong)]",
    className)} {...p} />
);

/* ---------------- Input ---------------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input ref={ref} className={cn(
      "w-full h-[42px] px-[14px] text-[13.5px] rounded-[12px] bg-[var(--wash)] border border-[var(--line)] text-[var(--text)] outline-none transition-all duration-200",
      "placeholder:text-[var(--muted-2)] hover:border-[var(--line-strong)]",
      "focus:border-[var(--clay)] focus:shadow-[var(--ring-soft)] focus:bg-[var(--surface)]", className)} {...p} />
  ));
Input.displayName = "Input";
