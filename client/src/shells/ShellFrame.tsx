// ============================================================================
// shells/ShellFrame.tsx — shell 共用外框引擎
// ----------------------------------------------------------------------------
// 每個 shell 都是「DashboardLayout（帶 shell scope）＋ 內部 Switch（讀 shellRouteTable）」。
// 把這層抽成引擎，四個 shell 只是 <ShellFrame shell="video" /> 之類的薄包裝 —— 既「四個
// 獨立 shell」（各自掛載、各自 sub-router），又不重複外框邏輯。
//
// 行為對齊線上：
//   - 用既有 DashboardLayout 提供 chrome + 登入 gate（與既有 *DashboardRoute 相同）。
//   - 每個 sub-route 用 ShellPage（= ProtectedDashboardRoute 內層：ErrorBoundary+Suspense+轉場）。
//   - DashboardLayout 只在「整個 Switch」外層掛一次 → shell 內切 sub-route 不重掛 chrome。
// ============================================================================
import { Switch, Route } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import NotFound from "@/pages/NotFound";
import { NavigateRedirect, ShellPage } from "@/app/navigation";
import { SHELL_SUBROUTES, SHELL_INTERNAL_REDIRECTS } from "./shellRouteTable";
import { SHELL_BY_ID } from "@/config/shells";
import type { ShellId } from "@/spine/types";

function ShellDisabled({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-md text-center space-y-3">
        <div className="text-4xl">🚫</div>
        <div className="text-lg font-semibold">{name}系統目前已關閉</div>
        <div className="text-sm text-muted-foreground">
          管理員可於 /settings → 管理後台 → 功能開關重新開啟（示範「功能開關即時影響全站」）。
        </div>
      </div>
    </div>
  );
}

export function ShellFrame({ shell }: { shell: ShellId }) {
  const meta = SHELL_BY_ID[shell];
  const subs = SHELL_SUBROUTES[shell];
  const internal = SHELL_INTERNAL_REDIRECTS[shell];
  const indexRoute = subs.find((s) => s.index);

  if (!meta.enabled) {
    return (
      <DashboardLayout shell={shell}>
        <ShellDisabled name={meta.zh} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout shell={shell}>
      <Switch>
        {/* shell 內部相容導向（如 /settings/ai-brain → /settings/admin） */}
        {internal.map((r) => (
          <Route key={r.from} path={r.from}>
            <NavigateRedirect to={r.to} />
          </Route>
        ))}
        {/* canonical sub-routes（新前綴 → 既有頁面） */}
        {subs.map((s) => (
          <Route key={s.path} path={s.path}>
            <ShellPage component={s.component} />
          </Route>
        ))}
        {/* 裸前綴 → index（僅 index 不等於裸前綴時需要，例如 /video → /video/director） */}
        {indexRoute && indexRoute.path !== `/${shell}` && (
          <Route path={`/${shell}`}>
            <NavigateRedirect to={indexRoute.path} />
          </Route>
        )}
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}
