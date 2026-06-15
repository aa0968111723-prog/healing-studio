/* AI Director · 設計系統 — 各殼專屬 Shell-specific 元件層（U-10 / AIDV-101 第四批 · 收尾）
 * ModelCard / TemplateCard / ExportRatioCard / SubTabs / ProviderOption / SettingRow /
 * AdminUserRow / ArticleCard / IntelItem / UsageBar / KeyRow / StatCard / SourceCite（13）
 * · 純呈現、props 驅動、不接任何頁面/路由/後端＝零回歸（接真實資料＝各殼採用卡）。
 * · 色彩/圓角一律走 .aidv-kit CSS 變數 token；不寫死 hex；不依賴 icon 套件。
 * rev. U-10 · 2026-06-15 */
import * as React from "react";
import { cn } from "./tokens";
import { Pill, Tag, Meter } from "./primitives";

/* ================= ModelCard（AI 模型卡）================= */
export interface DkModel { id: string; name: string; vendor: string; kind: string; status?: "可用" | "待接" | "訓練中"; brainRole?: string }
const MODEL_STATUS: Record<NonNullable<DkModel["status"]>, "ok" | "mute" | "warn"> = { 可用: "ok", 待接: "mute", 訓練中: "warn" };
export function ModelCard({ model, onClick }: { model: DkModel; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full flex-col gap-1 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left transition-all duration-200 hover:-translate-y-px hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">{model.name}</span>
        {model.status && <Pill kind={MODEL_STATUS[model.status]} dot>{model.status}</Pill>}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <span>{model.vendor}</span><span>·</span><Tag>{model.kind}</Tag>
        {model.brainRole && <span className="ml-auto text-[var(--clay)]">{model.brainRole}</span>}
      </div>
    </button>
  );
}

/* ================= TemplateCard（社群版型卡）================= */
export function TemplateCard({ name, ratio, palette, onClick }: { name: string; ratio: string; palette?: [string, string]; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-2.5 text-left hover:border-[var(--line-strong)]">
      <span className="flex h-10 w-10 flex-none overflow-hidden rounded-[10px] border border-[var(--hair)]">
        <i className="flex-1" style={{ background: palette?.[0] ?? "var(--surface-2)" }} />
        <i className="flex-1" style={{ background: palette?.[1] ?? "var(--surface-3)" }} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{name}</span>
      <Tag>{ratio}</Tag>
    </button>
  );
}

/* ================= ExportRatioCard（匯出尺寸卡）================= */
export function ExportRatioCard({ label, ratio, dims, selected, onClick }: { label: string; ratio: string; dims?: string; selected?: boolean; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn("flex flex-col items-start gap-0.5 rounded-[12px] border p-2.5 text-left transition-all duration-200", selected ? "border-[var(--clay)] bg-[var(--clay-tint)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]")}>
      <span className="text-[12px] font-semibold text-[var(--text)]">{label}</span>
      <span className="text-[10px] text-[var(--muted)]">{ratio}{dims ? ` · ${dims}` : ""}</span>
    </button>
  );
}

/* ================= SubTabs（殼內子分頁 ?sub=）================= */
export function SubTabs({ tabs, active, onSelect }: { tabs: { id: string; label: string }[]; active: string; onSelect?: (id: string) => void }) {
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-1">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onSelect?.(t.id)}
            className={cn("rounded-[9px] px-3 py-1 text-[12px] font-medium transition-all duration-200", on ? "bg-[var(--surface)] text-[var(--clay)] shadow-[var(--shadow-xs)]" : "text-[var(--muted)] hover:text-[var(--text)]")}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= ProviderOption（生成引擎選項）================= */
export function ProviderOption({ name, status = "ok", selected, onSelect, onTest }: { name: string; status?: "ok" | "down"; selected?: boolean; onSelect?: () => void; onTest?: () => void }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-[12px] border p-2.5", selected ? "border-[var(--clay)] bg-[var(--clay-tint)]" : "border-[var(--line)] bg-[var(--surface)]")}>
      <button type="button" role="radio" aria-checked={!!selected} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cn("size-2 rounded-full", status === "ok" ? "bg-[var(--ok)]" : "bg-[var(--bad)]")} />
        <span className="truncate text-[13px] text-[var(--text)]">{name}</span>
      </button>
      {onTest && <button type="button" onClick={onTest} className="rounded-[8px] border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)]">測試</button>}
    </div>
  );
}

