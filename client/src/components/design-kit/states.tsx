/* AI Director · 設計系統 — 四態視圖（EmptyState / LoadingState / ErrorState / Skeleton）
 * U-10（AIDV-101）「State 4」：補齊 design-kit 缺的狀態元件層。
 * · 色彩/圓角/陰影一律走 CSS 變數（.aidv-kit 範圍解析；見 design-kit.css）；不寫死 hex。
 * · 純呈現、不接任何頁面＝零回歸（同 #883 其餘 design-kit 元件）。
 * · 內建 a11y（role/aria-busy/aria-live）。元件須用在 <AidvKit> 內，token 才解析成設計套件原義。
 * rev. U-10 · 2026-06-15 */
import * as React from "react";
import { cn } from "./tokens";
import { Spinner, Button } from "./primitives";

/* ---------------- Skeleton ---------------- */
export function Skeleton({
  w, h = 14, rounded = 8, className, style, ...p
}: React.HTMLAttributes<HTMLDivElement> & { w?: number | string; h?: number | string; rounded?: number }) {
  return (
    <div
      aria-hidden
      className={cn("motion-safe:animate-pulse bg-[var(--surface-2)] border border-[var(--hair)]", className)}
      style={{ width: w ?? "100%", height: h, borderRadius: rounded, ...style }}
      {...p}
    />
  );
}

/** 多行骨架（清單／段落佔位）；最後一行較短，貼近真實文字塊。 */
export function SkeletonLines({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="載入中" className="w-full" style={{ display: "grid", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? "64%" : "100%"} />
      ))}
    </div>
  );
}

/* ---------------- LoadingState ---------------- */
export function LoadingState({ label = "載入中…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <Spinner />
      <div className="text-[13px] text-[var(--muted)]">{label}</div>
    </div>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({
  icon = "✦", title, hint, action, className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-[16px] border border-[var(--line)] bg-[var(--surface-2)] text-[20px] text-[var(--clay)]">
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-[var(--text)]">{title}</div>
      {hint && <div className="max-w-sm text-[12px] leading-relaxed text-[var(--muted)]">{hint}</div>}
      {action && (
        <Button variant="primary" size="sm" className="mt-1" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/* ---------------- ErrorState ---------------- */
export function ErrorState({
  title = "出了點狀況", message, onRetry, className,
}: {
  title?: React.ReactNode;
  message?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-[16px] border border-[rgba(199,73,58,.28)] bg-[var(--bad-tint)] text-[20px] text-[var(--bad)]">
        ⚠
      </div>
      <div className="text-[14px] font-semibold text-[var(--text)]">{title}</div>
      {message && <div className="max-w-sm text-[12px] leading-relaxed text-[var(--muted)]">{message}</div>}
      {onRetry && (
        <Button variant="default" size="sm" className="mt-1" onClick={onRetry}>
          重試
        </Button>
      )}
    </div>
  );
}
