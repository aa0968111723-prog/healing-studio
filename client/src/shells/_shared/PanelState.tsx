// ============================================================================
// shells/_shared/PanelState.tsx — 共用「載入 / 空 / 錯誤」三態（a11y 友善）
// ----------------------------------------------------------------------------
// 為什麼有這支：
//   4-shell 的各面板各自手刻 skeleton 與空狀態，且多數查詢面板在 `retry:false` 下
//   一旦查詢失敗，會「靜默落入空狀態」，把『錯誤』誤報成『沒有資料』。使用者看到的是
//   「目前沒有情報」而不是「讀取失敗，可重試」——資訊錯誤且沒有重試出口。
//
//   本元件把三態統一，並補上無障礙語意（盤點 §3-13 reduced-motion 同脈絡的 a11y 補強）：
//     - 載入：role="status" aria-busy（螢幕報讀器知道正在載入，不會誤判為空白）
//     - 空　：role="status"（中性提示，非錯誤）
//     - 錯誤：role="alert" + 可選「重試」（讓使用者能重新抓取，而非以為沒資料）
//
// 【嚴格加法 / 零風險】只 import 既有 ui 原語與 lucide；不 import server/ 或 drizzle/、
// 不讀 @shared/schema。元件純展示、無副作用；只在 ENABLE_4SHELL=ON 掛載的 shell 內被用到。
// ============================================================================
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
// U-2（AIDV-92）元件採用：旗標 ON 時，空/錯誤態改用 design-kit 亮色暖光元件（與 chrome 同一個
// ENABLE_AIDV_CHROME 開關）；OFF（預設）＝沿用既有 shadcn 版本＝零變化。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, EmptyState as DkEmptyState, ErrorState as DkErrorState } from "@/components/design-kit";

/** 載入骨架：a11y 報讀「載入中」，視覺維持既有 Skeleton 風格。 */
export function PanelLoading({
  count = 4,
  className = "h-12 rounded-lg",
  wrapClassName = "space-y-2",
  label = "載入中…",
}: {
  count?: number;
  className?: string;
  wrapClassName?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={wrapClassName}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}

/** 空狀態：中性提示（非錯誤）。icon 為裝飾，對報讀器隱藏。 */
export function PanelEmpty({
  icon,
  title,
  hint,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  // 旗標 ON：改用 design-kit 亮色暖光 EmptyState（須包 <AidvKit> 範圍 token 才解析）。
  // 不傳 icon 時讓 design-kit 用其原生 ✦ 字符；維持 role="status"（DkEmptyState 為中性提示）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div role="status">
          <DkEmptyState icon={icon ?? undefined} title={title} hint={hint} className={className} />
        </div>
      </AidvKit>
    );
  }
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-1.5 py-10 text-center ${className}`}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" />}
      </span>
      <div className="text-sm text-muted-foreground">{title}</div>
      {hint ? <div className="text-[11px] text-muted-foreground/80 max-w-md">{hint}</div> : null}
    </div>
  );
}

/**
 * 錯誤狀態：role="alert" 讓報讀器即時播報；可選「重試」按鈕（傳入 onRetry，通常為
 * tRPC query 的 refetch）。compact 版用於原本就以單行 inline 呈現錯誤的面板，維持版面。
 */
export function PanelError({
  message = "讀取失敗，請稍後重試。",
  onRetry,
  compact = false,
}: {
  message?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (compact) {
    // compact 為單行 inline 版（嵌在既有面板列內）；維持原樣不切設計套件，避免破版。
    return (
      <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{message}</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
            重試
          </button>
        ) : null}
      </div>
    );
  }
  // 旗標 ON（非 compact）：改用 design-kit 亮色暖光 ErrorState（內建 role="alert" 與重試鈕）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkErrorState message={message} onRetry={onRetry} />
      </AidvKit>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <AlertTriangle aria-hidden="true" className="h-6 w-6 text-destructive" />
      <div className="text-sm text-destructive">{message}</div>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} className="h-7 text-[11px]">
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 mr-1.5" />
          重試
        </Button>
      ) : null}
    </div>
  );
}
