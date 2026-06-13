// ============================================================================
// shells/video/console/CockpitColumns.tsx — 三欄 RWD 容器（W1-9 手機版導演台）
// ----------------------------------------------------------------------------
// ⑧-H7：VideoCockpit 幾乎零 RWD、手機三欄縱疊不可用（Bruce 主場景＝手機）。
// 策略（純 CSS 斷點＋一個本地 active 狀態，桌機逐像素不變）：
//   • lg+（桌機）：維持原本 grid 三欄；每欄外層包一個 `lg:contents` 的 div，
//     在 lg 之上 display:contents → 外層消失、欄位仍是 grid 直接子項（self-start
//     等樣式完全保留），桌機版面與重構前一致。
//   • <lg（手機/平板）：外層恢復成一般 box，只顯示「目前頁籤」那一欄（其餘 hidden），
//     底部出現 sticky 頁籤列（脊椎／畫布／Context）切換；六步工作流都在「畫布」欄，
//     手機落地預設停在畫布。Context Sidecar 關閉時不顯示該頁籤。
// 純展示＋本地 UI 狀態；無資料副作用。只在導演台（ENABLE_4SHELL 之下）被用到。
// ============================================================================
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CockpitColumnId = "spine" | "canvas" | "context";

const GRID_3 = "lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(300px,340px)]";
const GRID_2 = "lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]";

export function CockpitColumns({
  showSidecar,
  spine,
  canvas,
  context,
}: {
  showSidecar: boolean;
  spine: ReactNode;
  canvas: ReactNode;
  context: ReactNode;
}) {
  const [active, setActive] = useState<CockpitColumnId>("canvas");
  // Context 欄關閉時，落在 context 的手機頁籤回退到畫布，避免空白。
  const effective: CockpitColumnId = active === "context" && !showSidecar ? "canvas" : active;

  // <lg：只顯示 active 欄；lg+：display:contents → 還原成 grid 直接子項。
  const cell = (id: CockpitColumnId) => cn(effective === id ? "block" : "hidden", "min-w-0 lg:contents");

  const tabs: { id: CockpitColumnId; label: string }[] = [
    { id: "spine", label: "脊椎" },
    { id: "canvas", label: "畫布" },
    ...(showSidecar ? [{ id: "context" as const, label: "Context" }] : []),
  ];

  return (
    <>
      <div className={cn("grid grid-cols-1 gap-4", showSidecar ? GRID_3 : GRID_2)}>
        <div className={cell("spine")} data-testid="cockpit-col-spine">{spine}</div>
        <div className={cell("canvas")} data-testid="cockpit-col-canvas">{canvas}</div>
        {showSidecar && (
          <div className={cell("context")} data-testid="cockpit-col-context">{context}</div>
        )}
      </div>

      {/* 底部欄位頁籤：僅 <lg 顯示（桌機 lg:hidden） */}
      <div
        className="sticky bottom-0 z-20 -mx-4 mt-1 border-t bg-background/95 px-4 py-1.5 backdrop-blur lg:hidden"
        role="tablist"
        aria-label="導演台欄位切換"
      >
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={effective === t.id}
              data-testid={`cockpit-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={cn(
                "flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-healing",
                effective === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default CockpitColumns;
