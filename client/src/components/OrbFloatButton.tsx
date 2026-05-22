/**
 * OrbFloatButton + OrbDrawer
 *
 * Phase 1：光球代理介面浮動側欄。
 * - 右下角浮動觸發按鈕（fixed,z-index 最高層）
 * - 點擊後從右側滑出 3/4 屏抽屜,內含 AgentChat 完整聊天介面
 * - 抽屜頂部顯示「光球正在協助：[當前專案名稱]」
 * - 右上角 × 可收起,收起後回到觸發按鈕狀態
 *
 * 抽屜以 sheet 實作,使用 Radix 的 portal + overlay,不會影響底層頁面滾動。
 */

import { Suspense, useState } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Sparkles } from "lucide-react";
import { useProjects } from "@/contexts/ProjectsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const AgentChat = lazy(() => import("@/pages/AgentChat"));

function OrbDrawerFallback() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export interface OrbFloatButtonProps {
  /** Show pulse animation to indicate active task / new notification. */
  hasNotification?: boolean;
  className?: string;
}

export function OrbFloatButton({
  hasNotification = false,
  className,
}: OrbFloatButtonProps) {
  const [open, setOpen] = useState(false);
  const { activeProject } = useProjects();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="開啟光球助手"
        className={cn(
          "fixed bottom-6 right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full",
          "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg",
          "transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          hasNotification && "animate-pulse",
          className,
        )}
      >
        <Sparkles className="size-6" />
        {hasNotification ? (
          <span className="absolute -top-1 -right-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 ring-2 ring-background" />
        ) : null}
        <span className="sr-only">開啟光球助手</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-[75vw]"
        >
          <SheetHeader className="border-b px-5 py-3">
            <SheetTitle className="text-sm font-medium">
              光球正在協助：
              <span className="ml-1 text-primary">
                {activeProject?.title ?? "尚未綁定專案"}
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              全站光球代理對話介面
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<OrbDrawerFallback />}>
              {open ? <AgentChat /> : null}
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default OrbFloatButton;
