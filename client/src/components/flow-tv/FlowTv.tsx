/* AI Director · Flow TV — 全屏沉浸放映皮（AIDV-117 / U-14）
   ──────────────────────────────────────────────────────────────────────────
   一句話範圍：一個全屏 overlay 放映皮，唯讀消費提示庫項目（items prop），
   支援左右切換項目、Esc 退出、自動播放/暫停 toggle、底部進度 Meter；可跨
   /video /social 用，mock 離線可驗。

   設計鐵則：
     · 視覺＝亮色暖光 design-kit；元件須在 <AidvKit>（.aidv-kit scope）內，
       FlowTvOverlay 已自帶 <AidvKit>。
     · 禁硬編 hex → 全走 CSS 變數（--clay/--surface/--text/--muted/--line…）。
     · a11y：lucide-react SVG（非 emoji）、icon-only aria-label、焦點環、
       觸控 ≥44px、動效 150–300ms 尊重 prefers-reduced-motion；鍵盤可操作
       （←/→ 切換、Esc 退出、空白鍵播放/暫停）；載入/空/錯誤三態有出口。
     · 純前端唯讀消費：接受 items prop，不打任何後端。
   rev. U-14 · 2026-06-17 */
import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
  Tv,
} from "lucide-react";
import { AidvKit } from "../design-kit/AidvKit";
import { Button, Pill, Tag, Kbd, Meter } from "../design-kit/primitives";
import { EmptyState, ErrorState, LoadingState } from "../design-kit/states";
import { cn } from "../design-kit/tokens";
import { FLOW_TV_AUTOPLAY_MS } from "./flowTvFlags";

/* ── 一筆放映項目（唯讀消費；對映提示庫紀錄的子集） ── */
export interface FlowTvItem {
  id: string;
  prompt: string;
  /** 來源工作流（決定角標顏色語意） */
  source?: "video" | "social";
  tags?: string[];
  model?: string;
  /** 縮圖/背景樣式（demo / mock 用，禁硬編 hex 由呼叫端傳 var()） */
  media?: React.CSSProperties;
}

type LoadState = "ready" | "loading" | "error";

export interface FlowTvOverlayProps {
  /** 放映項目（唯讀）。空陣列 → 空態。 */
  items: FlowTvItem[];
  /** 是否開啟 overlay。 */
  open: boolean;
  /** 退出（Esc / 關閉鈕）。 */
  onClose: () => void;
  /** 載入態：'ready'（預設）/ 'loading' / 'error'。 */
  state?: LoadState;
  /** 錯誤態重試。 */
  onRetry?: () => void;
  /** 空態的行動（例如「去生成」）。 */
  onEmptyAction?: { label: string; onClick: () => void };
  /** 自動播放停留毫秒（預設 FLOW_TV_AUTOPLAY_MS）。 */
  autoplayMs?: number;
  /** 初始索引（預設 0）。 */
  initialIndex?: number;
}

/**
 * Flow TV 全屏沉浸放映器 overlay。
 * 純呈現＋本地互動狀態（索引/播放），不接後端＝零回歸。
 */
