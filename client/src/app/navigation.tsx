// ============================================================================
// app/navigation.tsx — shell 共用導航/包裝小工具
// ----------------------------------------------------------------------------
// NavigateRedirect：與 App.tsx 既有的同名元件語意一致（wouter useLocation, replace）。
//   抽成共用檔，讓 ShellRoutes 與各 shell 共用同一份相容導向邏輯。
// ShellPage：把一個（lazy）頁面元件包成「ErrorBoundary inline + Suspense(skeleton) +
//   RouteTransition」—— 即 App.tsx ProtectedDashboardRoute 的內層結構。shell 內各 sub-route
//   用它渲染既有頁面，確保與線上相同的載入/錯誤邊界/轉場行為。
// ============================================================================
import { Suspense, useEffect, type ComponentType } from "react";
import { useLocation } from "wouter";
import ErrorBoundary from "@/components/ErrorBoundary";
import RouteTransition from "@/components/RouteTransition";
import { Skeleton } from "@/components/ui/skeleton";

/** 與 App.tsx PageSkeleton 等價的載入骨架（抽出共用，避免跨檔耦合）。 */
export function PageSkeleton() {
  return (
    <div className="flex-1 p-6 sm:p-8 space-y-6 w-full animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
        <Skeleton className="h-48 rounded-2xl glass-card-static" />
      </div>
      <Skeleton className="h-64 mt-6 w-full rounded-2xl glass-card-static" />
    </div>
  );
}

/** 相容導向：掛載即把當前路徑 replace 成 `to`（與 App.tsx NavigateRedirect 一致）。 */
export function NavigateRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

/** 把（lazy）頁面包成與 ProtectedDashboardRoute 內層相同的結構。 */
export function ShellPage({ component: Component }: { component: ComponentType }) {
  return (
    <ErrorBoundary inline>
      <Suspense fallback={<PageSkeleton />}>
        <RouteTransition>
          <Component />
        </RouteTransition>
      </Suspense>
    </ErrorBoundary>
  );
}
