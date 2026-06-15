/* AI Director · 設計系統 — 座艙 Cockpit 元件層（U-10 / AIDV-101 第三批）
 * StageBar / ReadinessChip / PersonaSwitch / ChatBubble / CharacterCard /
 * PromptBlock / ContextSource / MemoryDBTabs / OrbBubble（GateCard / ShotCard 已於前批存在）
 * · 純呈現、props 驅動、不接任何頁面與 spine＝零回歸（接真實資料＝U-5 等採用卡的工作）。
 * · 色彩/圓角一律走 .aidv-kit CSS 變數 token；不寫死 hex；不依賴 icon 套件。
 * rev. U-10 · 2026-06-15 */
import * as React from "react";
import { cn } from "./tokens";
import { Pill, Tag } from "./primitives";

/* ================= ReadinessChip（確認門三態小籤）================= */
export type DkGateState = "ready" | "partial" | "blocked";
const GATE_PILL: Record<DkGateState, "ok" | "warn" | "bad"> = { ready: "ok", partial: "warn", blocked: "bad" };
const GATE_LABEL: Record<DkGateState, string> = { ready: "可量產", partial: "待補", blocked: "擋下" };
export function ReadinessChip({ state, label, onClick }: { state: DkGateState; label?: React.ReactNode; onClick?: () => void }) {
  const chip = <Pill kind={GATE_PILL[state]} dot>{label ?? GATE_LABEL[state]}</Pill>;
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]">{chip}</button>
  ) : chip;
}

/* ================= StageBar（非線性階段導航）================= */
export interface DkStage { id: string; name: string; status: "done" | "current" | "todo"; warn?: number }
export function StageBar({ stages, onSelect }: { stages: DkStage[]; onSelect?: (id: string) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="工作流階段">
      {stages.map((st, i) => {
        const on = st.status === "current";
        return (
          <li key={st.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-current={on ? "step" : undefined}
              onClick={() => onSelect?.(st.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-all duration-200",
                on ? "bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)]"
                  : st.status === "done" ? "bg-[var(--clay-tint)] text-[var(--clay)]"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]",
              )}
            >
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-black/10 text-[9px]">{st.status === "done" ? "✓" : i + 1}</span>
              {st.name}
              {st.warn ? <span className="text-[var(--bad)]">⚠{st.warn}</span> : null}
            </button>
            {i < stages.length - 1 && <span className="h-px w-3 bg-[var(--line)]" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ================= PersonaSwitch（人格三態）================= */
export type DkPersona = "calm" | "creative" | "technical";
const PERSONAS: { id: DkPersona; label: string }[] = [
  { id: "calm", label: "沉穩" }, { id: "creative", label: "創意" }, { id: "technical", label: "技術" },
];
export function PersonaSwitch({ value, onChange }: { value: DkPersona; onChange?: (p: DkPersona) => void }) {
  return (
    <div role="radiogroup" aria-label="導演人格" className="inline-flex gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-1">
      {PERSONAS.map((p) => {
        const on = p.id === value;
        return (
          <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange?.(p.id)}
            className={cn("rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200", on ? "bg-[var(--surface)] text-[var(--clay)] shadow-[var(--shadow-xs)]" : "text-[var(--muted)] hover:text-[var(--text)]")}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= ChatBubble（導演對話泡泡）================= */
export function ChatBubble({ role, children }: { role: "user" | "agent"; children: React.ReactNode }) {
  const user = role === "user";
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[78%] rounded-[16px] px-3.5 py-2 text-[13px] leading-relaxed",
        user ? "bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)] rounded-br-[6px]"
          : "border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] rounded-bl-[6px]",
      )}>
        {children}
      </div>
    </div>
  );
}

/* ================= CharacterCard（角色卡＋來源分級）================= */
export type DkSourceGrade = "precise" | "estimate" | "unconfirmed";
const GRADE_PILL: Record<DkSourceGrade, "ok" | "warn" | "bad"> = { precise: "ok", estimate: "warn", unconfirmed: "bad" };
const GRADE_LABEL: Record<DkSourceGrade, string> = { precise: "✅ 精準", estimate: "⚠ 估算", unconfirmed: "未確認" };
export function CharacterCard({ name, emoji = "🧑", grade, locked, onClick }: {
  name: string; emoji?: string; grade: DkSourceGrade; locked?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-left transition-all duration-200 hover:border-[var(--line-strong)]">
      <span className="text-[18px]">{emoji}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{name}</span>
      {locked && <span title="已鎖定" className="text-[var(--muted-2)]">🔒</span>}
      <Pill kind={GRADE_PILL[grade]}>{GRADE_LABEL[grade]}</Pill>
    </button>
  );
}

/* ================= PromptBlock（提示詞積木）================= */
export function PromptBlock({ label, text, uses, onInsert, onFork }: {
  label: string; text: string; uses?: number; onInsert?: () => void; onFork?: () => void;
}) {
  return (
    <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--text)]">{label}</span>
        {typeof uses === "number" && <Tag>{uses} 次</Tag>}
        <div className="ml-auto flex gap-1">
          {onInsert && <button type="button" onClick={onInsert} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--clay)] hover:bg-[var(--surface-2)]">插入</button>}
          {onFork && <button type="button" onClick={onFork} className="rounded-[8px] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)]">fork</button>}
        </div>
      </div>
      <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">{text}</p>
    </div>
  );
}

/* ================= ContextSource（Context Packet 來源列）================= */
export function ContextSource({ refLabel, kind, fresh = true }: { refLabel: string; kind: string; fresh?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[var(--hair)] bg-[var(--surface-2)] px-2 py-1 text-[11px]">
      <span className={cn("size-1.5 rounded-full", fresh ? "bg-[var(--ok)]" : "bg-[var(--gold)]")} title={fresh ? "新鮮" : "過期"} />
      <span className="min-w-0 flex-1 truncate text-[var(--text-soft)]">{refLabel}</span>
      <Tag>{kind}</Tag>
    </div>
  );
}

/* ================= MemoryDBTabs（資料庫頁籤列）================= */
export function MemoryDBTabs({ tabs, active, onSelect }: { tabs: { id: string; label: string }[]; active: string; onSelect?: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-[var(--line)]">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onSelect?.(t.id)}
            className={cn("relative px-3 py-1.5 text-[12px] font-medium transition-colors", on ? "text-[var(--clay)]" : "text-[var(--muted)] hover:text-[var(--text)]")}>
            {t.label}
            {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--clay)]" />}
          </button>
        );
      })}
    </div>
  );
}

/* ================= OrbBubble（光球 Ambient 泡泡）================= */
const ORB_ACCENT: Record<string, string> = {
  hint: "border-l-[var(--gold)]", collab: "border-l-[var(--clay)]", critical: "border-l-[var(--bad)]",
};
export function OrbBubble({ emoji = "✨", title, text, cta, onCta, level = "hint" }: {
  emoji?: string; title: React.ReactNode; text?: React.ReactNode; cta?: string; onCta?: () => void; level?: "hint" | "collab" | "critical";
}) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-[14px] border border-l-[3px] border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 shadow-[var(--shadow-card)]", ORB_ACCENT[level] ?? ORB_ACCENT.hint)}>
      <span className="text-[18px] leading-none">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-[var(--text)]">{title}</div>
        {text && <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">{text}</div>}
        {cta && onCta && (
          <button type="button" onClick={onCta} className="mt-2 rounded-[8px] bg-[var(--clay-tint)] px-2.5 py-1 text-[11px] font-medium text-[var(--clay)] hover:bg-[var(--clay-tint-2)]">{cta}</button>
        )}
      </div>
    </div>
  );
}
