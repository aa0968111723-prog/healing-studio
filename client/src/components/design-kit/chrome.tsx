/* AI Director · 設計系統 — 殼層 Chrome 8 元件層（U-10 / AIDV-101 第二批）
 * Rail / TopBar / ProjectSwitcher / CommandPalette / Toast / MobileNav / ProviderChip / StateInspector
 * · 純呈現、props 驅動、不接任何頁面與路由＝零回歸（整合進殼層＝U-4 的工作）。
 * · 色彩/圓角一律走 .aidv-kit CSS 變數 token；不寫死 hex；不依賴 icon 套件（用 emoji/unicode）。
 * · 內建 a11y（role/aria/鍵盤）。元件須用在 <AidvKit> 內，token 才解析成設計套件原義。
 * rev. U-10 · 2026-06-15 */
import * as React from "react";
import { cn } from "./tokens";
import { Pill, Kbd, Meter } from "./primitives";

/* ================= 型別 ================= */
export type DkShellId = "video" | "social" | "learn" | "settings";
export interface DkShellDef { id: DkShellId; emoji: string; name: string; enabled?: boolean }
export type DkProviderStatus = "ok" | "down" | "idle";
export type DkToastKind = "ok" | "warn" | "bad" | "info";

/* ================= ProviderChip ================= */
const PROVIDER_PILL: Record<DkProviderStatus, "ok" | "bad" | "mute"> = { ok: "ok", down: "bad", idle: "mute" };
export function ProviderChip({
  provider, status = "ok", onClick,
}: { provider: string; status?: DkProviderStatus; onClick?: () => void }) {
  const C = PROVIDER_PILL[status];
  const inner = <Pill kind={C} dot>{provider}{status === "down" && " · 異常"}</Pill>;
  return onClick ? (
    <button type="button" onClick={onClick} title={`生成引擎：${provider}（${status}）→ 設定`} className="rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]">
      {inner}
    </button>
  ) : inner;
}

/* ================= Toast ================= */
const TOAST_BORDER: Record<DkToastKind, string> = {
  ok: "border-l-[var(--ok)]", warn: "border-l-[var(--gold)]", bad: "border-l-[var(--bad)]", info: "border-l-[var(--info)]",
};
export function Toast({
  kind, title, message, onClose,
}: { kind: DkToastKind; title: React.ReactNode; message?: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      role="status"
      aria-live={kind === "bad" ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-3 rounded-[14px] border border-l-[3px] border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]",
        TOAST_BORDER[kind],
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--text)]">{title}</div>
        {message && <div className="mt-0.5 text-[12px] text-[var(--muted)]">{message}</div>}
      </div>
      {onClose && (
        <button type="button" aria-label="關閉通知" onClick={onClose} className="shrink-0 text-[var(--muted-2)] hover:text-[var(--text)]">✕</button>
      )}
    </div>
  );
}

