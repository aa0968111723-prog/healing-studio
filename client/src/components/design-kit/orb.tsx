/* AI Director · 設計系統 — OrbAssistant 光球助手（U-11 / AIDV-114 第1片）
 * 四殼共掛的右下常駐光球：浮球 FAB＋面板＋6 情境分頁＋主動泡泡＋人格/心情頭＋四態。
 * · 純呈現、props 驅動、不接 spine／後端＝零回歸（真站四殼掛載＋orb_* · spiritRouter
 *   · memoryManager adapter 接資料＝後續採用片，待 U-4 `ENABLE_AIDV_CHROME`）。
 * · 重用既有：PersonaSwitch／OrbBubble／MemoryDBTabs（cockpit）、VaultBrowser（PromptVault）、
 *   四態（states）、Button（primitives）。色彩/圓角一律走 .aidv-kit token；不寫死 hex。
 * · a11y：FAB aria-expanded／面板 role=dialog＋Esc 關＋焦點回 FAB；主動泡泡 aria-live。
 * · reduced-motion：呼吸光環以 motion-reduce:animate-none 關閉。
 * rev. U-11 · 2026-06-16 */
import * as React from "react";
import { cn, type Persona } from "./tokens";
import { Button, Eyebrow } from "./primitives";
import { PersonaSwitch, OrbBubble, MemoryDBTabs, ChatBubble } from "./cockpit";
import { VaultBrowser } from "./PromptVault";
import { FlowBar, type WorkflowStep } from "./WorkflowBuilder";
import { EmptyState, LoadingState, ErrorState } from "./states";

/* ================= 6 情境分頁 ================= */
export type OrbTabId = "page" | "prompts" | "chat" | "focus" | "credits" | "notes";
export const ORB_TABS: { id: OrbTabId; label: string; icon: string }[] = [
  { id: "page", label: "本頁", icon: "✦" },
  { id: "prompts", label: "提示詞", icon: "📚" },
  { id: "chat", label: "對話", icon: "💬" },
  { id: "focus", label: "專注流", icon: "🎯" },
  { id: "credits", label: "積分", icon: "◈" },
  { id: "notes", label: "筆記", icon: "📝" },
];

/* ================= 心情（calm orb 四態，無臉/以色彩區分）================= */
export type OrbMood = "idle" | "thinking" | "working" | "done";
const MOOD: Record<OrbMood, { label: string; emoji: string; ring: string }> = {
  idle:     { label: "待命",   emoji: "🌙", ring: "var(--line-strong)" },
  thinking: { label: "思考中", emoji: "💭", ring: "var(--info)" },
  working:  { label: "工作中", emoji: "⚡", ring: "var(--clay)" },
  done:     { label: "完成",   emoji: "✨", ring: "var(--ok)" },
};

/* ================= 主動泡泡（精靈 emoji＋名＋提醒＋CTA）=================
 * level 對應 16 條觸發的緊急度：hint（多數提示）／collab（協作建議）／critical（攔阻）。 */
