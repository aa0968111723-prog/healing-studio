/* AI Director · 設計系統 — StateInspector（四態演示切換）
 * ----------------------------------------------------------------------------
 * U-4f（AIDV-139）脊椎 chrome：用 segmented control 在「載入／空／錯誤／就緒」四態
 * 間切換，即時展示 design-kit 四態元件（重用 states.tsx），供走查與設計驗收用。
 *  · 純呈現、唯讀、零後端＝零回歸；旗標可在 prod 隱藏（見 stateInspectorFlags.ts）。
 *  · 色彩/圓角一律走 .aidv-kit scope 的 CSS 變數，不寫死 hex。
 *  · a11y：segmented control 用 role="tablist"/"tab" + aria-selected，左右/Home/End
 *    鍵盤可切，焦點環走 --clay-ring，觸控目標 ≥44px，動效尊重 reduced-motion。
 *  · 元件須用在 <AidvKit> 內，token 才解析成設計套件原義。
 * rev. U-4f · 2026-06-17 */
import * as React from "react";
import { cn } from "./tokens";
import { Eyebrow } from "./primitives";
import { EmptyState, ErrorState, LoadingState, SkeletonLines } from "./states";

/** 四態識別碼（脊椎四態：載入／空／錯誤／就緒）。 */
export type InspectorState = "loading" | "empty" | "error" | "ready";

type StateDef = {
  id: InspectorState;
  label: string;
  /** 演示面板（重用 design-kit 四態元件，純呈現、回呼為 no-op 走查用）。 */
  render: () => React.ReactNode;
};

const NOOP = () => {};

const STATES: readonly StateDef[] = [
  {
    id: "loading",
    label: "載入",
    render: () => (
      <div className="flex flex-col gap-4">
        <LoadingState label="載入中…" />
        <div className="px-2">
          <SkeletonLines lines={3} />
        </div>
      </div>
    ),
  },
  {
    id: "empty",
    label: "空",
    render: () => (
      <EmptyState
        title="還沒有內容"
        hint="這是空狀態的設計演示，從一個動作開始。"
        action={{ label: "示意動作", onClick: NOOP }}
      />
    ),
  },
  {
    id: "error",
    label: "錯誤",
    render: () => (
      <ErrorState
        title="出了點狀況"
        message="這是錯誤狀態的設計演示（走查用，重試為示意）。"
        onRetry={NOOP}
      />
    ),
  },
  {
    id: "ready",
    label: "就緒",
    render: () => (
      <div role="status" className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-[16px] border border-[rgba(92,138,85,.28)] bg-[var(--ok-tint)] text-[20px] text-[var(--ok)]">
          ✓
        </div>
        <div className="text-[14px] font-semibold text-[var(--text)]">就緒</div>
        <div className="max-w-sm text-[12px] leading-relaxed text-[var(--muted)]">
          內容已備妥，這是就緒狀態的設計演示。
        </div>
      </div>
    ),
  },
] as const;

export type StateInspectorProps = {
  /** 初始顯示的狀態（預設 loading）。 */
  initial?: InspectorState;
  /** 受控：明確指定當前狀態（提供時忽略內部狀態）。 */
  state?: InspectorState;
  /** 切換時回呼（走查記錄／受控用）。 */
  onStateChange?: (s: InspectorState) => void;
  className?: string;
};

/**
 * StateInspector — 四態演示切換器。
 * 一句話範圍：用 segmented control 在載入／空／錯誤／就緒四態間切換，即時展示
 * design-kit 四態元件，供設計走查與驗收（純前端唯讀，旗標可在 prod 隱藏）。
 *
 * 注意：是否渲染由旗標決定（見呼叫端與 stateInspectorFlags.ts）；本元件本身永遠渲染
 * 演示器，方便在測試／走查環境直接掛載。
 */
export function StateInspector({
  initial = "loading",
  state,
  onStateChange,
  className,
}: StateInspectorProps) {
  const [internal, setInternal] = React.useState<InspectorState>(initial);
  const active = state ?? internal;
  const activeIdx = Math.max(0, STATES.findIndex((s) => s.id === active));

  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const select = React.useCallback(
    (id: InspectorState) => {
      if (state === undefined) setInternal(id);
      onStateChange?.(id);
    },
    [state, onStateChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (activeIdx + 1) % STATES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (activeIdx - 1 + STATES.length) % STATES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = STATES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(STATES[next].id);
    tabRefs.current[next]?.focus();
  };

  const panelId = React.useId();

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-[18px] shadow-[var(--shadow-card)]",
        className,
      )}
      aria-label="四態設計演示"
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>STATE INSPECTOR</Eyebrow>
        <span className="font-mono text-[10px] text-[var(--muted-2)]">設計走查 · 唯讀</span>
      </div>

      {/* segmented control（tablist） */}
      <div
        role="tablist"
        aria-label="切換演示狀態"
        aria-orientation="horizontal"
        className="inline-flex w-full gap-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-1"
      >
        {STATES.map((s, i) => {
          const selected = s.id === active;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${panelId}-tab-${s.id}`}
              aria-selected={selected}
              aria-controls={`${panelId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(s.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "min-h-[44px] flex-1 cursor-pointer rounded-[9px] px-3 text-[12px] font-semibold transition-all duration-200 ease-[cubic-bezier(.2,.7,.2,1)]",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
                selected
                  ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-xs)] border border-[var(--line-strong)]"
                  : "border border-transparent text-[var(--muted)] hover:text-[var(--text-soft)] hover:bg-[var(--surface)]",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* 演示面板（即時展示對應四態元件） */}
      <div
        role="tabpanel"
        id={`${panelId}-panel`}
        aria-labelledby={`${panelId}-tab-${active}`}
        tabIndex={0}
        className="min-h-[180px] rounded-[12px] border border-[var(--hair)] bg-[var(--wash)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]"
      >
        {STATES[activeIdx].render()}
      </div>
    </section>
  );
}

export default StateInspector;
