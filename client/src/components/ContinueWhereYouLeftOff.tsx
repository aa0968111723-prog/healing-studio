/**
 * ContinueWhereYouLeftOff.tsx — AIDV-967 回訪「接著上次」引導卡。
 *
 * 掛在首頁 hero 下方。純前端、零新後端：
 *   - 路徑進度：唯讀 AIDV-811 的 localStorage `learn:beginner-path:done`。
 *   - 專案列表：重用 ProjectsContext（背後是既有 trpc.creativeProject.list，
 *     App 已全域掛 ProjectsProvider，本卡不新增任何查詢）。
 *
 * 四態：
 *   - 載入：已有路徑進度時先渲染路徑 slot，專案 slot 畫 skeleton；
 *     沒有路徑進度時整卡暫不渲染（避免對真新手閃一張空卡），資料回來
 *     若有未完成專案卡片才出現。
 *   - 空（真新手）：完全不渲染。
 *   - 錯（未登入 / 查詢失敗）：ProjectsContext 回 error + 空列表 →
 *     專案 slot 靜默消失，絕不弄壞首頁；若仍有路徑進度只顯示路徑 slot。
 *   - 成功：一或兩個 slot。
 *
 * 可關閉：右上 X，localStorage 記住、不重彈（私密模式寫入失敗則本次
 * session 仍關閉）。a11y：section aria-labelledby 卡片 heading，按鈕都有
 * 可讀 label。
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FolderOpen, History, Route, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/contexts/ProjectsContext";
import {
  deriveResumeState,
  readBeginnerPathDoneCount,
  readDismissed,
  writeDismissed,
} from "./continueWhereYouLeftOff";

const HEADING_ID = "continue-where-left-off-heading";

export function ContinueWhereYouLeftOff() {
  // localStorage 皆為同步讀取，用 lazy initializer 只在掛載時讀一次。
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  const [pathDoneCount] = useState<number>(readBeginnerPathDoneCount);
  const { projects, isLoading, error } = useProjects();

  if (dismissed) return null;

  const state = deriveResumeState(pathDoneCount, projects);
  const loadingProjects = isLoading && !error;

  // 真新手（無路徑進度）且列表載入中／載入失敗／載入後仍全空 → 完全不渲染。
  if (!state.path && !state.project) return null;
  // 載入中且僅可能出現專案 slot → 先不渲染，避免空殼閃現（見檔頭四態說明）。
  if (!state.path && loadingProjects) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby={HEADING_ID}
      data-testid="continue-where-left-off"
      className="relative z-10 px-4 sm:px-6 pb-10 sm:pb-14"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-border/50 bg-card/70 p-4 shadow-sm backdrop-blur-md sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2
            id={HEADING_ID}
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <History className="size-4 text-primary" aria-hidden />
            接著上次繼續
          </h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="關閉「接著上次繼續」卡片"
            data-testid="continue-where-left-off-dismiss"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {state.path && (
            <div
              data-testid="continue-slot-path"
              className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/40 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Route className="size-3.5" aria-hidden />
                新手路徑
                <span className="ml-auto tabular-nums">
                  {state.path.doneCount}/{state.path.total}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="新手路徑進度"
                aria-valuemin={0}
                aria-valuemax={state.path.total}
                aria-valuenow={state.path.doneCount}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${(state.path.doneCount / state.path.total) * 100}%`,
                  }}
                />
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="mt-auto w-fit"
                data-testid="continue-path-cta"
              >
                <Link href={state.path.href} aria-label="繼續新手路徑">
                  繼續新手路徑
                  <ArrowRight className="ml-1 size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          )}

          {state.project ? (
            <div
              data-testid="continue-slot-project"
              className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/40 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FolderOpen className="size-3.5" aria-hidden />
                未完成專案
              </div>
              <p className="truncate text-sm font-medium" title={state.project.title}>
                {state.project.title}
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {state.project.nextAction}
              </p>
              <Button
                asChild
                size="sm"
                className="mt-auto w-fit"
                data-testid="continue-project-cta"
              >
                <Link
                  href={state.project.href}
                  aria-label={`繼續專案：${state.project.title}`}
                >
                  繼續這個專案
                  <ArrowRight className="ml-1 size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          ) : (
            loadingProjects && (
              <div
                data-testid="continue-slot-project-skeleton"
                aria-hidden
                className="h-24 animate-pulse rounded-xl border border-border/40 bg-muted/40"
              />
            )
          )}
        </div>
      </div>
    </section>
  );
}

export default ContinueWhereYouLeftOff;