export type OrbProactiveLevel = "hint" | "collab" | "critical";
export interface OrbProactive {
  emoji?: string;
  name?: string;
  text: React.ReactNode;
  cta?: string;
  onCta?: () => void;
  level?: OrbProactiveLevel;
  onDismiss?: () => void;
}
export function ProactiveBubble({ emoji = "✨", name, text, cta, onCta, level = "hint", onDismiss }: OrbProactive) {
  return (
    <div role="status" aria-live="polite" className="relative">
      <OrbBubble
        emoji={emoji}
        level={level}
        title={name ?? "光球助手"}
        text={text}
        cta={cta}
        onCta={onCta}
      />
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="關閉提醒"
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full text-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ================= 浮球 FAB ================= */
export function OrbFab({
  open, onToggle, mood = "idle", hasProactive, position = "br", label = "光球助手",
}: {
  open: boolean;
  onToggle: () => void;
  mood?: OrbMood;
  hasProactive?: boolean;
  position?: "br" | "bl";
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        "orb-fab fixed bottom-[max(20px,env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full text-[24px]",
        "border border-[var(--line)] bg-[linear-gradient(135deg,var(--surface),var(--surface-2))] shadow-[var(--shadow-lift)]",
        "transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-0.5 active:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
        position === "br" ? "right-5" : "left-5",
      )}
      style={{ boxShadow: `0 0 0 2px ${MOOD[mood].ring}33, var(--shadow-lift)` }}
    >
      {/* 呼吸光環：reduced-motion 自動關閉 */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full opacity-60 motion-reduce:animate-none animate-ping"
        style={{ boxShadow: `0 0 0 1px ${MOOD[mood].ring}` }}
      />
      <span className="relative leading-none">{MOOD[mood].emoji}</span>
      {hasProactive && !open && (
        <span
          aria-hidden
          className="absolute right-1 top-1 size-3 rounded-full border-2 border-[var(--surface)] bg-[var(--clay)]"
        />
      )}
    </button>
  );
}

/* ================= 人格／心情頭 ================= */
export function OrbMoodHead({
  persona, onPersonaChange, mood = "idle", name = "光球助手",
}: {
  persona: Persona;
  onPersonaChange?: (p: Persona) => void;
  mood?: OrbMood;
  name?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 flex-none place-items-center rounded-full bg-[var(--clay-tint)] text-[18px]" style={{ boxShadow: `inset 0 0 0 1.5px ${MOOD[mood].ring}` }}>
        {MOOD[mood].emoji}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-[var(--text)]">{name}</span>
          <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-px text-[10px] text-[var(--muted)]">{MOOD[mood].label}</span>
        </div>
        <div className="mt-1">
          <PersonaSwitch value={persona} onChange={onPersonaChange} />
        </div>
      </div>
    </div>
  );
}

/* ================= 「本頁」分頁：情境提示＋Flow 展示牆（一鍵重跑）=================
 * 純呈現：情境提示＝隨頁面變化的提醒/捷徑；Flow 展示牆＝近期工作流，一鍵重跑。 */
export interface OrbContextHint {
  id: string;
  icon?: React.ReactNode;
  text: React.ReactNode;
  cta?: string;
  onCta?: () => void;
}
export interface OrbFlowItem {
  id: string;
  name: string;
  steps: WorkflowStep[];
  current?: number;
  onRerun?: () => void;
}
export function OrbPageTab({
  pageLabel = "本頁", hints = [], flows = [], onRerun,
}: {
  pageLabel?: React.ReactNode;
  hints?: OrbContextHint[];
  flows?: OrbFlowItem[];
  onRerun?: (flow: OrbFlowItem) => void;
}) {
  if (hints.length === 0 && flows.length === 0) {
    return <EmptyState icon="✦" title="這個頁面還沒有情境提示" hint="開始操作後，光球會在這裡給你本頁的提醒與可一鍵重跑的工作流。" />;
  }
  return (
    <div className="flex flex-col gap-4">
      {/* 情境提示 */}
      {hints.length > 0 && (
        <section className="flex flex-col gap-2">
          <Eyebrow>本頁 · {pageLabel}</Eyebrow>
          <ul className="flex flex-col gap-1.5">
            {hints.map((h) => (
              <li key={h.id} className="flex items-start gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2">
                <span className="text-[15px] leading-none">{h.icon ?? "💡"}</span>
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-soft)]">{h.text}</span>
                {h.cta && h.onCta && (
                  <button type="button" onClick={h.onCta} className="flex-none rounded-[8px] px-2 py-0.5 text-[11px] font-medium text-[var(--clay)] hover:bg-[var(--surface-2)]">
                    {h.cta}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Flow 展示牆 */}
      {flows.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Eyebrow>Flow 展示牆</Eyebrow>
            <span className="text-[10px] text-[var(--muted)]">一鍵重跑</span>
          </div>
          <div className="flex flex-col gap-2">
            {flows.map((f) => (
              <div key={f.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-2">
                <div className="mb-1 flex items-center gap-2 px-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text)]">{f.name}</span>
                  <Button size="xs" variant="primary" onClick={() => (f.onRerun ?? (() => onRerun?.(f)))()}>↻ 重跑</Button>
                </div>
                <FlowBar steps={f.steps} current={f.current ?? f.steps.length} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ================= 「對話」分頁：近期往來泡泡（純呈現）================= */
export interface OrbChatMsg { id?: string; role: "user" | "agent"; text: React.ReactNode }
export function OrbChatTab({ messages = [], emptyHint }: { messages?: OrbChatMsg[]; emptyHint?: React.ReactNode }) {
  if (messages.length === 0) {
    return <EmptyState icon="💬" title="還沒有對話" hint={emptyHint ?? "到導演對話跟光球說說你想做的影片，這裡會顯示最近的往來。"} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <ChatBubble key={m.id ?? i} role={m.role}>{m.text}</ChatBubble>
      ))}
    </div>
  );
}

/* ================= 分頁四態內容 ================= */
function OrbTabContent({
  state = "content", children, onRetry, emptyHint,
}: {
  state?: "content" | "loading" | "error" | "empty";
  children?: React.ReactNode;
  onRetry?: () => void;
  emptyHint?: React.ReactNode;
}) {
  if (state === "loading") return <LoadingState />;
  if (state === "error") return <ErrorState message="這個分頁的資料載入失敗" onRetry={onRetry} />;
  if (state === "empty") return <EmptyState title="這個分頁還沒有內容" hint={emptyHint} />;
  return <>{children}</>;
}

/* ================= OrbAssistant（總成）================= */
export interface OrbAssistantProps {
  /** 受控開關；省略則內部自管（uncontrolled） */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 受控分頁；省略則內部自管 */
  activeTab?: OrbTabId;
  defaultTab?: OrbTabId;
  onTabChange?: (tab: OrbTabId) => void;
  /** 人格／心情頭 */
  persona?: Persona;
  onPersonaChange?: (p: Persona) => void;
  mood?: OrbMood;
  name?: string;
  /** 主動泡泡（給了就在面板頂顯示；FAB 也會亮提醒點） */
  proactive?: OrbProactive | null;
  /** 各分頁內容（本頁／對話／專注流／積分／筆記）；提示詞分頁優先用 promptVault */
  tabContent?: Partial<Record<OrbTabId, React.ReactNode>>;
  /** 提示詞分頁直接掛 VaultBrowser（自帶四態） */
  promptVault?: React.ComponentProps<typeof VaultBrowser>;
  /** 「本頁」分頁直接掛 OrbPageTab（情境提示＋Flow 展示牆，自帶空態） */
  pageContext?: React.ComponentProps<typeof OrbPageTab>;
  /** 當前分頁四態（提示詞分頁由 VaultBrowser 自管，不受此控） */
  state?: "content" | "loading" | "error" | "empty";
  onRetry?: () => void;
  emptyHint?: React.ReactNode;
  /** FAB 位置（避開 MobileNav） */
  position?: "br" | "bl";
}

export function OrbAssistant({
  open, defaultOpen = false, onOpenChange,
  activeTab, defaultTab = "page", onTabChange,
  persona = "calm", onPersonaChange, mood = "idle", name = "光球助手",
  proactive, tabContent, promptVault, pageContext, state = "content", onRetry, emptyHint,
  position = "br",
}: OrbAssistantProps) {
  const [openU, setOpenU] = React.useState(defaultOpen);
  const isOpen = open ?? openU;
  const setOpen = (v: boolean) => { if (open === undefined) setOpenU(v); onOpenChange?.(v); };

  const [tabU, setTabU] = React.useState<OrbTabId>(defaultTab);
  const tab = activeTab ?? tabU;
  const setTab = (v: OrbTabId) => { if (activeTab === undefined) setTabU(v); onTabChange?.(v); };

  const panelRef = React.useRef<HTMLDivElement>(null);
  const fabRef = React.useRef<HTMLDivElement>(null);

  // 焦點管理：開→聚焦面板；關→焦點回 FAB
  React.useEffect(() => {
    if (isOpen) panelRef.current?.focus();
    else fabRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [isOpen]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };

  const tabNode =
    tab === "prompts" && promptVault ? <VaultBrowser {...promptVault} />
    : tab === "page" && pageContext ? <OrbPageTab {...pageContext} />
    : <OrbTabContent state={state} onRetry={onRetry} emptyHint={emptyHint}>{tabContent?.[tab]}</OrbTabContent>;

  return (
    <div ref={fabRef} className="aidv-kit">
      <OrbFab open={isOpen} onToggle={() => setOpen(!isOpen)} mood={mood} hasProactive={!!proactive} position={position} />

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${name}面板`}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          className={cn(
            "orb-panel fixed bottom-[88px] z-40 flex max-h-[min(72vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-[20px]",
            "border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] shadow-[var(--shadow-lift)] backdrop-blur-xl",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
            position === "br" ? "right-5" : "left-5",
          )}
        >
          {/* 頭：人格/心情＋關閉 */}
          <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-3.5 py-3">
            <OrbMoodHead persona={persona} onPersonaChange={onPersonaChange} mood={mood} name={name} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="關閉助手"
              className="grid size-7 flex-none place-items-center rounded-full text-[15px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]"
            >
              ×
            </button>
          </div>

          {/* 6 情境分頁（重用 MemoryDBTabs） */}
          <div className="px-2 pt-2">
            <MemoryDBTabs
              tabs={ORB_TABS.map((t) => ({ id: t.id, label: `${t.icon} ${t.label}` }))}
              active={tab}
              onSelect={(id) => setTab(id as OrbTabId)}
            />
          </div>

          {/* 主動泡泡 */}
          {proactive && (
            <div className="px-3.5 pt-3">
              <ProactiveBubble {...proactive} />
            </div>
          )}

          {/* 分頁內容（四態） */}
          <div className="min-h-[120px] flex-1 overflow-y-auto px-3.5 py-3">
            {tabNode}
          </div>
        </div>
      )}
    </div>
  );
}

export default OrbAssistant;