/* ================= SettingRow（設定列）================= */
export function SettingRow({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</div>}
      </div>
      {children && <div className="flex-none">{children}</div>}
    </div>
  );
}

/* ================= AdminUserRow（管理使用者列）================= */
export function AdminUserRow({ name, email, role, credits, onAction }: { name: string; email?: string; role: string; credits?: number; onAction?: (a: "edit" | "suspend") => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-[var(--text)]">{name}</div>
        {email && <div className="truncate text-[11px] text-[var(--muted)]">{email}</div>}
      </div>
      <Pill kind="mute">{role}</Pill>
      {typeof credits === "number" && <span className="font-mono text-[11px] text-[var(--muted)]">{credits} 點</span>}
      {onAction && (
        <div className="flex gap-1">
          <button type="button" aria-label="編輯" onClick={() => onAction("edit")} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--clay)] hover:bg-[var(--surface-2)]">編輯</button>
          <button type="button" aria-label="停權" onClick={() => onAction("suspend")} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--bad)] hover:bg-[var(--bad-tint)]">停權</button>
        </div>
      )}
    </div>
  );
}

/* ================= ArticleCard（學習文章卡）================= */
export function ArticleCard({ title, category, onClick }: { title: string; category?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full flex-col gap-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left hover:border-[var(--line-strong)]">
      {category && <Tag>{category}</Tag>}
      <span className="line-clamp-2 text-[13px] font-medium text-[var(--text)]">{title}</span>
    </button>
  );
}

/* ================= IntelItem（情報新聞列）================= */
export function IntelItem({ title, source, tag, onClick }: { title: string; source?: string; tag?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]">
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] text-[var(--text)]">{title}</span>
        {source && <span className="mt-0.5 block text-[10px] text-[var(--muted-2)]">{source}</span>}
      </span>
      {tag && <Tag>{tag}</Tag>}
    </button>
  );
}

/* ================= UsageBar（積分用量條）================= */
export function UsageBar({ label, pct, value }: { label: React.ReactNode; pct: number; value?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[var(--muted)]">{label}</span>
        {value != null && <span className="font-mono text-[var(--text-soft)]">{value}</span>}
      </div>
      <Meter pct={pct} />
    </div>
  );
}

/* ================= KeyRow（API 金鑰列）================= */
export function KeyRow({ name, status = "ok", onTest, onDelete }: { name: string; status?: "ok" | "down" | "idle"; onTest?: () => void; onDelete?: () => void }) {
  const kind = status === "ok" ? "ok" : status === "down" ? "bad" : "mute";
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">{name}</span>
      <Pill kind={kind} dot>{status === "ok" ? "已連" : status === "down" ? "異常" : "未測"}</Pill>
      {onTest && <button type="button" onClick={onTest} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)]">測試</button>}
      {onDelete && <button type="button" aria-label="刪除" onClick={onDelete} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--bad)] hover:bg-[var(--bad-tint)]">刪</button>}
    </div>
  );
}

/* ================= StatCard（統計卡）================= */
export function StatCard({ label, value, delta }: { label: React.ReactNode; value: React.ReactNode; delta?: { dir: "up" | "down"; text: string } }) {
  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-[20px] font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-serif)" }}>{value}</div>
      {delta && <div className={cn("mt-0.5 text-[11px]", delta.dir === "up" ? "text-[var(--ok)]" : "text-[var(--bad)]")}>{delta.dir === "up" ? "▲" : "▼"} {delta.text}</div>}
    </div>
  );
}

/* ================= SourceCite（研究來源引用）================= */
export function SourceCite({ title, url, snippet }: { title: string; url?: string; snippet?: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--hair)] bg-[var(--surface-2)] p-2">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-[var(--info)]" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text)]">{title}</span>
      </div>
      {snippet && <p className="mt-1 line-clamp-2 text-[11px] text-[var(--muted)]">{snippet}</p>}
      {url && <div className="mt-1 truncate font-mono text-[10px] text-[var(--muted-2)]">{url}</div>}
    </div>
  );
}
