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
export interface DkProviderEntry { id: string; label: string; cost: number; status?: DkProviderStatus }

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

/* ================= ProviderSwitcher（pill ＋ 下拉切換）================= */
export function ProviderSwitcher({
  activeId, entries, open, onToggle, onSwitch, onSettings,
}: {
  activeId: string;
  entries: DkProviderEntry[];
  open: boolean;
  onToggle: () => void;
  onSwitch?: (id: string) => void;
  onSettings?: () => void;
}) {
  const active = entries.find((e) => e.id === activeId);
  const st: DkProviderStatus = active?.status ?? "ok";
  const pillKind = PROVIDER_PILL[st];
  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={onToggle}
        title={`生成引擎：${active?.label ?? activeId}（${st}）`}
        className="rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]"
      >
        <Pill kind={pillKind} dot>
          {active?.label ?? activeId}{st === "down" && " · 異常"}
          <span className="ml-0.5 text-[var(--muted-2)]">▾</span>
        </Pill>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="生成 Provider"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[220px] rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow-lift)]"
        >
          <div className="mb-1 px-1 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--muted-2)]">生成 Provider</div>
          <ul>
            {entries.map((e) => {
              const isActive = e.id === activeId;
              const eKind = PROVIDER_PILL[e.status ?? "ok"];
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => { onSwitch?.(e.id); onToggle(); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12px]",
                      isActive ? "bg-[var(--clay-tint)] text-[var(--clay)]" : "text-[var(--text-soft)] hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <i className={cn("inline-block h-[6px] w-[6px] shrink-0 rounded-full", eKind === "ok" ? "bg-[var(--ok)]" : eKind === "bad" ? "bg-[var(--bad)]" : "bg-[var(--muted-2)]")} />
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    <span className="text-[10px] text-[var(--muted-2)]">${e.cost === 0 ? "0" : e.cost.toFixed(3)}</span>
                    {isActive && <span className="text-[var(--clay)] text-[10px]">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {onSettings && (
            <button
              type="button"
              onClick={() => { onSettings(); onToggle(); }}
              className="mt-1 flex w-full items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)]"
            >
              ⚙ 詳細設定
            </button>
          )}
        </div>
      )}
    </div>
  );
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

/* ================= AccountMenu（TopBar 右側可見帳號/登出入口）=================
 * chrome 取代 AppleDock 後，登出不可只藏在 ⌘K（行動裝置無實體 ⌘K、桌機使用者也未必知道）。
 * 此 avatar 選單給「可見、可點」的登出出口；純呈現、props 驅動、內建 a11y（aria-expanded/role=menu）。
 * 點頭像展開，含「登出」（呼叫 onLogout）＋可選「設定」（onSettings）。 */
export function AccountMenu({
  label, onLogout, onSettings, open, onToggle,
}: {
  /** 顯示名（取首字當 avatar）；未提供時用通用人像。 */
  label?: string;
  onLogout: () => void;
  onSettings?: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const initial = label?.trim()?.[0]?.toUpperCase();
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="帳號選單"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label ? `${label}・帳號` : "帳號"}
        onClick={onToggle}
        className="flex size-8 items-center justify-center rounded-full bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[12px] font-semibold text-[var(--on-clay)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]"
      >
        {initial ?? "👤"}
      </button>
      {open && (
        <div role="menu" aria-label="帳號" className="absolute right-0 top-[calc(100%+6px)] z-40 w-[200px] rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-lift)]">
          {label && <div className="truncate px-2 py-1.5 text-[12px] text-[var(--muted)]">{label}</div>}
          {onSettings && (
            <button type="button" role="menuitem" onClick={onSettings} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] text-[var(--text-soft)] hover:bg-[var(--surface-2)]">
              <span>⚙</span><span>設定</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] text-[var(--bad)] hover:bg-[var(--surface-2)]">
            <span>⏻</span><span>登出</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= TopBar（上 58px）================= */
export function TopBar({
  shell, projectName, onProjectClick, projectSlot, provider, providerStatus, providerSlot, credits, onCmdK, accountSlot,
}: {
  shell: DkShellDef; projectName?: string; onProjectClick?: () => void; projectSlot?: React.ReactNode;
  provider?: string; providerStatus?: DkProviderStatus;
  /** 覆蓋預設 ProviderChip（傳入已配置好的 ProviderSwitcher 等）；有此 slot 時忽略 provider/providerStatus。 */
  providerSlot?: React.ReactNode;
  credits?: number; onCmdK?: () => void;
  /** 右側帳號/登出入口（通常傳 <AccountMenu />）。可見出口，避免登出只藏在 ⌘K。 */
  accountSlot?: React.ReactNode;
}) {
  return (
    <header className="flex h-[58px] items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4">
      <div className="flex items-center gap-2 text-[15px]">
        <span>{shell.emoji}</span>
        <span className="font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-serif)" }}>{shell.name}</span>
      </div>
      {projectSlot ?? (projectName != null && (
        <button type="button" onClick={onProjectClick} className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1 text-[12px] text-[var(--text-soft)] hover:border-[var(--clay-soft)]">
          <span className="truncate max-w-[160px]">{projectName}</span>
          <span className="text-[var(--muted-2)]">▾</span>
        </button>
      ))}
      <div className="ml-auto flex items-center gap-2">
        {providerSlot ?? (provider && <ProviderChip provider={provider} status={providerStatus} />)}
        {typeof credits === "number" && <Pill kind={credits < 120 ? "bad" : "default"}>{credits} 點</Pill>}
        <button type="button" aria-label="命令面板" onClick={onCmdK} className="flex items-center gap-1 rounded-[10px] border border-[var(--line)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
          <Kbd>⌘K</Kbd>
        </button>
        {accountSlot}
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
  const containerRef = React.useRef<HTMLDivElement>(null);

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
    else if (e.key === "Tab") {
      if (!containerRef.current) return;
      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>("input, button")
      ).filter((el) => !(el as HTMLButtonElement | HTMLInputElement).disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  };

  let running = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[18vh]" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
        className="w-[min(560px,92vw)] overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lift)]">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="命令搜尋"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--muted-2)]" />
        <ul role="listbox" className="max-h-[44vh] overflow-y-auto p-2">
          {flat.length === 0 && <li className="px-2 py-6 text-center text-[12px] text-[var(--muted)]">找不到指令 · 試試…</li>}
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
  shells, active, onSelect, onCmdK, onLogout,
}: { shells: DkShellDef[]; active: DkShellId; onSelect: (id: DkShellId) => void; onCmdK?: () => void;
  /** 行動版可見登出入口（avatar/⏻）；行動裝置無實體 ⌘K，登出不可只藏在命令面板。 */
  onLogout?: () => void }) {
  // flag off（enabled: false）的殼層不渲染對應籤（spec U-4e：flag off 不渲染對應籤）。
  const visible = shells.filter((s) => s.enabled !== false);
  const half = Math.ceil(visible.length / 2);
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
    <nav aria-label="行動版殼層導航" className="flex items-center gap-1 border-t border-[var(--line)] bg-[var(--surface)]/95 px-2 py-1 backdrop-blur overflow-visible">
      {visible.slice(0, half).map(render)}
      {/* FAB 上浮 −24px（spec §3.7）：-mt-6 在 flex 容器內向上偏移，溢出 nav 頂端呈光球效果。 */}
      <button type="button" aria-label="命令面板" onClick={onCmdK} className="flex size-12 flex-none -mt-6 items-center justify-center rounded-full bg-[linear-gradient(120deg,var(--clay-bright),var(--clay))] text-[var(--on-clay)] shadow-[var(--shadow-lift)]">◎</button>
      {visible.slice(half).map(render)}
      {onLogout && (
        <button type="button" aria-label="登出" onClick={onLogout}
          className="flex flex-none flex-col items-center gap-0.5 px-1.5 py-1.5 text-[10px] text-[var(--bad)]">
          <span className="text-[18px]">⏻</span>登出
        </button>
      )}
    </nav>
  );
}