/* ================= StateInspector（四態切換 demo strip）================= */
const STATES = [
  { id: "idle", label: "靜默" }, { id: "hint", label: "提示" },
  { id: "collab", label: "協作" }, { id: "critical", label: "關鍵" },
] as const;
export type DkOrbState = (typeof STATES)[number]["id"];
export function StateInspector({ value, onChange }: { value: DkOrbState; onChange?: (s: DkOrbState) => void }) {
  return (
    <div role="radiogroup" aria-label="光球四態" className="inline-flex gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-1">
      {STATES.map((s) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange?.(s.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200",
              on ? "bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)]" : "text-[var(--muted)] hover:text-[var(--text)]",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================= Rail（左 76px 殼層切換）================= */
export function Rail({
  shells, active, onSelect, credits, onHome, onCmdK,
}: {
  shells: DkShellDef[]; active: DkShellId; onSelect: (id: DkShellId) => void;
  credits?: number; onHome?: () => void; onCmdK?: () => void;
}) {
  return (
    <nav aria-label="殼層導航" className="flex w-[76px] flex-col items-center gap-2 border-r border-[var(--line)] bg-[var(--surface)] py-3">
      <button type="button" aria-label="首頁" onClick={onHome} className="flex size-10 items-center justify-center rounded-[14px] bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)]">◎</button>
      <div className="my-1 h-px w-8 bg-[var(--line)]" />
      {shells.map((s) => {
        const on = s.id === active;
        const disabled = s.enabled === false;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={s.name}
            aria-current={on ? "page" : undefined}
            disabled={disabled}
            onClick={() => onSelect(s.id)}
            title={s.name}
            className={cn(
              "flex size-11 flex-col items-center justify-center gap-0.5 rounded-[14px] text-[18px] transition-all duration-200 disabled:opacity-40",
              on ? "bg-[var(--clay-tint)] text-[var(--clay)] ring-1 ring-[var(--clay-soft)]" : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
            )}
          >
            <span>{s.emoji}</span>
          </button>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2">
        {typeof credits === "number" && <Pill kind={credits < 120 ? "bad" : "mute"}>{credits}</Pill>}
        <button type="button" aria-label="命令面板" onClick={onCmdK} className="flex size-10 items-center justify-center rounded-[12px] border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-2)]">
          <Kbd>⌘K</Kbd>
        </button>
      </div>
    </nav>
  );
}

/* ================= TopBar（上 58px）================= */
export function TopBar({
  shell, projectName, onProjectClick, provider, providerStatus, credits, onCmdK,
}: {
  shell: DkShellDef; projectName?: string; onProjectClick?: () => void;
  provider?: string; providerStatus?: DkProviderStatus; credits?: number; onCmdK?: () => void;
}) {
  return (
    <header className="flex h-[58px] items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
      <div className="flex items-center gap-2 text-[15px]">
        <span>{shell.emoji}</span>
        <span className="font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-serif)" }}>{shell.name}</span>
      </div>
      {projectName != null && (
        <button type="button" onClick={onProjectClick} className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[12px] text-[var(--text-soft)] hover:border-[var(--clay-soft)]">
          <span className="truncate max-w-[160px]">{projectName}</span>
          <span className="text-[var(--muted-2)]">▾</span>
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {provider && <ProviderChip provider={provider} status={providerStatus} />}
        {typeof credits === "number" && <Pill kind={credits < 120 ? "bad" : "default"}>{credits} 點</Pill>}
        <button type="button" aria-label="命令面板" onClick={onCmdK} className="flex items-center gap-1 rounded-[10px] border border-[var(--line)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
          <Kbd>⌘K</Kbd>
        </button>
      </div>
    </header>
  );
}

/* ================= ProjectSwitcher（collapsed pill ＋ 展開清單）================= */
export interface DkProjectLite { id: string; name: string; emoji?: string }
export function ProjectSwitcher({
  projects, activeId, onSelect, onCreate, contextPct, ttlLabel, locked, open, onToggle,
}: {
  projects: DkProjectLite[]; activeId?: string; onSelect?: (id: string) => void; onCreate?: () => void;
  contextPct?: number; ttlLabel?: string; locked?: boolean; open: boolean; onToggle: () => void;
}) {
  const active = projects.find((p) => p.id === activeId);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[12px] text-[var(--text-soft)] hover:border-[var(--clay-soft)]">
        <span>{active?.emoji ?? "🎬"}</span>
        <span className="max-w-[160px] truncate">{active?.name ?? "選擇專案"}</span>
        {locked && <span title="鎖定" className="text-[var(--muted-2)]">🔒</span>}
        <span className="text-[var(--muted-2)]">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-30 w-[280px] rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow-lift)]">
          <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" role="menuitemradio" aria-checked={p.id === activeId} onClick={() => onSelect?.(p.id)} className={cn("flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12px]", p.id === activeId ? "bg-[var(--clay-tint)] text-[var(--clay)]" : "text-[var(--text-soft)] hover:bg-[var(--surface-2)]")}>
                  <span>{p.emoji ?? "🎬"}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {typeof contextPct === "number" && (
            <div className="mt-2 border-t border-[var(--line)] px-1 pt-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--muted)]">
                <span>Context Packet</span><span>{ttlLabel ?? ""}</span>
              </div>
              <Meter pct={contextPct} />
            </div>
          )}
          {onCreate && (
            <button type="button" onClick={onCreate} className="mt-2 flex w-full items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2 py-1.5 text-[12px] text-[var(--clay)] hover:bg-[var(--surface-2)]">＋ 新建專案</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= CommandPalette（⌘K · 鍵盤導航 ↑/↓/↵/Esc）================= */
export interface DkCommandItem { id: string; label: string; group: string; hint?: string; onRun: () => void }
export function CommandPalette({
  open, items, onClose, placeholder = "輸入指令或搜尋…",
}: { open: boolean; items: DkCommandItem[]; onClose: () => void; placeholder?: string }) {
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(
    () => (q.trim() ? items.filter((it) => (it.label + it.group).toLowerCase().includes(q.trim().toLowerCase())) : items),
    [q, items],
  );
  React.useEffect(() => { setIdx(0); }, [q, open]);
  React.useEffect(() => { if (open) inputRef.current?.focus(); else setQ(""); }, [open]);

  if (!open) return null;

  const groups = filtered.reduce<Record<string, DkCommandItem[]>>((acc, it) => {
    (acc[it.group] ??= []).push(it); return acc;
  }, {});
  const flat = Object.values(groups).flat();

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); flat[idx]?.onRun(); onClose(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let running = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[18vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
        className="w-[min(560px,92vw)] overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lift)]">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="命令搜尋"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--muted-2)]" />
        <ul role="listbox" className="max-h-[44vh] overflow-y-auto p-2">
          {flat.length === 0 && <li className="px-2 py-6 text-center text-[12px] text-[var(--muted)]">沒有符合的指令</li>}
          {Object.entries(groups).map(([group, its]) => (
            <li key={group}>
              <div className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--muted-2)]">{group}</div>
              <ul>
                {its.map((it) => {
                  running += 1; const on = running === idx;
                  return (
                    <li key={it.id} role="option" aria-selected={on}>
                      <button type="button" onClick={() => { it.onRun(); onClose(); }}
                        className={cn("flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px]", on ? "bg-[var(--clay-tint)] text-[var(--clay)]" : "text-[var(--text-soft)] hover:bg-[var(--surface-2)]")}>
                        <span className="min-w-0 flex-1 truncate">{it.label}</span>
                        {it.hint && <span className="text-[10px] text-[var(--muted-2)]">{it.hint}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ================= MobileNav（≤780 底部 FAB 列）================= */
export function MobileNav({
  shells, active, onSelect, onCmdK,
}: { shells: DkShellDef[]; active: DkShellId; onSelect: (id: DkShellId) => void; onCmdK?: () => void }) {
  const half = Math.ceil(shells.length / 2);
  const render = (s: DkShellDef) => {
    const on = s.id === active;
    return (
      <button key={s.id} type="button" aria-label={s.name} aria-current={on ? "page" : undefined} onClick={() => onSelect(s.id)}
        className={cn("flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px]", on ? "text-[var(--clay)]" : "text-[var(--muted)]")}>
        <span className="text-[18px]">{s.emoji}</span>{s.name}
      </button>
    );
  };
  return (
    <nav aria-label="行動版殼層導航" className="flex items-center gap-1 border-t border-[var(--line)] bg-[var(--surface)]/95 px-2 py-1 backdrop-blur">
      {shells.slice(0, half).map(render)}
      <button type="button" aria-label="命令面板" onClick={onCmdK} className="flex size-12 flex-none items-center justify-center rounded-full bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)] shadow-[var(--shadow-lift)]">◎</button>
      {shells.slice(half).map(render)}
    </nav>
  );
}
