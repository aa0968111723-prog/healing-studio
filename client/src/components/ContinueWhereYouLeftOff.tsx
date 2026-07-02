// ============================================================================
// components/ContinueWhereYouLeftOff.tsx — 回訪「接著上次」引導卡（AIDV-967）
// ----------------------------------------------------------------------------
// 掛在首頁 hero 下方。回訪者若有「新手路徑進度」或「未完成的創作專案」，
// 給一張可關閉的續接卡：
//   slot ①：新手路徑 X/5 → /learn?sub=start（BeginnerPathPanel 分頁深連結）
//   slot ②：最近未完成專案 → /projects/:id（AIDV-961 #1274 補上「下一步」
//            可點主按鈕的 ProjectDetailPage，與 CreationHub「繼續創作」同目的地）
// 四態：
//   - 載入：已知有路徑進度時，專案 slot 先畫 skeleton；否則不渲染（不閃空卡）
//   - 空（真新手）：完全不渲染
//   - 錯誤／未登入（清單查詢失敗）：專案 slot 靜默降級成不顯示，絕不弄壞首頁
//   - 成功：依 deriveResumeState 顯示 1–2 個 slot
// 純前端、零新後端：專案清單重用 ProjectsContext（trpc.creativeProject.list，
// 全站 provider 本來就在跑）；localStorage 讀寫皆 try/catch（私密模式安全）。
// 可關閉：關閉記在 localStorage（CONTINUE_CARD_DISMISS_KEY），之後不再彈。
// ============================================================================
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FolderOpen, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/contexts/ProjectsContext";
import { ENABLE_PROJECT_SSOT } from "@/config/projectFlags";
import { FEATURE_LEARN_BEGINNER_PATH } from "@/config/featureFlags";
import {
  deriveResumeState,
  readBeginnerPathDoneIds,
  readContinueCardDismissed,
  writeContinueCardDismissed,
} from "./continueResume";

export function ContinueWhereYouLeftOff() {
  const { projects, isLoading, error } = useProjects();
  const [dismissed, setDismissed] = useState<boolean>(readContinueCardDismissed);
  // 掛載時讀一次即可：本卡只在「剛回站」時提示，不需要跟面板即時同步。
  // 路徑 slot 的旗標安全閥（與下方 SSOT 防護對稱）：AIDV-811 旗標回滾時
  // /learn 沒有「新手路徑」分頁、?sub=start 會 fallback 到別的分頁 →
  // 有 localStorage 進度也不能餵 slot ①，否則 CTA 承諾落空。
  const [pathDoneIds] = useState<string[]>(
    FEATURE_LEARN_BEGINNER_PATH ? readBeginnerPathDoneIds : () => [],
  );

  if (dismissed) return null;

  // 專案 slot 的資料安全閥：
  // - 查詢失敗（含未登入 401）→ 視為無專案，靜默降級，首頁照常。
  // - SSOT 旗標回滾到 MOCK_PROJECTS 時 mock 清單恆非空，會把「真新手完全
  //   不渲染」變成永遠顯示假專案 → mock 路徑一律不餵專案 slot。
  const safeProjects = ENABLE_PROJECT_SSOT && !error ? projects : [];
  const projectSlotLoading = ENABLE_PROJECT_SSOT && !error && isLoading;
  const state = deriveResumeState(pathDoneIds, safeProjects);

  // 載入中且沒有路徑進度可先撐住卡片 → 不渲染（真新手不閃 skeleton；
  // 載入完成若有未完成專案，卡片再自然出現）。
  if (!state.visible) return null;

  const dismiss = () => {
    writeContinueCardDismissed();
    setDismissed(true);
  };

  const twoColumns = Boolean(state.path && (state.project || projectSlotLoading));

  return (
    <section
      aria-labelledby="continue-left-off-heading"
      data-testid="continue-left-off"
      className="relative z-10 px-4 sm:px-6 pb-10 sm:pb-14"
    >
      <div className="max-w-3xl mx-auto rounded-2xl border border-border/60 bg-card/80 backdrop-blur-md shadow-sm p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="continue-left-off-heading"
              className="text-base sm:text-lg font-semibold"
            >
              接著上次繼續
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              歡迎回來，這是你上次進行到的地方
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="關閉「接著上次繼續」卡片，之後不再顯示"
            data-testid="continue-left-off-dismiss"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className={`mt-4 grid gap-3 ${twoColumns ? "sm:grid-cols-2" : ""}`}>
          {/* ── slot ①：新手路徑進度 ── */}
          {state.path && (
            <div
              data-testid="continue-left-off-path"
              className="rounded-xl border border-border/60 bg-background/60 p-4 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" aria-hidden />
                <span className="text-sm font-medium">新手路徑</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {state.path.done}/{state.path.total}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="新手路徑進度"
                aria-valuemin={0}
                aria-valuemax={state.path.total}
                aria-valuenow={state.path.done}
                className="h-1.5 rounded-full bg-muted overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${(state.path.done / state.path.total) * 100}%`,
                  }}
                />
              </div>
              <Button
                asChild
                size="sm"
                className="mt-auto w-full"
                data-testid="continue-left-off-path-cta"
              >
                <Link
                  href="/learn?sub=start"
                  aria-label={`繼續新手路徑，已完成 ${state.path.done} / ${state.path.total} 步`}
                >
                  繼續新手路徑
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          )}

          {/* ── slot ②：最近未完成專案（載入中先畫 skeleton） ── */}
          {projectSlotLoading && !state.project ? (
            <div
              data-testid="continue-left-off-project-loading"
              aria-hidden
              className="rounded-xl border border-border/60 bg-background/60 p-4 flex flex-col gap-3"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-8 w-full mt-auto" />
            </div>
          ) : (
            state.project && (
              <div
                data-testid="continue-left-off-project"
                className="rounded-xl border border-border/60 bg-background/60 p-4 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="h-4 w-4 text-primary shrink-0" aria-hidden />
                  <span className="text-sm font-medium truncate">
                    {state.project.title}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {state.project.nextAction}
                </p>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="mt-auto w-full"
                  data-testid="continue-left-off-project-cta"
                >
                  <Link
                    href={`/projects/${state.project.id}`}
                    aria-label={`繼續專案「${state.project.title}」`}
                  >
                    繼續這個專案
                    <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}

export default ContinueWhereYouLeftOff;