export function FlowTvOverlay({
  items,
  open,
  onClose,
  state = "ready",
  onRetry,
  onEmptyAction,
  autoplayMs = FLOW_TV_AUTOPLAY_MS,
  initialIndex = 0,
}: FlowTvOverlayProps) {
  const count = items.length;
  const [index, setIndex] = React.useState(() =>
    clampIndex(initialIndex, count),
  );
  const [playing, setPlaying] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  // 項目數變動時，把索引夾回有效範圍。
  React.useEffect(() => {
    setIndex((i) => clampIndex(i, count));
  }, [count]);

  const go = React.useCallback(
    (dir: 1 | -1) => {
      if (count === 0) return;
      setIndex((i) => (i + dir + count) % count);
    },
    [count],
  );

  const next = React.useCallback(() => go(1), [go]);
  const prev = React.useCallback(() => go(-1), [go]);
  const togglePlay = React.useCallback(() => setPlaying((p) => !p), []);

  // 自動播放：尊重 prefers-reduced-motion → 不自動推進（仍可手動切換）。
  React.useEffect(() => {
    if (!open || !playing || count <= 1 || state !== "ready") return;
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(next, Math.max(1500, autoplayMs));
    return () => window.clearInterval(t);
  }, [open, playing, count, state, next, autoplayMs]);

  // 開啟時把焦點移入 dialog（鍵盤可操作）。
  React.useEffect(() => {
    if (open) dialogRef.current?.focus();
    else setPlaying(false);
  }, [open]);

  // 鍵盤：←/→ 切換、Esc 退出、空白鍵播放/暫停。
  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowRight":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
        e.preventDefault();
        prev();
        break;
      case " ":
      case "Spacebar":
        e.preventDefault();
        togglePlay();
        break;
    }
  };

  if (!open) return null;

  const current = items[index];
  const pct = count > 1 ? ((index + 1) / count) * 100 : count === 1 ? 100 : 0;

  return (
    <AidvKit
      as="div"
      className="fixed inset-0 z-50 flex items-stretch justify-center"
    >
      {/* 遮罩 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[var(--text)]/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Flow TV 沉浸放映"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative z-10 flex w-full max-w-[1080px] flex-col",
          "m-auto h-full max-h-[100dvh] overflow-hidden",
          "bg-[var(--surface)] outline-none",
          "motion-safe:transition-opacity motion-safe:duration-200",
        )}
      >
        {/* 頂列：標題 + 退出 */}
        <header className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-[var(--clay)]">
            <Tv size={18} aria-hidden />
          </span>
          <div className="flex flex-col">
            <div className="text-[13px] font-semibold text-[var(--text)]">
              Flow TV · 提示庫放映
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              全屏沉浸 · 唯讀消費
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {state === "ready" && count > 0 && (
              <Pill kind="mute">
                {index + 1} / {count}
              </Pill>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="退出 Flow TV"
              onClick={onClose}
              className="size-11 !p-0"
            >
              <X size={18} aria-hidden />
            </Button>
          </div>
        </header>

        {/* 主體：四態 */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          {state === "loading" && (
            <LoadingState label="載入放映清單…" />
          )}
          {state === "error" && (
            <ErrorState
              title="放映載入失敗"
              message="提示庫連線中斷，稍後再試。"
              onRetry={onRetry}
            />
          )}
          {state === "ready" && count === 0 && (
            <EmptyState
              icon={<Tv size={20} aria-hidden />}
              title="還沒有可放映的提示"
              hint="存入提示庫後，即可在 Flow TV 全屏放映。"
              action={onEmptyAction}
            />
          )}
          {state === "ready" && count > 0 && current && (
            <FlowTvStage item={current} />
          )}

          {/* 左右切換（只在有 ≥2 項時可用） */}
          {state === "ready" && count > 1 && (
            <>
              <button
                type="button"
                aria-label="上一個"
                onClick={prev}
                className={cn(
                  "absolute left-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center",
                  "rounded-full border border-[var(--line)] bg-[var(--surface)]/90 text-[var(--text-soft)]",
                  "hover:border-[var(--clay-soft)] hover:text-[var(--clay)]",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
                  "motion-safe:transition-colors motion-safe:duration-200",
                )}
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="下一個"
                onClick={next}
                className={cn(
                  "absolute right-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center",
                  "rounded-full border border-[var(--line)] bg-[var(--surface)]/90 text-[var(--text-soft)]",
                  "hover:border-[var(--clay-soft)] hover:text-[var(--clay)]",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--clay-ring)]",
                  "motion-safe:transition-colors motion-safe:duration-200",
                )}
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            </>
          )}
        </div>

        {/* 底列：播放/暫停 + 進度 Meter + 鍵盤提示 */}
        {state === "ready" && count > 0 && (
          <footer className="flex items-center gap-4 border-t border-[var(--line)] px-5 py-3">
            <Button
              variant={playing ? "default" : "primary"}
              size="sm"
              aria-label={playing ? "暫停自動放映" : "開始自動放映"}
              aria-pressed={playing}
              onClick={togglePlay}
              disabled={count <= 1}
              className="min-w-11"
            >
              {playing ? (
                <Pause size={15} aria-hidden />
              ) : (
                <Play size={15} aria-hidden />
              )}
              <span>{playing ? "暫停" : "播放"}</span>
            </Button>

            <div className="flex-1" aria-hidden>
              <Meter pct={pct} />
            </div>

            <div className="hidden items-center gap-1 text-[11px] text-[var(--muted)] sm:flex">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <span>切換</span>
              <span className="mx-1 text-[var(--line)]">·</span>
              <Kbd>Esc</Kbd>
              <span>退出</span>
            </div>
          </footer>
        )}
      </div>
    </AidvKit>
  );
}

/* ── 單張放映舞台 ── */
function FlowTvStage({ item }: { item: FlowTvItem }) {
  return (
    <figure
      className="flex h-full w-full flex-col"
      aria-label="放映項目"
    >
      <div
        className="flex flex-1 items-end bg-[var(--surface-2)]"
        style={item.media}
      >
        <figcaption className="w-full bg-[linear-gradient(0deg,var(--surface),transparent)] p-6">
          <div className="mb-2 flex items-center gap-2">
            {item.source && (
              <Pill kind={item.source === "video" ? "info" : "warn"}>
                {item.source === "video" ? "影片" : "社群"}
              </Pill>
            )}
            {item.model && <Tag>{item.model}</Tag>}
          </div>
          <p className="max-w-[640px] text-[15px] leading-relaxed text-[var(--text)]">
            {item.prompt}
          </p>
          {item.tags && item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {item.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          )}
        </figcaption>
      </div>
    </figure>
  );
}

/* ── mock 放映清單（離線可驗；media 走 var() 不硬編 hex） ── */
export const FLOW_TV_MOCK_ITEMS: FlowTvItem[] = [
  {
    id: "m1",
    prompt: "暖光黏土質感的療癒小屋，清晨薄霧，柔焦景深，珊瑚橘色調。",
    source: "video",
    model: "flux-pro",
    tags: ["療癒", "暖光", "景深"],
    media: { background: "linear-gradient(160deg,var(--surface-3),var(--surface-2))" },
  },
  {
    id: "m2",
    prompt: "扁平插畫風格的社群貼文主視覺，金色高光，簡潔留白構圖。",
    source: "social",
    model: "gemini-2.5",
    tags: ["社群", "插畫", "留白"],
    media: { background: "linear-gradient(160deg,var(--surface-2),var(--surface-3))" },
  },
  {
    id: "m3",
    prompt: "夜景城市天際線縮時，霓虹倒影，電影感色彩分級。",
    source: "video",
    model: "hf-sdxl",
    tags: ["縮時", "電影感"],
    media: { background: "linear-gradient(160deg,var(--surface-3),var(--surface))" },
  },
];

/* ── helpers ── */
function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(i) || i < 0) return 0;
  if (i >= count) return count - 1;
  return Math.floor(i);
}

export default FlowTvOverlay;
